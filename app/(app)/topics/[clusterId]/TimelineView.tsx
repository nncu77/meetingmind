'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, Circle } from 'lucide-react';
import type { TimelineBundle, TimelineEvent, CurrentState } from '@/lib/topics/timeline';
import { cn } from '@/lib/utils';

export default function TimelineView({
  initialBundle,
  clusterId,
}: {
  initialBundle: TimelineBundle;
  clusterId: string;
}) {
  const [bundle, setBundle] = useState<TimelineBundle>(initialBundle);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<any>(null);

  // 第一次打開頁面時，呼叫 API 觸發 current_state 計算（cache stale 才會扣 quota）
  useEffect(() => {
    if (initialBundle.currentState != null && initialBundle.events.length > 0) {
      // 已有 cache 就先用，背景靜默 refresh 留給「更新摘要」按鈕
      return;
    }
    if (initialBundle.events.length === 0) return;
    void fetchTimeline(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTimeline(forceRefresh: boolean) {
    setError(null);
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/topics/${clusterId}/timeline${forceRefresh ? '?refresh=1' : ''}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? `載入失敗（${res.status}）`);
        return;
      }
      setBundle({
        cluster: body.cluster,
        events: body.events,
        currentState: body.currentState,
      });
      if (body.quota) setQuota(body.quota);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const { cluster, events, currentState } = bundle;
  const allOpenQuestions = events.flatMap((e) =>
    e.openQuestions.map((q) => ({ ...q, meetingTitle: e.meetingTitle, meetingDate: e.meetingDate })),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 border-b pb-4">
        <Link href="/meetings" className="text-xs text-slate-500 hover:text-slate-900">
          ← 回會議列表
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {cluster.canonical_title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          跨 {events.length} 場會議的議題演進
        </p>
      </header>

      {/* Current state */}
      <CurrentStateCard
        state={currentState}
        canRefresh={events.length > 0}
        onRefresh={() => fetchTimeline(true)}
        refreshing={refreshing}
        eventsCount={events.length}
      />

      {error ? (
        <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Timeline */}
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-slate-900">時間軸</h2>
        {events.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            這個議題目前還沒有可顯示的會議。下一場會議聚類到這個 cluster 後就會出現。
          </p>
        ) : (
          <ol className="relative space-y-6 border-l border-slate-300 pl-6">
            {events.map((e) => (
              <TimelineEventNode key={`${e.meetingId}-${e.topicTitle}`} event={e} />
            ))}
          </ol>
        )}
      </section>

      {/* Open questions */}
      {allOpenQuestions.length > 0 ? (
        <section className="mt-8 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-orange-900">
            <AlertCircle className="h-5 w-5" />
            尚未解決的問題（{allOpenQuestions.length}）
          </h2>
          <ul className="space-y-2 text-sm">
            {allOpenQuestions.map((q, i) => (
              <li key={i}>
                <p className="text-orange-900">{q.question}</p>
                <p className="mt-0.5 text-xs text-orange-700">
                  來自 {q.meetingTitle} · {new Date(q.meetingDate).toLocaleDateString('zh-TW')}
                  {q.raisedBy ? ` · 提出者:${q.raisedBy}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {quota && quota.allowed === false ? (
        <p className="mt-6 text-xs text-rose-600">
          本月議題時間軸摘要額度已用完（{quota.orgUsed}/{quota.orgLimit}），下個月 1 號重置。
          目前顯示的是上次計算的 cache。
        </p>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------

function CurrentStateCard({
  state,
  canRefresh,
  onRefresh,
  refreshing,
  eventsCount,
}: {
  state: CurrentState | null;
  canRefresh: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  eventsCount: number;
}) {
  return (
    <section className="rounded-lg border-2 border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          目前狀態
        </h2>
        {canRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
            title="重新讓 Claude 計算當前狀態（扣 1 次 topic_timeline_query 配額）"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {refreshing ? '計算中…' : '更新摘要'}
          </button>
        ) : null}
      </div>

      {!state ? (
        <p className="text-sm text-slate-500">
          {eventsCount === 0 ? '尚無資料' : refreshing ? '計算中…' : '尚未計算，請按「更新摘要」'}
        </p>
      ) : (
        <>
          <p className="text-base leading-relaxed text-slate-900">{state.summary}</p>
          {state.nextStep ? (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-emerald-50 p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-medium text-emerald-700">下一步</p>
                <p className="text-sm text-emerald-900">{state.nextStep}</p>
              </div>
            </div>
          ) : null}
          {state.openBlockers.length > 0 ? (
            <div className="mt-2 rounded-md bg-orange-50 p-3">
              <p className="text-xs font-medium text-orange-700">未解 blocker</p>
              <ul className="mt-1 space-y-0.5 text-sm text-orange-900">
                {state.openBlockers.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span>·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] text-slate-400">
            {state.fromCache ? '使用 30 分鐘內的 cache' : '剛由 Claude 計算'} ·
            {' '}{new Date(state.computedAt).toLocaleString('zh-TW')}
          </p>
        </>
      )}
    </section>
  );
}

function TimelineEventNode({ event }: { event: TimelineEvent }) {
  const hasDecisions = event.decisions.length > 0;
  const hasOpenQs = event.openQuestions.length > 0;
  const color = hasDecisions
    ? 'bg-emerald-500 border-emerald-700'
    : hasOpenQs
    ? 'bg-orange-500 border-orange-700'
    : 'bg-slate-400 border-slate-600';

  return (
    <li className="relative">
      <span
        className={cn(
          'absolute -left-[33px] flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white',
          color,
        )}
      />
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs text-slate-500">
          <span className="font-medium">
            {new Date(event.meetingDate).toLocaleDateString('zh-TW')}
          </span>
          <Link
            href={`/meetings/${event.meetingId}`}
            className="text-slate-700 hover:text-slate-900 hover:underline"
          >
            {event.meetingTitle}
          </Link>
        </div>
        <h3 className="text-sm font-semibold text-slate-900">{event.topicTitle}</h3>
        {event.topicSummary ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{event.topicSummary}</p>
        ) : null}

        {event.decisions.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-emerald-700">決議</p>
            <ul className="space-y-1 text-sm">
              {event.decisions.map((d, i) => (
                <li key={i} className="flex gap-2 text-slate-800">
                  <span className="text-emerald-600">✓</span>
                  <span>{d.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {event.actionItems.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-slate-700">行動項目</p>
            <ul className="space-y-1 text-sm">
              {event.actionItems.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-slate-700">
                  <Circle className="mt-1 h-3 w-3 flex-shrink-0" />
                  <span>
                    {a.ownerLabel ? <strong>{a.ownerLabel}:</strong> : null} {a.description}
                    {a.dueLabel ? (
                      <span className="ml-1 text-xs text-slate-500">({a.dueLabel})</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {event.openQuestions.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-orange-700">未決問題</p>
            <ul className="space-y-1 text-sm">
              {event.openQuestions.map((q, i) => (
                <li key={i} className="text-orange-900">? {q.question}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}
