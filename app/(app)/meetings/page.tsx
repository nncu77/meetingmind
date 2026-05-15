import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMonthlyUsage } from '@/lib/cost/usage';

export default async function MeetingsListPage() {
  const sb = await createSupabaseServerClient();
  const [meetingsRes, usage] = await Promise.all([
    sb
      .from('meetings')
      .select('id, title, status, duration_seconds, cost_estimate_cents, created_at, processed_at')
      .order('created_at', { ascending: false })
      .limit(100),
    getMonthlyUsage(sb),
  ]);

  const list = meetingsRes.data ?? [];
  const usageBar = usage && (
    <div className="rounded-lg border bg-white px-4 py-3 text-sm shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-4">
        <span className="text-slate-700">
          本月用量(<span className="font-mono">{usage.plan}</span> 方案)
        </span>
        <span className="font-mono text-slate-900">
          ${(usage.spentCents / 100).toFixed(2)} /
          <span className="text-slate-400"> ${(usage.capCents / 100).toFixed(2)}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full transition-all ${
            usage.pctUsed >= 100
              ? 'bg-rose-500'
              : usage.pctUsed >= 80
              ? 'bg-amber-500'
              : 'bg-emerald-500'
          }`}
          style={{ width: `${usage.pctUsed}%` }}
        />
      </div>
      {usage.pctUsed >= 100 && (
        <p className="mt-1 text-xs text-rose-700">
          本月已達上限,新會議無法上傳。下個月 1 號自動重置。
        </p>
      )}
      {usage.pctUsed >= 80 && usage.pctUsed < 100 && (
        <p className="mt-1 text-xs text-amber-700">
          已用 {usage.pctUsed.toFixed(0)}% — 接近上限。
        </p>
      )}
    </div>
  );

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">會議列表</h1>
          <p className="text-sm text-slate-500">{list.length} 場會議</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/meetings/record"
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            ● 現場直錄
          </Link>
          <Link
            href="/meetings/new"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            + 上傳新會議
          </Link>
        </div>
      </header>

      {usageBar && <div className="mb-4">{usageBar}</div>}

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-12 text-center">
          <p className="mb-4 text-slate-600">還沒有任何會議。</p>
          <Link
            href="/meetings/new"
            className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            上傳第一場會議
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">標題</th>
                <th className="px-4 py-2 font-medium">狀態</th>
                <th className="px-4 py-2 font-medium">時長</th>
                <th className="px-4 py-2 font-medium">成本</th>
                <th className="px-4 py-2 font-medium">建立時間</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{m.title}</td>
                  <td className="px-4 py-3">
                    <span className={statusPill(m.status)}>{statusLabel(m.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {m.duration_seconds ? `${m.duration_seconds}s` : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {m.cost_estimate_cents != null
                      ? `$${(m.cost_estimate_cents / 100).toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(m.created_at).toLocaleString('zh-TW', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/meetings/${m.id}`}
                      className="text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      檢視 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function statusLabel(s: string) {
  return (
    {
      pending: '排隊中',
      processing: '處理中',
      done: '完成',
      failed: '失敗',
    } as Record<string, string>
  )[s] ?? s;
}

function statusPill(s: string) {
  const base = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium';
  const tone = (
    {
      pending: 'bg-slate-100 text-slate-700',
      processing: 'bg-amber-100 text-amber-800',
      done: 'bg-emerald-100 text-emerald-800',
      failed: 'bg-rose-100 text-rose-800',
    } as Record<string, string>
  )[s] ?? 'bg-slate-100 text-slate-700';
  return `${base} ${tone}`;
}
