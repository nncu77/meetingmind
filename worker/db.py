"""
Supabase client wrapper for the worker.

Uses service-role key — bypasses RLS. The worker is trusted infra and writes
on behalf of users. Keep this module narrow: only functions the pipeline needs.

Schema is mirrored in lib/supabase/types.ts on the Next.js side. If you add
a column here, update there too.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)

_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, key)
    return _client


def insert_speaker_segments(meeting_id: str, segments: list[dict[str, Any]]) -> int:
    """segments: [{speaker, start, end, matched_member_id?, match_confidence?}]"""
    if not segments:
        return 0
    rows = [
        {
            "meeting_id": meeting_id,
            "speaker_label": s["speaker"],
            "matched_member_id": s.get("matched_member_id"),
            "match_confidence": s.get("match_confidence"),
            "start_seconds": float(s["start"]),
            "end_seconds": float(s["end"]),
        }
        for s in segments
    ]
    res = get_client().table("speaker_segments").insert(rows).execute()
    n = len(res.data or [])
    logger.info("inserted %d speaker_segments for meeting %s", n, meeting_id)
    return n


def insert_transcript_segments(meeting_id: str, segments: list[dict[str, Any]]) -> int:
    """segments: aligned output of stt + diarize (start/end/text/speaker/confidence)."""
    if not segments:
        return 0
    rows = [
        {
            "meeting_id": meeting_id,
            "speaker_label": s.get("speaker"),
            "text": s["text"],
            "start_seconds": float(s["start"]),
            "end_seconds": float(s["end"]),
            # Whisper avg_logprob is a negative log-prob; clamp to [0,1] for the
            # confidence column (sigmoid-ish heuristic — not a real calibration).
            "confidence": _approx_confidence(s.get("confidence")),
        }
        for s in segments
    ]
    res = get_client().table("transcript_segments").insert(rows).execute()
    n = len(res.data or [])
    logger.info("inserted %d transcript_segments for meeting %s", n, meeting_id)
    return n


def update_meeting_completed(
    meeting_id: str,
    duration_seconds: float,
    cost_estimate_cents: int,
    stt_backend: str,
    gpu_tier: str,
    llm_input_tokens: Optional[int] = None,
    llm_output_tokens: Optional[int] = None,
    llm_provider: Optional[str] = None,
) -> None:
    payload: dict[str, Any] = {
        "status": "done",
        "duration_seconds": int(round(duration_seconds)),
        "cost_estimate_cents": cost_estimate_cents,
        "stt_backend": stt_backend,
        "gpu_tier": gpu_tier,
        "processed_at": _now_iso(),
    }
    if llm_input_tokens is not None:
        payload["llm_input_tokens"] = llm_input_tokens
    if llm_output_tokens is not None:
        payload["llm_output_tokens"] = llm_output_tokens
    if llm_provider is not None:
        payload["llm_provider"] = llm_provider
    get_client().table("meetings").update(payload).eq("id", meeting_id).execute()
    logger.info(
        "meeting %s marked done (cost=%d cents, provider=%s)",
        meeting_id, cost_estimate_cents, llm_provider or "anthropic",
    )


def update_meeting_failed(meeting_id: str, error_message: str) -> None:
    get_client().table("meetings").update(
        {"status": "failed", "error_message": error_message[:1000], "processed_at": _now_iso()}
    ).eq("id", meeting_id).execute()


def insert_topic_segments(meeting_id: str, topics: list[dict[str, Any]]) -> dict[str, str]:
    """Insert topic_segments. Returns mapping {title.lower(): topic_id} so that
    action_items / decisions / open_questions can later link via topic_hint."""
    if not topics:
        return {}
    rows = []
    for i, t in enumerate(topics):
        rows.append(
            {
                "meeting_id": meeting_id,
                "title": t.get("title") or "(未命名)",
                "summary": t.get("summary"),
                "start_seconds": float(t["start_seconds"]),
                "end_seconds": float(t["end_seconds"]),
                "ordinal": i,
            }
        )
    res = get_client().table("topic_segments").insert(rows).execute()
    data = res.data or []
    logger.info("inserted %d topic_segments for meeting %s", len(data), meeting_id)
    return {row["title"].lower(): row["id"] for row in data}


def insert_action_items(
    meeting_id: str,
    items: list[dict[str, Any]],
    topic_id_by_title: Optional[dict[str, str]] = None,
    members: Optional[list[dict[str, Any]]] = None,
) -> int:
    """Insert action_items, resolving owner_member_id from owner_raw_name when
    possible (case-insensitive substring match against members.name)."""
    if not items:
        return 0
    topic_map = topic_id_by_title or {}

    meta = get_meeting_meta(meeting_id)
    if members is None:
        members = get_org_members(meta["org_id"]) if (meta and meta.get("org_id")) else []

    # Phase 15: 對應「會議建立者」的 member.id，所有 action_item 共用同一個
    creator_member_id = get_creator_member_id(meta) if meta else None

    rows = []
    for it in items:
        hint = (it.get("topic_hint") or "").lower()
        resolved_id = _resolve_owner_id(it.get("owner_raw_name"), members)
        rows.append(
            {
                "meeting_id": meeting_id,
                "topic_segment_id": topic_map.get(hint),
                "description": it["description"],
                "owner_member_id": resolved_id,
                "owner_raw_name": it.get("owner_raw_name"),
                "due_date": it.get("due_date"),
                "due_date_raw": it.get("due_date_raw"),
                "source_quote": it["source_quote"],
                "source_start_seconds": float(it["source_start_seconds"]),
                "source_speaker": it.get("source_speaker"),
                "confidence": float(it["confidence"]),
                "needs_clarification": it.get("needs_clarification"),
                "created_by_member_id": creator_member_id,
            }
        )
    res = get_client().table("action_items").insert(rows).execute()
    n = len(res.data or [])
    matched = sum(1 for r in rows if r["owner_member_id"])
    logger.info(
        "inserted %d action_items for meeting %s (%d/%d owner resolved)",
        n, meeting_id, matched, n,
    )
    return n


def _resolve_owner_id(raw_name: Optional[str], members: list[dict[str, Any]]) -> Optional[str]:
    """Match a raw name like '業務部 Peter' or 'Mark' against members.name.

    Strategy (most-specific first):
      1. Exact case-insensitive match on member.name
      2. raw_name contains member.name ('業務部 Peter' contains 'Peter')
      3. member.name contains raw_name
    Returns None if no match — caller writes owner_raw_name only.
    """
    if not raw_name or not members:
        return None
    rn = raw_name.strip().lower()
    if not rn:
        return None

    for m in members:
        n = (m.get("name") or "").strip().lower()
        if n and n == rn:
            return m["id"]
    for m in members:
        n = (m.get("name") or "").strip().lower()
        if n and n in rn:
            return m["id"]
    for m in members:
        n = (m.get("name") or "").strip().lower()
        if n and rn in n:
            return m["id"]
    return None


def insert_decisions(
    meeting_id: str,
    decisions: list[dict[str, Any]],
    topic_id_by_title: Optional[dict[str, str]] = None,
) -> int:
    if not decisions:
        return 0
    topic_map = topic_id_by_title or {}
    rows = []
    for d in decisions:
        hint = (d.get("topic_hint") or "").lower()
        rows.append(
            {
                "meeting_id": meeting_id,
                "topic_segment_id": topic_map.get(hint),
                "description": d["description"],
                "source_quote": d["source_quote"],
                "source_start_seconds": float(d["source_start_seconds"]),
                "agreed_by_member_ids": [],  # raw names → member id resolution deferred
                "confidence": d.get("confidence"),
            }
        )
    res = get_client().table("decisions").insert(rows).execute()
    n = len(res.data or [])
    logger.info("inserted %d decisions for meeting %s", n, meeting_id)
    return n


def insert_open_questions(
    meeting_id: str,
    questions: list[dict[str, Any]],
    topic_id_by_title: Optional[dict[str, str]] = None,
) -> int:
    if not questions:
        return 0
    topic_map = topic_id_by_title or {}
    rows = []
    for q in questions:
        hint = (q.get("topic_hint") or "").lower()
        rows.append(
            {
                "meeting_id": meeting_id,
                "topic_segment_id": topic_map.get(hint),
                "question": q["question"],
                "source_quote": q.get("source_quote"),
                "source_start_seconds": q.get("source_start_seconds"),
                "raised_by_speaker": q.get("raised_by_speaker"),
            }
        )
    res = get_client().table("open_questions").insert(rows).execute()
    n = len(res.data or [])
    logger.info("inserted %d open_questions for meeting %s", n, meeting_id)
    return n


def get_org_members(org_id: str) -> list[dict[str, Any]]:
    res = get_client().table("members").select("id, name, email").eq("org_id", org_id).execute()
    return res.data or []


def get_org_members_with_embeddings(org_id: str) -> list[dict[str, Any]]:
    res = (
        get_client()
        .table("members")
        .select("id, name, voice_embedding")
        .eq("org_id", org_id)
        .not_.is_("voice_embedding", "null")
        .execute()
    )
    return res.data or []


def update_member_voice_embedding(member_id: str, embedding: list[float]) -> None:
    from datetime import datetime, timezone

    get_client().table("members").update(
        {
            "voice_embedding": embedding,
            "enrolled_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", member_id).execute()


def get_meeting_meta(meeting_id: str) -> Optional[dict[str, Any]]:
    res = get_client().table("meetings").select("id, org_id, title, language, created_at, created_by").eq("id", meeting_id).single().execute()
    return res.data


def get_creator_member_id(meeting_meta: dict[str, Any]) -> Optional[str]:
    """Phase 15: 影響圈圖譜需要 action_item.created_by_member_id。
    Spec：「沒主持人就用 meetings.created_by 對應的 member_id」。"""
    created_by = meeting_meta.get("created_by")
    org_id = meeting_meta.get("org_id")
    if not created_by or not org_id:
        return None
    res = (
        get_client()
        .table("members")
        .select("id")
        .eq("user_id", created_by)
        .eq("org_id", org_id)
        .maybeSingle()
        .execute()
    )
    if not res.data:
        return None
    return res.data["id"]


def ensure_meeting_exists(meeting_id: str, org_id: str, title: str = "Smoke test") -> None:
    """Used by smoke tests when calling /process directly without going through
    the Next.js upload flow. Inserts a placeholder meetings row if missing.
    Idempotent."""
    client = get_client()
    existing = client.table("meetings").select("id").eq("id", meeting_id).execute()
    if existing.data:
        return
    client.table("meetings").insert(
        {
            "id": meeting_id,
            "org_id": org_id,
            "title": title,
            "status": "processing",
        }
    ).execute()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _approx_confidence(avg_logprob: Optional[float]) -> Optional[float]:
    if avg_logprob is None:
        return None
    # Map typical Whisper avg_logprob range [-1.0, 0.0] → [0, 1]
    import math

    return round(max(0.0, min(1.0, math.exp(avg_logprob))), 3)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
