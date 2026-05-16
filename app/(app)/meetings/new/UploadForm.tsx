'use client';

import { useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import PrivacyLevelPicker, { type PrivacyLevel } from '../PrivacyLevelPicker';

type Phase = 'idle' | 'preparing' | 'uploading' | 'finalising' | 'done' | 'error';

export default function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<'zh' | 'zh-en'>('zh');
  const [privacy, setPrivacy] = useState<PrivacyLevel>('standard');
  const [confidential, setConfidential] = useState(false);

  async function getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Math.round(audio.duration));
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read audio duration'));
      };
      audio.src = url;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('請選擇音檔');
      return;
    }
    if (!title.trim()) {
      setError('請輸入會議標題');
      return;
    }

    try {
      // Step 1: get audio duration (client-side)
      setPhase('preparing');
      const duration = await getAudioDuration(file);

      // Step 2: POST metadata → get signed upload URL + meeting_id
      const prepRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          durationSeconds: duration,
          language,
          privacyLevel: privacy,
          isConfidential: confidential,
        }),
      });
      if (!prepRes.ok) {
        const j = await prepRes.json().catch(() => ({}));
        const msg = j.message || j.error || `HTTP ${prepRes.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      const prep = (await prepRes.json()) as {
        meetingId: string;
        uploadUrl: string;
        objectPath: string;
      };

      // Step 3: PUT file to Supabase Storage via signed URL (with progress)
      setPhase('uploading');
      await putWithProgress(prep.uploadUrl, file, (pct) => setProgress(pct));

      // Step 4: PATCH /api/upload to register completion + trigger Inngest
      setPhase('finalising');
      const finRes = await fetch('/api/upload', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: prep.meetingId,
          objectPath: prep.objectPath,
          durationSeconds: duration,
        }),
      });
      if (!finRes.ok) {
        const j = await finRes.json().catch(() => ({}));
        const msg = j.message || j.error || `HTTP ${finRes.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }

      setPhase('done');
      router.push(`/meetings/${prep.meetingId}`);
    } catch (err: unknown) {
      setPhase('error');
      setError(err instanceof Error ? err.message : '上傳失敗');
    }
  }

  const phaseLabel = {
    idle: '',
    preparing: '讀取音檔資訊…',
    uploading: `上傳中… ${progress}%`,
    finalising: '排程處理工作…',
    done: '完成,跳轉中…',
    error: '上傳失敗',
  }[phase];

  const submitting = phase !== 'idle' && phase !== 'error';

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border bg-white p-6 shadow-sm">
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
          disabled={submitting}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="file">
          音檔
        </label>
        <input
          ref={fileRef}
          id="file"
          type="file"
          accept="audio/*"
          required
          disabled={submitting}
          className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white file:transition hover:file:bg-slate-800"
        />
        <p className="mt-1 text-xs text-slate-500">支援格式:mp3 / m4a / wav / webm / ogg</p>
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
            disabled={submitting}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            <option value="zh">中文</option>
            <option value="zh-en">中文 + 英文夾雜</option>
          </select>
        </div>
      </div>

      <PrivacyLevelPicker value={privacy} onChange={setPrivacy} disabled={submitting} />

      <div className="flex items-center gap-2">
        <input
          id="confidential"
          type="checkbox"
          checked={confidential}
          onChange={(e) => setConfidential(e.target.checked)}
          disabled={submitting}
          className="h-4 w-4 rounded border-slate-300"
        />
        <label htmlFor="confidential" className="text-sm text-slate-700">
          標記為機密(僅自己看得到)
        </label>
      </div>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {phase === 'uploading' && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? phaseLabel : '開始處理'}
      </button>
    </form>
  );
}

// XHR upload with progress
async function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status} ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}
