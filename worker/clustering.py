"""
Phase 2: Topic clustering across meetings.

Workflow per new meeting:
  1. For each freshly-inserted topic_segment, compute OpenAI embedding of
     (title + summary).
  2. Find best matching topic_cluster (same org) by cosine similarity.
  3. If best >= COSINE_THRESHOLD (0.75) → join cluster, update centroid as
     running average. Else → create new cluster with this topic as the seed.
  4. Write `embedding` and `cluster_id` back to topic_segments.

Conservative threshold (0.75) — better to fragment than wrongly merge,
mirrors the Resemblyzer voice-match philosophy in the rest of the project.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import numpy as np

logger = logging.getLogger(__name__)

# 與 Resemblyzer 0.82 同樣保守原則：寧可碎片化也不要錯合併
COSINE_THRESHOLD = 0.75
EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
# text-embedding-3-small 預設 1536 維（schema 鎖住這個維度）
EMBEDDING_DIM = 1536

_openai_client = None


def get_openai_client():
    """Embedding 用的 OpenAI client（與 Phase 11 strict-llm 的 client 共用 openai 套件）。"""
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI  # type: ignore

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY 未設定。Phase 2 議題聚類需要它計算 embedding；"
                "spec 提到也可換 Cohere / Voyage 等更便宜方案。"
            )
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client


def embed_text(text: str) -> list[float]:
    """單一字串 → 1536 維 embedding。"""
    resp = get_openai_client().embeddings.create(
        model=EMBEDDING_MODEL,
        input=text[:8000],  # OpenAI 限 8K input tokens；截斷防意外
    )
    return list(resp.data[0].embedding)


def embed_topics_text(topics: list[dict[str, Any]]) -> list[list[float]]:
    """批次:一場會議的所有 topic 一次呼叫 embeddings API。"""
    if not topics:
        return []
    inputs = [
        f"{t.get('title', '')}\n{(t.get('summary') or '')}".strip()[:8000]
        for t in topics
    ]
    resp = get_openai_client().embeddings.create(model=EMBEDDING_MODEL, input=inputs)
    return [list(d.embedding) for d in resp.data]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    na = np.linalg.norm(va)
    nb = np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def cluster_topics_for_meeting(sb_client, meeting_id: str, org_id: str) -> int:
    """高層 wrapper：抓該會議所有還沒 embedding 的 topic，算 embedding 並指派 cluster。
    回傳:成功處理的 topic 數量。
    """
    res = (
        sb_client
        .table("topic_segments")
        .select("id, title, summary")
        .eq("meeting_id", meeting_id)
        .is_("embedding", "null")
        .execute()
    )
    topics = res.data or []
    if not topics:
        return 0
    try:
        embeddings = embed_topics_text(topics)
    except Exception:
        logger.exception("embedding API call failed; skipping cluster assignment")
        return 0
    assign_topics_to_clusters(sb_client, org_id, topics, embeddings)
    return len(topics)


def assign_topics_to_clusters(
    sb_client,  # supabase Client
    org_id: str,
    topic_rows: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> None:
    """
    為一場會議的所有 topic 找 cluster 並更新。

    sb_client: worker/db.py 的 get_client()（service-role）
    topic_rows: insert_topic_segments 回來的 row 字典(含 id, title, summary, ...)
    embeddings: 對應每個 topic 的 embedding 向量
    """
    if not topic_rows:
        return
    assert len(topic_rows) == len(embeddings), "topics 與 embeddings 長度不一致"

    # 1. 撈該 org 所有現存 cluster
    res = (
        sb_client
        .table("topic_clusters")
        .select("id, canonical_title, centroid, member_count")
        .eq("org_id", org_id)
        .execute()
    )
    clusters: list[dict[str, Any]] = res.data or []
    # parse centroid 字串 → list[float]（supabase-py 回字串如 "[0.1,0.2,...]"）
    for c in clusters:
        c["centroid_vec"] = _parse_vector(c.get("centroid"))

    for topic, emb in zip(topic_rows, embeddings):
        cluster_id, joined_existing = _match_or_create_cluster(
            sb_client, org_id, topic, emb, clusters
        )
        # 寫回 topic_segments
        sb_client.table("topic_segments").update(
            {"embedding": emb, "cluster_id": cluster_id}
        ).eq("id", topic["id"]).execute()

        if joined_existing:
            logger.info(
                "topic '%s' joined cluster %s", topic.get("title"), cluster_id
            )
        else:
            logger.info(
                "topic '%s' seeded new cluster %s", topic.get("title"), cluster_id
            )


def _match_or_create_cluster(
    sb_client,
    org_id: str,
    topic: dict[str, Any],
    emb: list[float],
    clusters: list[dict[str, Any]],
) -> tuple[str, bool]:
    """Returns (cluster_id, joined_existing)."""
    best_id: Optional[str] = None
    best_sim = -1.0
    for c in clusters:
        if not c["centroid_vec"]:
            continue
        sim = cosine_similarity(emb, c["centroid_vec"])
        if sim > best_sim:
            best_sim = sim
            best_id = c["id"]

    if best_id is not None and best_sim >= COSINE_THRESHOLD:
        # 加入現有 cluster，更新 centroid（running average）
        cluster = next(c for c in clusters if c["id"] == best_id)
        new_count = (cluster.get("member_count") or 0) + 1
        old_centroid = np.asarray(cluster["centroid_vec"], dtype=np.float32)
        new_centroid = (old_centroid * (new_count - 1) + np.asarray(emb, dtype=np.float32)) / new_count

        sb_client.table("topic_clusters").update(
            {
                "centroid": new_centroid.tolist(),
                "member_count": new_count,
                "updated_at": _now_iso(),
                # invalidate cached LLM 摘要（內容變了，要重算）
                "current_state_summary": None,
                "current_state_at": None,
            }
        ).eq("id", best_id).execute()
        # 更新 local cache 以便同批次後續 topic 看到最新 centroid
        cluster["centroid_vec"] = new_centroid.tolist()
        cluster["member_count"] = new_count
        return best_id, True

    # 開新 cluster
    new_row = {
        "org_id": org_id,
        "canonical_title": topic.get("title") or "(未命名)",
        "centroid": emb,
        "member_count": 1,
    }
    res = sb_client.table("topic_clusters").insert(new_row).select("id").execute()
    new_id = (res.data or [{}])[0].get("id")
    if not new_id:
        # 萬一 insert 沒回 id（不太可能），fallback 撈一下
        logger.warning("insert topic_clusters returned no id, refetching")
        find = (
            sb_client.table("topic_clusters")
            .select("id")
            .eq("org_id", org_id)
            .eq("canonical_title", new_row["canonical_title"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        new_id = (find.data or [{}])[0].get("id")

    if new_id:
        clusters.append(
            {
                "id": new_id,
                "canonical_title": new_row["canonical_title"],
                "centroid_vec": emb,
                "member_count": 1,
            }
        )
    return new_id, False


def _parse_vector(raw) -> Optional[list[float]]:
    """supabase-py 對 vector 欄位有時回字串 '[0.1,0.2,…]'，有時回 list。"""
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        s = raw.strip().lstrip("[").rstrip("]")
        if not s:
            return None
        return [float(x) for x in s.split(",")]
    return None


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
