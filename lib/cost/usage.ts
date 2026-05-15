import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { PLAN_LIMITS, type Plan } from './estimate';

export interface MonthlyUsage {
  plan: Plan;
  spentCents: number;
  capCents: number;
  meetingsThisMonth: number;
  pctUsed: number;
}

/**
 * Compute the current month's cost usage for the caller's org.
 * Returns null if the caller has no org membership (shouldn't happen for
 * logged-in users on protected routes, but defensive).
 */
export async function getMonthlyUsage(
  sb: SupabaseClient<Database>,
): Promise<MonthlyUsage | null> {
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

  const { data: member } = await sb
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return null;

  const { data: org } = await sb
    .from('organizations')
    .select('plan')
    .eq('id', member.org_id)
    .maybeSingle();
  const plan = (org?.plan ?? 'free') as Plan;
  const limits = PLAN_LIMITS[plan];

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const { data: rows } = await sb
    .from('meetings')
    .select('cost_estimate_cents')
    .eq('org_id', member.org_id)
    .gte('created_at', start.toISOString());

  const spentCents = (rows ?? []).reduce((s, r) => s + (r.cost_estimate_cents ?? 0), 0);
  const meetingsThisMonth = rows?.length ?? 0;
  const pctUsed = limits.maxMonthlyCostCents
    ? Math.min(100, (spentCents / limits.maxMonthlyCostCents) * 100)
    : 0;

  return {
    plan,
    spentCents,
    capCents: limits.maxMonthlyCostCents,
    meetingsThisMonth,
    pctUsed,
  };
}
