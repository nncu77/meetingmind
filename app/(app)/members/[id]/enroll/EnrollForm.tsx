'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type ClipState = {
  blob: Blob | null;
  url: string | null;
};

const PROMPTS = [
  {
    tone: '日常語調',
    text: (name: string) =>
      `大家好,我是公司的 ${name || '某某'},今天天氣很好。`,
  },
  {
    tone: '商務語調',
    text: () => '關於這個專案,我建議我們先確認預算,再決定時程。',
  },
  {
    tone: '強調語氣',
    text: () => '我認為這非常重要,必須在這週解決。',
  },
];

type Phase = 'idle' | 'recording' | 'uploading' | 'done' | 'error';

export default function EnrollForm({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const router = useRouter();
  const [activeIdx, setActiveIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipState[]>(() =>
    PROMPTS.map(() => ({ blob: null, url: null })),
  );
  const [recordSeconds, setRecordSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      clips.forEach((c) => c.url && URL.revokeObjectURL(c.url));
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: pickMimeType() });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setClips((prev) => {
          const next = [...prev];
          if (next[activeIdx].url) URL.revokeObjectURL(next[activeIdx].url!);
          next[activeIdx] = { blob, url };
          return next;
        });
        stream.getTracks().forEach((t) => t.stop());
        if (tickRef.current) window.clearInterval(tickRef.current);
        setPhase('idle');
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setPhase('recording');
      setRecordSeconds(0);
      tickRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(
        e instanceof Error
          ? `無法存取麥克風:${e.message}`
          : '無法存取麥克風(請允許瀏覽器麥克風權限)',
      );
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  async function submitAll() {
    if (clips.some((c) => !c.blob)) {
      setError('三段都要錄完才能提交');
      return;
    }
    setPhase('uploading');
    setError(null);
    try {
      // Upload each clip → /api/voice/enroll handles multipart
      const fd = new FormData();
      fd.append('memberId', memberId);
      clips.forEach((c, i) => {
        if (c.blob) fd.append('clip', c.blob, `enroll-${i}.webm`);
      });
      const res = await fetch('/api/voice/enroll', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setPhase('done');
      router.push('/members');
      router.refresh();
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : '上傳失敗');
    }
  }

  const allDone = clips.every((c) => c.blob);
  const submitting = phase === 'uploading';

  return (
    <div className="space-y-4">
      {PROMPTS.map((p, idx) => {
        const isActive = idx === activeIdx;
        const recorded = !!clips[idx].blob;
        return (
          <div
            key={idx}
            className={`rounded-lg border bg-white p-4 shadow-sm ${
              isActive ? 'border-slate-900' : 'opacity-80'
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium text-slate-700">{p.tone}</span>
              </div>
              {recorded && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  ✓ 已錄
                </span>
              )}
            </div>
            <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-base leading-relaxed text-slate-800">
              {p.text(memberName)}
            </p>
            <div className="flex items-center gap-2">
              {isActive && phase === 'recording' ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
                >
                  ■ 停止 ({recordSeconds}s)
                </button>
              ) : isActive ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={submitting}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  ● {recorded ? '重錄' : '開始錄音'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  切到這段
                </button>
              )}
              {clips[idx].url && (
                <audio controls src={clips[idx].url!} className="h-9 flex-1" />
              )}
              {recorded && isActive && idx < PROMPTS.length - 1 && (
                <button
                  type="button"
                  onClick={() => setActiveIdx(idx + 1)}
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  下一段 →
                </button>
              )}
            </div>
          </div>
        );
      })}

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <button
        type="button"
        onClick={submitAll}
        disabled={!allDone || submitting}
        className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? '提交中…' : allDone ? '提交聲紋' : '錄完三段才能提交'}
      </button>
    </div>
  );
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}
