import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getOrgUsageSnapshot } from '@/lib/quota';
import { RESOURCE_LABELS, type ResourceType } from '@/lib/quota/limits';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function nextMonthStartUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function formatResetDate(): string {
  const d = nextMonthStartUTC();
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 1 日`;
}

type Tone = 'ok' | 'warn' | 'block';

function pickTone(used: number, limit: number): Tone {
  if (limit <= 0) return 'block';
  const pct = (used / limit) * 100;
  if (pct >= 100) return 'block';
  if (pct >= 80) return 'warn';
  return 'ok';
}

const TONE_STYLES: Record<Tone, { bar: string; label: string; bg: string }> = {
  ok: { bar: 'bg-emerald-500', label: 'text-emerald-700', bg: 'bg-emerald-50' },
  warn: { bar: 'bg-orange-500', label: 'text-orange-700', bg: 'bg-orange-50' },
  block: { bar: 'bg-rose-500', label: 'text-rose-700', bg: 'bg-rose-50' },
};

export default async function UsagePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: member } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/login');

  const snapshot = await getOrgUsageSnapshot(member.org_id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">本月用量</h1>
        <p className="mt-1 text-sm text-slate-600">
          下次重置：<strong>{formatResetDate()}</strong>（UTC）。同一上限同月不重複寄警示信。
        </p>
      </header>

      <section className="space-y-4">
        {snapshot.map((s) => (
          <UsageCard key={s.resourceType} {...s} />
        ))}
      </section>

      <section className="mt-10 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <h2 className="mb-2 text-base font-medium text-slate-900">為什麼有兩道上限？</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Org 上限</strong>：避免單一組織把全平台額度燒光，
            導致其他組織無法使用。
          </li>
          <li>
            <strong>平台上限</strong>：保護整個 MeetingMind 的月度成本封頂，
            是 hard cap，不會自動升級。
          </li>
          <li>達 80% / 100% 時管理員會收到一封警示信。</li>
        </ul>
      </section>
    </main>
  );
}

function UsageCard(props: {
  resourceType: ResourceType;
  orgUsed: number;
  orgLimit: number;
  platformUsed: number;
  platformLimit: number;
}) {
  const orgTone = pickTone(props.orgUsed, props.orgLimit);
  const platTone = pickTone(props.platformUsed, props.platformLimit);
  const worst: Tone = orgTone === 'block' || platTone === 'block'
    ? 'block'
    : orgTone === 'warn' || platTone === 'warn'
    ? 'warn'
    : 'ok';
  const styles = TONE_STYLES[worst];

  return (
    <article className={cn('rounded-lg border border-slate-200 bg-white p-5', worst !== 'ok' && styles.bg)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium text-slate-900">{RESOURCE_LABELS[props.resourceType]}</h3>
        {worst === 'block' && (
          <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-medium text-white">
            已用完
          </span>
        )}
        {worst === 'warn' && (
          <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white">
            接近上限
          </span>
        )}
      </div>

      <UsageBar
        label="Org 本月用量"
        used={props.orgUsed}
        limit={props.orgLimit}
        tone={orgTone}
      />
      <div className="mt-3" />
      <UsageBar
        label="平台彙總"
        used={props.platformUsed}
        limit={props.platformLimit}
        tone={platTone}
        muted
      />

      {worst === 'block' && (
        <p className="mt-3 text-sm text-rose-700">
          {orgTone === 'block'
            ? '此 org 本月額度已用完，下個月 1 號重置'
            : '平台本月額度已用完，請聯絡管理員'}
        </p>
      )}
    </article>
  );
}

function UsageBar({
  label,
  used,
  limit,
  tone,
  muted = false,
}: {
  label: string;
  used: number;
  limit: number;
  tone: Tone;
  muted?: boolean;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const styles = TONE_STYLES[tone];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className={cn('text-xs font-medium', muted ? 'text-slate-500' : 'text-slate-700')}>
          {label}
        </span>
        <span className={cn('text-xs tabular-nums', styles.label, muted && 'text-slate-500')}>
          {used} / {limit}
          <span className="ml-2 text-slate-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn('h-full transition-[width]', styles.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
