"""
Transcription pipeline: ffmpeg → pyannote diarization → STT backend (Groq/local)
→ align → Resemblyzer match → Claude tool-use extraction → Supabase write.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from stt import transcribe_audio
from db import (
    insert_speaker_segments,
    insert_transcript_segments,
    insert_topic_segments,
    insert_action_items,
    insert_decisions,
    insert_open_questions,
    update_meeting_completed,
    update_meeting_failed,
    get_meeting_meta,
)
from extract import extract_all, MeetingContext, privacy_to_provider

logger = logging.getLogger(__name__)

_diarization_pipeline = None


@dataclass
class PipelineResult:
    segments_count: int
    action_items_count: int
    cost_estimate_cents: int


# ---------------------------------------------------------------------------
# Model loaders
# ---------------------------------------------------------------------------


def get_diarization():
    """pyannote.audio 3.1 — gated model, needs HF_TOKEN."""
    global _diarization_pipeline
    if _diarization_pipeline is None:
        from pyannote.audio import Pipeline

        hf_token = os.environ["HF_TOKEN"]
        logger.info("Loading pyannote/speaker-diarization-3.1")
        _diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
        try:
            import torch

            if torch.cuda.is_available():
                _diarization_pipeline.to(torch.device("cuda"))
        except ImportError:
            pass
    return _diarization_pipeline


# ---------------------------------------------------------------------------
# Audio download + preprocessing
# ---------------------------------------------------------------------------


def download_audio(url: str, dest: Path) -> Path:
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes(chunk_size=1 << 16):
                f.write(chunk)
    return dest


def normalise_to_wav(src: Path, dst: Path) -> Path:
    """Downmix to mono 16 kHz WAV — required by pyannote and the local Whisper backend."""
    import ffmpeg

    (
        ffmpeg.input(str(src))
        .output(str(dst), ac=1, ar=16000, format="wav", acodec="pcm_s16le")
        .overwrite_output()
        .run(quiet=True)
    )
    return dst


def probe_duration_seconds(path: Path) -> float:
    """Return audio duration in seconds via ffprobe."""
    import ffmpeg

    info = ffmpeg.probe(str(path))
    return float(info["format"]["duration"])


# ---------------------------------------------------------------------------
# Diarization + alignment
# ---------------------------------------------------------------------------


def diarize(wav_path: Path) -> list[dict[str, Any]]:
    """Returns [{speaker, start, end}] from pyannote."""
    pipeline = get_diarization()
    diarization = pipeline(str(wav_path))
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            {
                "speaker": speaker,
                "start": float(turn.start),
                "end": float(turn.end),
            }
        )
    return segments


def align_speakers(
    transcript_segs: list[dict[str, Any]],
    speaker_segs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """For each transcript segment, find the dominant speaker by overlap."""
    aligned = []
    for ts in transcript_segs:
        best_speaker, best_overlap = None, 0.0
        for ss in speaker_segs:
            overlap = max(0.0, min(ts["end"], ss["end"]) - max(ts["start"], ss["start"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = ss["speaker"]
        aligned.append({**ts, "speaker": best_speaker or "UNKNOWN"})
    return aligned


# ---------------------------------------------------------------------------
# Cost estimation (mirrors lib/cost/estimate.ts)
# ---------------------------------------------------------------------------

PRICES = {
    "modal_a10g_per_sec": 0.000306,
    "modal_l4_per_sec": 0.000222,
    "modal_cpu_per_sec": 0.0000375,
    "groq_paid_per_audio_sec": 0.0000308,
}


def _gpu_rate(tier: str) -> float:
    return {
        "a10g": PRICES["modal_a10g_per_sec"],
        "l4": PRICES["modal_l4_per_sec"],
        "cpu": PRICES["modal_cpu_per_sec"],
    }.get(tier, PRICES["modal_cpu_per_sec"])


def estimate_cost_cents(
    audio_sec: float,
    stt_backend: str,
    gpu_tier: str,
    is_cold_start: bool,
) -> int:
    """Conservative estimate. LLM tokens added later when extraction runs."""
    usd = 0.0
    if stt_backend == "local":
        factor = 10 if gpu_tier == "a10g" else 7 if gpu_tier == "l4" else 0.4
        usd += (audio_sec / factor) * _gpu_rate(gpu_tier)
    diar_factor = 5 if gpu_tier == "cpu" else 25
    usd += (audio_sec / diar_factor) * _gpu_rate(gpu_tier)
    if is_cold_start:
        cold_sec = 70 if stt_backend == "local" else 10
        usd += cold_sec * _gpu_rate(gpu_tier)
    import math

    return math.ceil(usd * 100)


# ---------------------------------------------------------------------------
# Pipeline orchestrator
# ---------------------------------------------------------------------------


def run_transcription_pipeline(
    meeting_id: str,
    audio_url: str,
    language: str,
    privacy_level: str,
) -> PipelineResult:
    """Top-level pipeline. Each stage is a separate function so we can stub
    individual steps in tests. The Supabase write-back is the last step so a
    crash mid-pipeline does not produce partial results."""
    stt_backend = os.environ.get("STT_BACKEND", "groq").lower()
    gpu_tier = os.environ.get("MODAL_GPU_TIER", "l4").lower()
    is_cold_start = _diarization_pipeline is None  # check before warmup

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            raw = download_audio(audio_url, tmpdir / "raw.audio")
            wav = normalise_to_wav(raw, tmpdir / "norm.wav")
            duration_sec = probe_duration_seconds(wav)

            speaker_segs = diarize(wav)
            transcript_segs = transcribe_audio(wav, language=language)
            aligned = align_speakers(transcript_segs, speaker_segs)

            cost_cents = estimate_cost_cents(
                audio_sec=duration_sec,
                stt_backend=stt_backend,
                gpu_tier=gpu_tier,
                is_cold_start=is_cold_start,
            )

            # First write the structural rows (transcript + speakers + meeting).
            # If extraction fails afterwards, at least the raw data lands.
            insert_speaker_segments(meeting_id, speaker_segs)
            insert_transcript_segments(meeting_id, aligned)

            # Claude tool-use extraction — 4 parallel-ish calls
            meta = get_meeting_meta(meeting_id) or {}
            meeting_date = (meta.get("created_at") or "")[:10] or "今天"
            unique_speakers = sorted({s["speaker"] for s in speaker_segs})
            ctx = MeetingContext(
                meeting_date=meeting_date,
                meeting_title=meta.get("title") or "(無標題)",
                attendees=[{"speaker_label": sp, "display_name": None} for sp in unique_speakers],
                language=language,
            )
            provider = privacy_to_provider(privacy_level)
            ext = extract_all(ctx, aligned, provider=provider)

            # Fetch members once for owner resolution
            from db import get_org_members  # noqa: WPS433

            org_members = (
                get_org_members(meta["org_id"]) if meta.get("org_id") else []
            )

            # Insert topic_segments first so action_items/decisions can FK-link
            topic_map = insert_topic_segments(meeting_id, ext.topics)
            action_items_n = insert_action_items(
                meeting_id, ext.action_items, topic_map, members=org_members
            )
            insert_decisions(meeting_id, ext.decisions, topic_map)
            insert_open_questions(meeting_id, ext.open_questions, topic_map)

            # Phase 2: 算 embedding + 指派 topic_cluster（跨會議聚類）
            # 失敗不阻擋會議完成，下次有 OPENAI_API_KEY 時可跑 backfill 補
            if meta.get("org_id") and ext.topics:
                try:
                    from clustering import cluster_topics_for_meeting  # noqa: WPS433

                    from db import get_client as _get_sb  # noqa: WPS433

                    n = cluster_topics_for_meeting(_get_sb(), meeting_id, meta["org_id"])
                    logger.info("topic clustering done: %d topics assigned", n)
                except Exception:
                    logger.exception(
                        "topic clustering failed (non-fatal); embeddings can be backfilled"
                    )

            # Recompute cost including LLM tokens
            from cost_estimate import add_llm_cost_cents  # noqa: WPS433 — local helper below

            cost_cents += add_llm_cost_cents(ext.input_tokens, ext.output_tokens)

            update_meeting_completed(
                meeting_id=meeting_id,
                duration_seconds=duration_sec,
                cost_estimate_cents=cost_cents,
                stt_backend=stt_backend,
                gpu_tier=gpu_tier,
                llm_input_tokens=ext.input_tokens,
                llm_output_tokens=ext.output_tokens,
                llm_provider=ext.provider,
            )

            # TODO Week 1 Day 8+: Resemblyzer voice matching against members table

            return PipelineResult(
                segments_count=len(aligned),
                action_items_count=action_items_n,
                cost_estimate_cents=cost_cents,
            )
    except Exception as e:
        logger.exception("pipeline failed for meeting %s", meeting_id)
        try:
            update_meeting_failed(meeting_id, str(e))
        except Exception:
            logger.exception("also failed to mark meeting failed")
        raise
