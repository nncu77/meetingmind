'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, FileType, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Format = 'pdf' | 'docx';

export default function ExportDropdown({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside / Escape to close
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function download(format: Format) {
    setError(null);
    setBusy(format);
    setOpen(false);
    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/export?format=${format}`,
        { method: 'GET' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? `匯出失敗（${res.status}）`);
        return;
      }
      // Build a download from the response blob + filename header
      const blob = await res.blob();
      const dispo = res.headers.get('content-disposition') ?? '';
      const filename = parseFilename(dispo) ?? `meeting.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so the download has time to start
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {busy === 'pdf' ? '匯出 PDF...' : busy === 'docx' ? '匯出 Word...' : '匯出'}
      </button>

      {open && busy === null ? (
        <div
          className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
          role="menu"
        >
          <button
            type="button"
            onClick={() => download('pdf')}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50',
            )}
            role="menuitem"
          >
            <FileText className="h-4 w-4 text-rose-600" />
            下載 PDF
          </button>
          <button
            type="button"
            onClick={() => download('docx')}
            className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            role="menuitem"
          >
            <FileType className="h-4 w-4 text-blue-600" />
            下載 Word
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow-lg">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 font-medium text-rose-900 underline"
          >
            關閉
          </button>
        </div>
      ) : null}
    </div>
  );
}

function parseFilename(dispo: string): string | null {
  // Prefer RFC 5987 filename* (UTF-8 encoded)
  const star = /filename\*=UTF-8''([^;]+)/i.exec(dispo);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(dispo);
  if (plain) return plain[1];
  return null;
}
