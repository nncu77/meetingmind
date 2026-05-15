"""
STT backend dispatch.

Backends:
  - "groq"  : Groq Cloud whisper-large-v3 over the OpenAI-compatible HTTP API.
              Free tier: 7,200 audio-seconds/day. No GPU cost. ~10x faster
              than local Whisper. Recommended default.
  - "local" : faster-whisper (CTranslate2) loaded into the worker process.
              Needs ~10 GB VRAM for large-v3. Use when offline / private.

Choose via env var STT_BACKEND. Default = "groq".
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Groq's /audio/transcriptions endpoint accepts files up to 25 MB.
# Anything bigger we re-encode to opus 32 kbps.
GROQ_MAX_BYTES = 24 * 1024 * 1024
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"

# Lazy local-model singleton (only loaded if backend=local)
_local_model = None


# OpenCC converter (lazy-initialised). s2twp = Simplified → Traditional (Taiwan,
# with phrase-level mappings: 软件→軟體 not just 軟件, etc.)
_cc_converter = None


def _to_traditional(text: str) -> str:
    global _cc_converter
    if _cc_converter is None:
        from opencc import OpenCC
        _cc_converter = OpenCC("s2twp")
    return _cc_converter.convert(text)


def transcribe_audio(wav_path: Path, language: str = "zh") -> list[dict[str, Any]]:
    """Return a list of {start, end, text, confidence, words[]} dicts.

    For zh* languages, text is converted to Traditional Chinese (Taiwan) before
    return. Groq Whisper and local Whisper both default to Simplified; we want
    Taiwan-friendly output across all downstream surfaces.
    """
    backend = os.environ.get("STT_BACKEND", "groq").lower()
    if backend == "groq":
        segments = _transcribe_groq(wav_path, language)
    elif backend == "local":
        segments = _transcribe_local(wav_path, language)
    else:
        raise ValueError(f"unknown STT_BACKEND={backend!r}")

    if language.startswith("zh"):
        for s in segments:
            s["text"] = _to_traditional(s["text"])
            for w in s.get("words", []):
                if "word" in w:
                    w["word"] = _to_traditional(w["word"])

    return segments


# ---------------------------------------------------------------------------
# Groq backend
# ---------------------------------------------------------------------------


def _transcribe_groq(wav_path: Path, language: str) -> list[dict[str, Any]]:
    api_key = os.environ["GROQ_API_KEY"]
    model = os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3")

    upload_path = _ensure_under_groq_limit(wav_path)
    logger.info(
        "Groq STT: model=%s, upload_bytes=%d, language=%s",
        model,
        upload_path.stat().st_size,
        language,
    )

    with upload_path.open("rb") as f:
        files = {"file": (upload_path.name, f, "audio/ogg" if upload_path.suffix == ".ogg" else "audio/wav")}
        data: dict[str, str] = {
            "model": model,
            "response_format": "verbose_json",
            "temperature": "0",
        }
        if language and language.startswith("zh"):
            data["language"] = "zh"

        with httpx.Client(timeout=600.0) as client:
            r = client.post(
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
            )
        r.raise_for_status()
        payload = r.json()

    return _normalise_openai_segments(payload)


def _ensure_under_groq_limit(wav_path: Path) -> Path:
    """If the wav is over Groq's 25 MB cap, re-encode to opus 32 kbps."""
    if wav_path.stat().st_size <= GROQ_MAX_BYTES:
        return wav_path

    import ffmpeg

    out = wav_path.with_suffix(".ogg")
    logger.info("Re-encoding %s → %s (opus 32k) to fit Groq 25 MB cap", wav_path.name, out.name)
    (
        ffmpeg.input(str(wav_path))
        .output(str(out), acodec="libopus", audio_bitrate="32k")
        .overwrite_output()
        .run(quiet=True)
    )
    return out


def _normalise_openai_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for s in payload.get("segments", []):
        out.append(
            {
                "start": float(s["start"]),
                "end": float(s["end"]),
                "text": str(s.get("text", "")).strip(),
                "confidence": s.get("avg_logprob"),
                "words": [],  # Groq verbose_json does not include word timestamps by default
            }
        )
    return out


# ---------------------------------------------------------------------------
# Local faster-whisper backend
# ---------------------------------------------------------------------------


def _get_local_model():
    global _local_model
    if _local_model is None:
        from faster_whisper import WhisperModel

        device = "cuda" if os.environ.get("CUDA_VISIBLE_DEVICES") else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        size = os.environ.get("LOCAL_WHISPER_MODEL", "large-v3")
        logger.info("Loading faster-whisper %s on %s (%s)", size, device, compute_type)
        _local_model = WhisperModel(size, device=device, compute_type=compute_type)
    return _local_model


def _transcribe_local(wav_path: Path, language: str) -> list[dict[str, Any]]:
    model = _get_local_model()
    segments_iter, _info = model.transcribe(
        str(wav_path),
        language="zh" if language.startswith("zh") else None,
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )
    out = []
    for s in segments_iter:
        out.append(
            {
                "start": s.start,
                "end": s.end,
                "text": s.text.strip(),
                "confidence": getattr(s, "avg_logprob", None),
                "words": [
                    {"start": w.start, "end": w.end, "word": w.word, "prob": w.probability}
                    for w in (s.words or [])
                ],
            }
        )
    return out
