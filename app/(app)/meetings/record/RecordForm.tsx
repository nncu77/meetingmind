'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PrivacyLevelPicker, { type PrivacyLevel } from '../PrivacyLevelPicker';

type Phase =
  | 'idle'        // not started yet, awaiting title + record click
  | 'recording'   // active recording
  | 'paused'      // recording paused (user-initiated)
  | 'reviewing'   // recording stopped, blob available, awaiting upload
  | 'uploading'   // POST → PUT → PATCH in progress
  | 'error';

const TARGET_BITRATE = 64_000; // opus 64 kbps mono ~ 480 KB/min → 28 MB / 60 min

export default function RecordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<'zh' | 'zh-en'>('zh');
  const [privacy, setPrivacy] = useState<PrivacyLevel>('standard');
  const [confidential, setConfidential] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [progress, setProgress] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) window.clearInterval(tickRef.current);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTick() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
  }
  function stopTick() {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function start() {
    setError(null);
    if (!title.trim()) {
      setError('請先填會議標題');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const mime = pickMime();
      const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: TARGET_BITRATE });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mr.mimeType });
        setBlob(finalBlob);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        setBlobUrl(URL.createObjectURL(finalBlob));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        stopTick();
        setPhase('reviewing');
      };
      mr.onerror = (ev) => {
        setError(`錄音錯誤:${(ev as unknown as { error?: Error }).error?.message ?? 'unknown'}`);
        setPhase('error');
      };

      mrRef.current = mr;
      // request data every 5s so chunksRef accumulates (in case of crash recovery later)
      mr.start(5000);
      setElapsedSec(0);
      setPhase('recording');
      startTick();
    } catch (e) {
      setError(
        e instanceof Error
          ? `無法存取麥克風:${e.message}`
          : '無法存取麥克風(請允許瀏覽器麥克風權限)',
      );
    }
  }

  function pause() {
    if (mrRef.current?.state === 'recording') {
      mrRef.current.pause();
      stopTick();
      setPhase('paused');
    }
  }

  function resume() {
    if (mrRef.current?.state === 'paused') {
      mrRef.current.resume();
      startTick();
      setPhase('recording');
    }
  }

  function stop() {
    if (mrRef.current && (mrRef.current.state === 'recording' || mrRef.current.state === 'paused')) {
      mrRef.current.stop();
    }
  }

  function discard() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl(null);
    setElapsedSec(0);
    setPhase('idle');
    setError(null);
  }

  async function upload() {
    if (!blob) return;
    setPhase('uploading');
    setError(null);
    setProgress(0);
    try {
      const ext = mimeToExt(blob.type);
      const filename = `${slugify(title)}-${Date.now()}.${ext}`;

      // Step 1: POST metadata → get signed URL
      const prepRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          filename,
          contentType: blob.type || 'audio/webm',
          sizeBytes: blob.size,
          durationSeconds: elapsedSec,
          language,
          privacyLevel: privacy,
          isConfidential: confidential,
        }),
      });
      if (!prepRes.ok) {
        const j = await prepRes.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${prepRes.status}`);
      }
      const prep = (await prepRes.json()) as {
        meetingId: string;
        uploadUrl: string;
        objectPath: string;
      };

      // Step 2: PUT to signed URL
      await putWithProgress(prep.uploadUrl, blob, (pct) => setProgress(pct));

      // Step 3: PATCH /api/upload → trigger Inngest
      const finRes = await fetch('/api/upload', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: prep.meetingId,
          objectPath: prep.objectPath,
          durationSeconds: elapsedSec,
        }),
      });
      if (!finRes.ok) {
        const j = await finRes.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${finRes.status}`);
      }
      router.push(`/meetings/${prep.meetingId}`);
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : '上傳失敗');
    }
  }

  const recording = phase === 'recording' || phase === 'paused';
  const setupDisabled = phase !== 'idle' && phase !== 'error';
  const estMB = blob ? (blob.size / 1024 / 1024).toFixed(2) : null;

  return (
    <div className="space-y-5">
      {/* Setup section */}
      <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="title">
            會議標題
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例:Q3 預算審議會議"
            required
            maxLength={200}
            disabled={setupDisabled}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="lang">
              語言
            </label>
            <select
              id="lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'zh-en')}
              disabled={setupDisabled}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="zh">中文</option>
              <option value="zh-en">中文 + 英文夾雜</option>
            </select>
          </div>
        </div>

        <PrivacyLevelPicker value={privacy} onChange={setPrivacy} disabled={setupDisabled} />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confidential}
            onChange={(e) => setConfidential(e.target.checked)}
            disabled={setupDisabled}
            className="h-4 w-4 rounded border-slate-300"
          />
          標記為機密(僅自己看得到)
        </label>
      </div>

      {/* Recording controls */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        {phase === 'idle' || phase === 'error' ? (
          <button
            type="button"
            onClick={start}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-rose-600 px-6 py-4 text-base font-semibold text-white transition hover:bg-rose-700"
          >
            <span className="h-3 w-3 rounded-full bg-white" /> 開始錄音
          </button>
        ) : null}

        {recording && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <span
                className={`h-3 w-3 rounded-full ${
                  phase === 'recording' ? 'animate-pulse bg-rose-500' : 'bg-slate-400'
                }`}
              />
              <span className="font-mono text-4xl font-semibold tabular-nums text-slate-900">
                {fmtElapsed(elapsedSec)}
              </span>
              <span className="text-sm text-slate-500">
                {phase === 'recording' ? '錄音中' : '已暫停'}
              </span>
            </div>

            <p className="text-center text-xs text-slate-500">
              ≈ {(elapsedSec * TARGET_BITRATE / 8 / 1024 / 1024).toFixed(1)} MB ·
              {' '}50 MB 上限可錄約 {Math.floor(50 * 1024 * 1024 * 8 / TARGET_BITRATE / 60)} 分鐘
            </p>

            <div className="grid grid-cols-2 gap-2">
              {phase === 'recording' ? (
                <button
                  type="button"
                  onClick={pause}
                  className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  ⏸ 暫停
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resume}
                  className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  ▶ 繼續
                </button>
              )}
              <button
                type="button"
                onClick={stop}
                className="rounded-md bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-700"
              >
                ■ 停止
              </button>
            </div>
          </div>
        )}

        {phase === 'reviewing' && blob && (
          <div className="space-y-3">
            <div className="text-center">
              <p className="font-mono text-2xl text-slate-900">{fmtElapsed(elapsedSec)}</p>
              <p className="text-xs text-slate-500">
                {estMB} MB · {blob.type}
              </p>
            </div>
            {blobUrl && <audio controls src={blobUrl} className="w-full" />}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={discard}
                className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                重錄
              </button>
              <button
                type="button"
                onClick={upload}
                className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                上傳並處理
              </button>
            </div>
          </div>
        )}

        {phase === 'uploading' && (
          <div className="space-y-3">
            <p className="text-center text-sm text-slate-700">
              上傳中… {progress}%
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}
      </div>
    </div>
  );
}

function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}

function mimeToExt(mime: string): string {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function slugify(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'recording';
}

async function putWithProgress(url: string, blob: Blob, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', blob.type || 'audio/webm');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(blob);
  });
}
