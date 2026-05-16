'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const SPEAKER_COLORS = [
  'bg-blue-50 border-blue-300 text-blue-900',
  'bg-emerald-50 border-emerald-300 text-emerald-900',
  'bg-amber-50 border-amber-300 text-amber-900',
  'bg-violet-50 border-violet-300 text-violet-900',
  'bg-rose-50 border-rose-300 text-rose-900',
  'bg-cyan-50 border-cyan-300 text-cyan-900',
];

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

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

type Meeting = {
  id: string;
  title: string;
  durationSeconds: number | null;
  createdAt: string;
  audioUrl: string | null;
};

type Topic = { id: string; title: string; summary: string | null };
type ActionItem = {
  id: string;
  description: string;
  ownerLabel: string | null;
  dueLabel: string | null;
  sourceQuote: string;
  sourceStartSeconds: number;
  confidence: number;
};
type Decision = {
  id: string;
  description: string;
  agreedByLabels: string[];
  sourceQuote: string;
};
type OpenQuestion = { id: string; question: string; raisedBy: string | null };
type TranscriptSeg = {
  id: string;
  speaker: string | null;
  text: string;
  startSeconds: number;
  endSeconds: number;
};

export default function SharedReview(props: {
  meeting: Meeting;
  topics: Topic[];
  actionItems: ActionItem[];
  decisions: Decision[];
  openQuestions: OpenQuestion[];
  transcript: TranscriptSeg[];
  orgName: string;
}) {
  const { meeting, topics, actionItems, decisions, openQuestions, transcript, orgName } = props;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);

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

  function onActionClick(it: ActionItem) {
    seekTo(it.sourceStartSeconds);
    const seg = transcript.find(
      (t) => it.sourceStartSeconds >= t.startSeconds && it.sourceStartSeconds < t.endSeconds,
    );
    if (seg) setHighlightedSegmentId(seg.id);
  }

  const dateStr = new Date(meeting.createdAt).toLocaleDateString('zh-TW');

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] px-6 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{meeting.title}</h1>
          <p className="text-sm text-slate-500">
            {dateStr}
            {meeting.durationSeconds ? ` · ${Math.round(meeting.durationSeconds / 60)} 分鐘` : ''}
            {' · '}由 <strong>{orgName}</strong> 透過 MeetingMind 整理
          </p>
        </div>
        <div className="text-right text-xs text-slate-400">
          唯讀分享 · 訪客無法編輯
        </div>
      </header>

      {meeting.audioUrl ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm">
          <audio ref={audioRef} controls src={meeting.audioUrl} className="h-9 w-full" />
        </div>
      ) : (
        <div className="mb-4 rounded-md border border-dashed bg-slate-50 px-3 py-2 text-sm text-slate-500">
          此會議無音檔，僅顯示文字摘要。
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr_1.2fr]">
        {/* Transcript */}
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
            逐字稿時間軸
            <span className="font-normal normal-case text-slate-400">
              {transcript.length} 段
            </span>
          </h2>
          <div className="space-y-2">
            {transcript.map((seg) => (
              <button
                key={seg.id}
                type="button"
                onClick={() => {
                  seekTo(seg.startSeconds);
                  setHighlightedSegmentId(seg.id);
                }}
                className={cn(
                  'block w-full rounded-md border px-3 py-2 text-left text-sm transition hover:brightness-95',
                  speakerColor(seg.speaker),
                  highlightedSegmentId === seg.id && 'ring-2 ring-yellow-400',
                )}
              >
                <div className="mb-0.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  <span>{seg.speaker ?? '—'}</span>
                  <span>{fmtTime(seg.startSeconds)}</span>
                </div>
                <div>{seg.text}</div>
              </button>
            ))}
            {transcript.length === 0 ? (
              <p className="text-sm text-slate-400">沒有逐字稿資料</p>
            ) : null}
          </div>
        </section>

        {/* Topics + decisions + questions */}
        <section className="space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              議題摘要（{topics.length}）
            </h2>
            <div className="space-y-3">
              {topics.map((t, i) => (
                <div key={t.id} className="border-l-2 border-slate-300 pl-3">
                  <div className="text-sm font-medium text-slate-900">
                    {i + 1}. {t.title}
                  </div>
                  {t.summary ? (
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{t.summary}</p>
                  ) : null}
                </div>
              ))}
              {topics.length === 0 ? (
                <p className="text-sm text-slate-400">沒有議題資料</p>
              ) : null}
            </div>
          </div>

          {decisions.length > 0 ? (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                決議（{decisions.length}）
              </h2>
              <ul className="space-y-2">
                {decisions.map((d) => (
                  <li key={d.id} className="flex gap-2">
                    <span className="mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-emerald-600" />
                    <div>
                      <p className="text-sm text-slate-900">{d.description}</p>
                      {d.agreedByLabels.length > 0 ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          同意者:{d.agreedByLabels.join('、')}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {openQuestions.length > 0 ? (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                未決問題（{openQuestions.length}）
              </h2>
              <ul className="space-y-2">
                {openQuestions.map((q) => (
                  <li key={q.id} className="flex gap-2">
                    <span className="mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-orange-500" />
                    <div>
                      <p className="text-sm text-orange-900">{q.question}</p>
                      {q.raisedBy ? (
                        <p className="mt-0.5 text-xs text-slate-500">提出者:{q.raisedBy}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* Action items */}
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            行動項目（{actionItems.length}）
          </h2>
          <div className="space-y-2">
            {actionItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onActionClick(it)}
                className={cn(
                  'block w-full rounded-md border-2 p-3 text-left text-sm transition hover:brightness-95',
                  confidenceClass(it.confidence),
                )}
                title="點擊跳回原始錄音"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">{it.description}</p>
                  <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
                    {confidenceLabel(it.confidence)} · {(it.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
                  <span>負責人:{it.ownerLabel ?? '—'}</span>
                  <span>截止:{it.dueLabel ?? '—'}</span>
                  <span>@{fmtTime(it.sourceStartSeconds)}</span>
                </div>
                {it.sourceQuote ? (
                  <p className="mt-1 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-500">
                    「{it.sourceQuote}」
                  </p>
                ) : null}
              </button>
            ))}
            {actionItems.length === 0 ? (
              <p className="text-sm text-slate-400">沒有行動項目</p>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="mt-8 border-t pt-4 text-center text-xs text-slate-400">
        由 MeetingMind 產生 · meetingmind-xi.vercel.app
      </footer>
    </main>
  );
}
