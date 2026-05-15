"""
Modal deployment wrapper for the MeetingMind worker.

Deploy:
    modal deploy modal_app.py

After deploy, paste the returned endpoint into the Next.js env as WORKER_URL.

GPU choice: L4 ($0.80/hr) is plenty when STT_BACKEND=groq (Groq handles Whisper
remotely, worker only runs pyannote diarization ~2 GB VRAM). Saves 27% vs A10G.
For strict tier (self-hosted Llama 70B) we'd provision A100 separately.
"""
from __future__ import annotations

from pathlib import Path

import modal

WORKER_DIR = Path(__file__).parent

# Modal 1.x API: pip_install_from_requirements + add_local_dir on the image.
image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install_from_requirements(str(WORKER_DIR / "requirements.txt"))
    .add_local_dir(str(WORKER_DIR), remote_path="/app", ignore=[".venv", "__pycache__", "*.pyc"])
)

app = modal.App("meetingmind-worker")


@app.function(
    image=image,
    gpu="L4",
    secrets=[
        modal.Secret.from_name("meetingmind-secrets"),  # HF_TOKEN, SUPABASE_*, etc.
    ],
    timeout=900,                 # 15 min — enough for a 90-min meeting
    scaledown_window=300,        # keep warm 5 min between calls (was container_idle_timeout)
    max_containers=4,            # cap concurrent containers — protects spend cap
)
@modal.asgi_app()
def fastapi_app():
    import sys

    sys.path.insert(0, "/app")
    from main import app as web_app  # noqa: WPS433

    return web_app
