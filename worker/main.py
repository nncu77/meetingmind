"""
MeetingMind Python worker — FastAPI app deployed on Modal.

Run locally:
    cd worker
    uvicorn main:app --reload --port 8001

Deploy to Modal:
    modal deploy modal_app.py
"""
from __future__ import annotations

import logging
import os
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

# Enable INFO logging across the worker. uvicorn's default config silences
# library loggers; this overrides so we can see pyannote / STT / DB write-back.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from transcribe import run_transcription_pipeline
from voice_match import enroll_voice, match_voice
from db import ensure_meeting_exists

app = FastAPI(title="MeetingMind Worker", version="0.1.0")

WORKER_SHARED_SECRET = os.environ.get("WORKER_SHARED_SECRET", "")


def _check_auth(authorization: str | None) -> None:
    if not WORKER_SHARED_SECRET:
        # local dev — allow
        return
    expected = f"Bearer {WORKER_SHARED_SECRET}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid worker token")


# ---------------------------------------------------------------------------
# /process — main transcription + diarization + extraction pipeline
# ---------------------------------------------------------------------------


class ProcessRequest(BaseModel):
    meeting_id: str
    audio_url: str
    language: Literal["zh", "zh-en"] = "zh"
    privacy_level: Literal["standard", "enhanced", "strict"] = "standard"
    # For smoke tests that bypass the Next.js upload flow — if set, the worker
    # will ensure a meetings row exists with this org_id before write-back.
    # Production calls coming through /api/upload always have the row pre-created.
    dev_org_id: str | None = None


class ProcessResponse(BaseModel):
    meeting_id: str
    status: str
    segments_count: int = 0
    action_items_count: int = 0


@app.post("/process", response_model=ProcessResponse)
def process_meeting(
    payload: ProcessRequest,
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)

    # Smoke-test convenience: when calling /process directly without Next.js,
    # ensure a meetings row exists so the write-back step has something to update.
    if payload.dev_org_id:
        ensure_meeting_exists(payload.meeting_id, payload.dev_org_id)

    # Inngest waits for this HTTP call to return, but the heavy work runs
    # synchronously here so we surface failures (Inngest will retry on 5xx).
    # For >10min jobs, switch to async + webhook pattern.
    result = run_transcription_pipeline(
        meeting_id=payload.meeting_id,
        audio_url=payload.audio_url,
        language=payload.language,
        privacy_level=payload.privacy_level,
    )
    return ProcessResponse(
        meeting_id=payload.meeting_id,
        status="done",
        segments_count=result.segments_count,
        action_items_count=result.action_items_count,
    )


# ---------------------------------------------------------------------------
# /voice/enroll — register a member's voice from 3 short clips
# ---------------------------------------------------------------------------


class EnrollRequest(BaseModel):
    member_id: str
    audio_urls: list[str] = Field(min_length=1, max_length=5)


class EnrollResponse(BaseModel):
    member_id: str
    embedding_dim: int


@app.post("/voice/enroll", response_model=EnrollResponse)
def voice_enroll(
    payload: EnrollRequest,
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)
    embedding = enroll_voice(payload.member_id, payload.audio_urls)
    return EnrollResponse(member_id=payload.member_id, embedding_dim=len(embedding))


# ---------------------------------------------------------------------------
# /voice/match — ad-hoc match of an audio clip against the org's voice library
# ---------------------------------------------------------------------------


class MatchRequest(BaseModel):
    org_id: str
    audio_url: str
    start_seconds: float
    end_seconds: float


class MatchHit(BaseModel):
    member_id: str
    confidence: float


@app.post("/voice/match", response_model=list[MatchHit])
def voice_match(
    payload: MatchRequest,
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)
    hits = match_voice(
        org_id=payload.org_id,
        audio_url=payload.audio_url,
        start_seconds=payload.start_seconds,
        end_seconds=payload.end_seconds,
    )
    return [MatchHit(**h) for h in hits]


@app.get("/health")
def health():
    return {"ok": True}
