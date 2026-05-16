'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { ReviewData } from './page';
import SendEmailModal from './SendEmailModal';

const SPEAKER_COLORS = [
  'bg-blue-50 border-blue-300 text-blue-900',
  'bg-emerald-50 border-emerald-300 text-emerald-900',
  'bg-amber-50 border-amber-300 text-amber-900',
  'bg-violet-50 border-violet-300 text-violet-900',
  'bg-rose-50 border-rose-300 text-rose-900',
  'bg-cyan-50 border-cyan-300 text-cyan-900',
];

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function speakerColor(label: string | null) {
  if (!label) return 'bg-gray-50 border-gray-300 text-gray-700';
  const idx = parseInt(label.replace(/[^0-9]/g, '') || '0', 10) % SPEAKER_COLORS.length;
  return SPEAKER_COLORS[idx];
}

function confidenceClass(c: number) {
  if (c >= 0.85) return 'border-emerald-400 bg-emerald-50';
  if (c >= 0.65) return 'border-amber-400 bg-amber-50';
  return 'border-rose-400 bg-rose-50';
}

function confidenceLabel(c: number) {
  if (c >= 0.85) return '可信';
  if (c >= 0.65) return '建議複核';
  return '需要複核';
}

export default function MeetingReview({ data }: { data: ReviewData }) {
  const router = useRouter();
  const {
    meeting,
    transcriptSegments,
    topicSegments,
    actionItems,
    decisions,
    openQuestions,
    uniqueSpeakers,
  } = data;

  const audioRef = useRef<HTMLAudioElement>(null);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Auto-clear segment highlight after 3 seconds
  useEffect(() => {
    if (!highlightedSegmentId) return;
    const t = window.setTimeout(() => setHighlightedSegmentId(null), 3000);
    return () => window.clearTimeout(t);
  }, [highlightedSegmentId]);

  function seekTo(seconds: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = seconds;
    if (a.paused) a.play().catch(() => {});
  }

  function findTranscriptSegmentAt(seconds: number) {
    return transcriptSegments.find(
      (t) => seconds >= t.start_seconds && seconds < t.end_seconds,
    );
  }

  function handleSegmentClick(seg: { start_seconds: number; id: string }) {
    seekTo(seg.start_seconds);
    setHighlightedSegmentId(seg.id);
  }

  function handleActionItemClick(it: { source_start_seconds: number }) {
    seekTo(it.source_start_seconds);
    const seg = findTranscriptSegmentAt(it.source_start_seconds);
    if (seg) setHighlightedSegmentId(seg.id);
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim() || renameValue === renameTarget) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/rename-speaker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: renameTarget, to: renameValue.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRenameTarget(null);
      setRenameValue('');
      router.refresh();
    } catch (e) {
      alert('改名失敗:' + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setRenaming(false);
    }
  }

  const audioUrl = meeting.audio_url;

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{meeting.title}</h1>
          <p className="text-sm text-slate-500">
            {meeting.duration_seconds ? `${meeting.duration_seconds}s` : '—'} ·
            {' '}狀態：<span className="font-medium">{meeting.status}</span>
            {meeting.processed_at ? ` · 處理於 ${new Date(meeting.processed_at).toLocaleString('zh-TW')}` : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right text-sm text-slate-500">
          {meeting.status === 'done' ? (
            <SendEmailModal meetingId={meeting.id} />
          ) : null}
          {meeting.cost_estimate_cents != null && (
            <div>
              估算成本：
              <span className="font-mono font-semibold text-slate-800">
                ${(meeting.cost_estimate_cents / 100).toFixed(2)}
              </span>
            </div>
          )}
          {meeting.llm_input_tokens != null && (
            <div className="text-xs text-slate-400">
              tokens in/out: {meeting.llm_input_tokens.toLocaleString()} /{' '}
              {meeting.llm_output_tokens?.toLocaleString() ?? 0}
            </div>
          )}
          <div className="text-xs text-slate-400">
            {meeting.stt_backend ?? '—'} · {meeting.gpu_tier ?? '—'}
          </div>
        </div>
      </header>

      {/* Audio player + speaker chips */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3 shadow-sm">
        {audioUrl ? (
          <audio ref={audioRef} controls src={audioUrl} className="h-9 flex-1 min-w-[320px]" />
        ) : (
          <div className="flex-1 rounded-md border border-dashed bg-slate-50 px-3 py-2 text-sm text-slate-500">
            此會議無音檔(舊資料或測試);點擊段落不會跳秒。
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {uniqueSpeakers.map((label) =>
            renameTarget === label ? (
              <span key={label} className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename();
                    if (e.key === 'Escape') setRenameTarget(null);
                  }}
                  placeholder={label}
                  disabled={renaming}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={submitRename}
                  disabled={renaming}
                  className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white"
                >
                  {renaming ? '…' : '✓'}
                </button>
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  disabled={renaming}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setRenameTarget(label);
                  setRenameValue(label);
                }}
                className={cn(
                  'rounded-full border px-3 py-0.5 text-xs font-medium transition hover:opacity-80',
                  speakerColor(label),
                )}
                title="點擊改名"
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr_1.2fr]">
        {/* Transcript */}
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
            逐字稿時間軸
            <span className="font-normal normal-case text-slate-400">
              {transcriptSegments.length} 段
            </span>
          </h2>
          <div className="space-y-2">
            {transcriptSegments.map((seg) => (
              <button
                key={seg.id}
                type="button"
                onClick={() => handleSegmentClick(seg)}
                className={cn(
                  'block w-full rounded-md border-l-4 p-2 text-left text-sm transition',
                  speakerColor(seg.speaker_label),
                  audioUrl && 'cursor-pointer hover:brightness-95',
                  highlightedSegmentId === seg.id && 'ring-2 ring-amber-400 ring-offset-1',
                )}
              >
                <div className="mb-1 flex items-baseline justify-between text-[10px] text-slate-500">
                  <span className="font-mono">{fmtTime(seg.start_seconds)}</span>
                  <span className="font-medium uppercase">{seg.speaker_label ?? 'unknown'}</span>
                </div>
                <p className="leading-relaxed text-slate-800">{seg.text}</p>
              </button>
            ))}
            {transcriptSegments.length === 0 && (
              <p className="text-sm text-slate-400">尚無逐字稿</p>
            )}
          </div>
        </section>

        {/* Topics + decisions + open_questions */}
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
            議題摘要
            <span className="font-normal normal-case text-slate-400">
              {topicSegments.length} 段
            </span>
          </h2>
          <ol className="space-y-3">
            {topicSegments.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => seekTo(t.start_seconds)}
                  className="block w-full rounded-md border bg-slate-50 p-3 text-left hover:bg-slate-100"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{t.title}</h3>
                    <span className="font-mono text-[10px] text-slate-400">
                      {fmtTime(t.start_seconds)}–{fmtTime(t.end_seconds)}
                    </span>
                  </div>
                  {t.summary && (
                    <p className="text-sm leading-relaxed text-slate-700">{t.summary}</p>
                  )}
                </button>
              </li>
            ))}
            {topicSegments.length === 0 && (
              <p className="text-sm text-slate-400">尚未抽取議題</p>
            )}
          </ol>

          {decisions.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
                決議事項
              </h2>
              <ul className="space-y-2">
                {decisions.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => seekTo(d.source_start_seconds)}
                      className="block w-full rounded-md border border-emerald-200 bg-emerald-50 p-2 text-left text-sm hover:bg-emerald-100"
                    >
                      <p className="font-medium text-emerald-900">{d.description}</p>
                      <blockquote className="mt-1 border-l-2 border-emerald-300 pl-2 text-xs italic text-emerald-700">
                        「{d.source_quote}」 @{fmtTime(d.source_start_seconds)}
                      </blockquote>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {openQuestions.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
                未決問題
              </h2>
              <ul className="space-y-2">
                {openQuestions.map((q) => (
                  <li key={q.id} className="rounded-md border border-slate-300 bg-slate-50 p-2 text-sm">
                    <p className="text-slate-800">{q.question}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Action items */}
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
            行動項目
            <span className="font-normal normal-case text-slate-400">
              {actionItems.length} 項
            </span>
          </h2>
          <ul className="space-y-3">
            {actionItems.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => handleActionItemClick(it)}
                  className={cn(
                    'block w-full rounded-md border-2 p-3 text-left text-sm transition hover:brightness-95',
                    confidenceClass(it.confidence),
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="rounded bg-white/70 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
                      {confidenceLabel(it.confidence)} · {(it.confidence * 100).toFixed(0)}%
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">
                      @{fmtTime(it.source_start_seconds)}
                    </span>
                  </div>
                  <p className="mb-1 font-medium text-slate-900">{it.description}</p>
                  <div className="mb-2 flex gap-3 text-xs text-slate-600">
                    <span>
                      <span className="text-slate-400">負責：</span>
                      <span className="font-medium">
                        {it.owner_raw_name ?? '未指派'}
                        {it.owner_member_id && (
                          <span className="ml-1 text-emerald-600" title="已自動連結到成員">
                            ✓
                          </span>
                        )}
                      </span>
                    </span>
                    <span>
                      <span className="text-slate-400">期限：</span>
                      <span className="font-medium">
                        {it.due_date_raw ?? '未訂'}
                        {it.due_date && (
                          <span className="ml-1 font-mono text-slate-400">({it.due_date})</span>
                        )}
                      </span>
                    </span>
                  </div>
                  <blockquote className="border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">
                    「{it.source_quote}」
                  </blockquote>
                  {it.needs_clarification && (
                    <p className="mt-1 text-xs text-amber-700">⚠ {it.needs_clarification}</p>
                  )}
                </button>
              </li>
            ))}
            {actionItems.length === 0 && (
              <p className="text-sm text-slate-400">沒有抽到行動項目</p>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
