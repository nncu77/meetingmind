import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * /eval — portfolio-facing aggregate metrics page.
 *
 * Per spec §11.3: 「面試官打開就能看到所有量化數字」. Reviewers don't
 * need a login — but since RLS scopes to user's org, they'll see the
 * meetings the signed-in account has.
 *
 * Cards shown:
 *   1. Volume:        meetings, total duration, total cost
 *   2. Speed:         avg processing time
 *   3. Quality:       confidence distribution of action_items
 *   4. Cost mix:      STT backend / GPU tier split, LLM token usage
 *   5. Extraction:    avg action_items / decisions / topics per meeting
 */
export default async function EvalPage() {
  const sb = await createSupabaseServerClient();

  const [meetingsRes, actionItemsRes, topicsRes, decisionsRes] = await Promise.all([
    sb.from('meetings').select('*'),
    sb.from('action_items').select('confidence,owner_member_id,meeting_id'),
    sb.from('topic_segments').select('meeting_id'),
    sb.from('decisions').select('meeting_id'),
  ]);

  const meetings = meetingsRes.data ?? [];
  const actionItems = actionItemsRes.data ?? [];
  const topics = topicsRes.data ?? [];
  const decisions = decisionsRes.data ?? [];

  const done = meetings.filter((m) => m.status === 'done');
  const totalDurSec = done.reduce((s, m) => s + (m.duration_seconds ?? 0), 0);
  const totalCostCents = done.reduce((s, m) => s + (m.cost_estimate_cents ?? 0), 0);
  const totalLlmIn = done.reduce((s, m) => s + (m.llm_input_tokens ?? 0), 0);
  const totalLlmOut = done.reduce((s, m) => s + (m.llm_output_tokens ?? 0), 0);

  // Average processing time (created_at → processed_at)
  const procTimes = done
    .filter((m) => m.processed_at && m.created_at)
    .map((m) => (Date.parse(m.processed_at!) - Date.parse(m.created_at)) / 1000);
  const avgProcSec = procTimes.length
    ? procTimes.reduce((a, b) => a + b, 0) / procTimes.length
    : 0;

  // Action-item confidence buckets
  const buckets = { high: 0, mid: 0, low: 0 };
  for (const a of actionItems) {
    if (a.confidence >= 0.85) buckets.high++;
    else if (a.confidence >= 0.65) buckets.mid++;
    else buckets.low++;
  }
  const aiTotal = actionItems.length || 1;
  const ownerResolved = actionItems.filter((a) => a.owner_member_id).length;

  // STT / GPU breakdown
  const sttCounts: Record<string, number> = {};
  const gpuCounts: Record<string, number> = {};
  for (const m of done) {
    if (m.stt_backend) sttCounts[m.stt_backend] = (sttCounts[m.stt_backend] ?? 0) + 1;
    if (m.gpu_tier) gpuCounts[m.gpu_tier] = (gpuCounts[m.gpu_tier] ?? 0) + 1;
  }

  const avgActionItemsPerMeeting = done.length ? actionItems.length / done.length : 0;
  const avgTopicsPerMeeting = done.length ? topics.length / done.length : 0;
  const avgDecisionsPerMeeting = done.length ? decisions.length / done.length : 0;

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-6 flex items-baseline justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">評估指標</h1>
          <p className="mt-1 text-sm text-slate-500">
            這個組織所有會議的量化盤點。Portfolio 數字一頁看清楚。
          </p>
        </div>
        <div className="text-right text-sm text-slate-500">
          樣本：{done.length} 場完成 / {meetings.length} 場總計
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="總會議數" value={done.length} />
        <Stat label="總音檔時長" value={fmtDuration(totalDurSec)} />
        <Stat
          label="總成本"
          value={`$${(totalCostCents / 100).toFixed(2)}`}
          sub={
            done.length ? `平均 $${(totalCostCents / 100 / done.length).toFixed(3)} / 場` : ''
          }
        />
        <Stat
          label="平均處理時間"
          value={avgProcSec ? `${avgProcSec.toFixed(1)}s` : '—'}
          sub={
            totalDurSec && avgProcSec
              ? `${(avgProcSec / (totalDurSec / Math.max(done.length, 1))).toFixed(2)}× realtime`
              : ''
          }
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="行動項目信心分布">
          <div className="space-y-2 text-sm">
            <ConfBar label="可信 (≥ 0.85)" count={buckets.high} total={aiTotal} tone="emerald" />
            <ConfBar label="建議複核 (0.65–0.85)" count={buckets.mid} total={aiTotal} tone="amber" />
            <ConfBar label="需要複核 (< 0.65)" count={buckets.low} total={aiTotal} tone="rose" />
          </div>
          <div className="mt-4 border-t pt-3 text-xs text-slate-500">
            owner 自動解析率：
            <span className="ml-1 font-mono font-semibold text-slate-800">
              {actionItems.length
                ? `${((ownerResolved / actionItems.length) * 100).toFixed(0)}%`
                : '—'}
            </span>
            <span className="ml-2 text-slate-400">
              ({ownerResolved} / {actionItems.length})
            </span>
          </div>
        </Card>

        <Card title="平均每場抽取量">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Metric label="行動項目" value={avgActionItemsPerMeeting.toFixed(1)} />
            <Metric label="決議" value={avgDecisionsPerMeeting.toFixed(1)} />
            <Metric label="議題段" value={avgTopicsPerMeeting.toFixed(1)} />
          </dl>
        </Card>

        <Card title="STT backend 分布">
          <Breakdown counts={sttCounts} />
        </Card>

        <Card title="GPU tier 分布">
          <Breakdown counts={gpuCounts} />
        </Card>

        <Card title="LLM token 使用量">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Metric label="總 input tokens" value={totalLlmIn.toLocaleString()} />
            <Metric label="總 output tokens" value={totalLlmOut.toLocaleString()} />
          </div>
          {done.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              平均 {Math.round(totalLlmIn / done.length).toLocaleString()} in /
              {Math.round(totalLlmOut / done.length).toLocaleString()} out per meeting
            </p>
          )}
        </Card>

        <Card title="處理時間細節">
          {procTimes.length === 0 ? (
            <p className="text-sm text-slate-400">尚無資料</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <Metric label="最短" value={`${Math.min(...procTimes).toFixed(1)}s`} />
              <Metric label="中位數" value={`${median(procTimes).toFixed(1)}s`} />
              <Metric label="最長" value={`${Math.max(...procTimes).toFixed(1)}s`} />
            </div>
          )}
        </Card>
      </div>

      <p className="text-center text-xs text-slate-400">
        所有數字即時從 Supabase 取出（RLS scope:本人組織）。沒造假。
      </p>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function ConfBar({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: 'emerald' | 'amber' | 'rose';
}) {
  const pct = total ? (count / total) * 100 : 0;
  const bar = { emerald: 'bg-emerald-400', amber: 'bg-amber-400', rose: 'bg-rose-400' }[tone];
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-700">
        <span>{label}</span>
        <span className="font-mono">
          {count} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Breakdown({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-sm text-slate-400">尚無資料</p>;
  return (
    <ul className="space-y-2 text-sm">
      {entries.map(([k, v]) => (
        <li key={k} className="flex items-center justify-between">
          <span className="font-mono text-slate-800">{k}</span>
          <span className="font-mono text-slate-600">
            {v}
            <span className="ml-1 text-xs text-slate-400">
              ({total ? ((v / total) * 100).toFixed(0) : 0}%)
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
