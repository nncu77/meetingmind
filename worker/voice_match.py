"""
Resemblyzer-based voice enrollment + matching.

Threshold note: Resemblyzer was trained on English (LibriSpeech). For Mandarin
speakers we use a conservative cosine-similarity threshold (≥ 0.82) — better to
mark a speaker as 「未知」 than to wrongly attribute a quote to the wrong member
(spec section 1.1 — the Peter/Mark story).
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx
import numpy as np

logger = logging.getLogger(__name__)

# Tuned conservative for Mandarin speakers (Resemblyzer trained on English).
MATCH_THRESHOLD = 0.82

_encoder = None


def get_encoder():
    global _encoder
    if _encoder is None:
        from resemblyzer import VoiceEncoder

        logger.info("Loading Resemblyzer VoiceEncoder")
        _encoder = VoiceEncoder()
    return _encoder


def _download(url: str, dst: Path) -> Path:
    with httpx.stream("GET", url, timeout=60.0, follow_redirects=True) as r:
        r.raise_for_status()
        with dst.open("wb") as f:
            for chunk in r.iter_bytes(chunk_size=1 << 16):
                f.write(chunk)
    return dst


def _to_wav_mono16k(src: Path) -> Path:
    """Resemblyzer's preprocess_wav wants a wav at any rate, but we standardise
    to 16 kHz mono PCM via ffmpeg to be safe across webm/opus/m4a inputs."""
    if src.suffix.lower() == ".wav":
        return src
    import ffmpeg

    dst = src.with_suffix(".wav")
    (
        ffmpeg.input(str(src))
        .output(str(dst), ac=1, ar=16000, format="wav", acodec="pcm_s16le")
        .overwrite_output()
        .run(quiet=True)
    )
    return dst


def _embed_audio(path: Path) -> np.ndarray:
    from resemblyzer import preprocess_wav

    wav_path = _to_wav_mono16k(path)
    wav = preprocess_wav(wav_path)
    encoder = get_encoder()
    return encoder.embed_utterance(wav)


def enroll_voice(member_id: str, audio_urls: list[str]) -> list[float]:
    """Average the embeddings of N enrollment clips → write to
    members.voice_embedding (pgvector). Returns the embedding."""
    from db import update_member_voice_embedding

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        embeddings = []
        for i, url in enumerate(audio_urls):
            # Use unique filenames so transcoding doesn't collide
            clip_in = _download(url, tmpdir / f"enroll_{i}.bin")
            # Add a fake extension hint so ffmpeg auto-detects; resemblyzer is
            # forgiving when we hand it a real wav
            with_ext = clip_in.rename(tmpdir / f"enroll_{i}.webm")
            emb = _embed_audio(with_ext)
            embeddings.append(emb)

        mean = np.mean(embeddings, axis=0)
        mean = mean / (np.linalg.norm(mean) + 1e-12)  # L2 normalise
        emb_list = mean.astype(float).tolist()

        update_member_voice_embedding(member_id, emb_list)
        logger.info(
            "enrolled voice for member %s: %d clips → %d-dim embedding",
            member_id, len(audio_urls), len(emb_list),
        )
        return emb_list


def match_voice(
    org_id: str,
    audio_url: str,
    start_seconds: float,
    end_seconds: float,
) -> list[dict[str, Any]]:
    """Embed the [start, end] clip and return ranked member matches above MATCH_THRESHOLD."""
    from db import get_org_members_with_embeddings

    # Download + clip + embed
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        full = _download(audio_url, tmpdir / "input.audio")

        import ffmpeg

        clip = tmpdir / "clip.wav"
        duration = max(0.5, float(end_seconds) - float(start_seconds))
        (
            ffmpeg.input(str(full), ss=float(start_seconds), t=duration)
            .output(str(clip), ac=1, ar=16000, format="wav", acodec="pcm_s16le")
            .overwrite_output()
            .run(quiet=True)
        )
        target_emb = _embed_audio(clip)

    target_emb = target_emb / (np.linalg.norm(target_emb) + 1e-12)

    members = get_org_members_with_embeddings(org_id)
    hits = []
    for m in members:
        emb = m.get("voice_embedding")
        if not emb:
            continue
        member_emb = np.array(emb, dtype=np.float32)
        member_emb = member_emb / (np.linalg.norm(member_emb) + 1e-12)
        sim = float(np.dot(target_emb, member_emb))
        if sim >= MATCH_THRESHOLD:
            hits.append({"member_id": m["id"], "confidence": round(sim, 3)})
    hits.sort(key=lambda h: h["confidence"], reverse=True)
    return hits
