import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  PLAN_LIMITS,
  getOrgLimit,
  getPlatformLimit,
  type ResourceType,
} from './limits';
import type {
  CheckQuotaResult,
  RecordUsageResult,
  AlertScope,
  AlertType,
} from './types';
import { sendQuotaAlertEmail } from './email';

// Supabase 還沒重新 gen types，這裡用 any cast 走 rpc / 新表
type AdminClient = SupabaseClient<Database>;

function admin(client?: AdminClient): AdminClient {
  return client ?? (getSupabaseAdmin() as AdminClient);
}

/**
 * 檢查指定 org 在指定 resource 的當月用量是否允許再做一次。
 * 不會改變任何狀態。
 */
export async function checkQuota(
  orgId: string,
  resourceType: ResourceType,
  client?: AdminClient,
): Promise<CheckQuotaResult> {
  const sb = admin(client);
  const { data, error } = await (sb.rpc as any)('get_quota_status', {
    p_org_id: orgId,
    p_resource_type: resourceType,
  });
  if (error) throw new Error(`get_quota_status failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const orgUsed = (row?.org_used ?? 0) as number;
  const platformUsed = (row?.platform_used ?? 0) as number;
  const orgLimit = getOrgLimit(resourceType);
  const platformLimit = getPlatformLimit(resourceType);

  if (orgUsed >= orgLimit) {
    return { allowed: false, reason: 'org_limit', orgUsed, orgLimit, platformUsed, platformLimit };
  }
  if (platformUsed >= platformLimit) {
    return {
      allowed: false,
      reason: 'platform_limit',
      orgUsed,
      orgLimit,
      platformUsed,
      platformLimit,
    };
  }
  return { allowed: true, orgUsed, orgLimit, platformUsed, platformLimit };
}

/**
 * 原子地對 org 與平台計數器各 +count，回傳新計數。
 * 內部會觸發 alert email 檢查。
 */
export async function recordUsage(
  orgId: string,
  resourceType: ResourceType,
  count = 1,
  client?: AdminClient,
): Promise<RecordUsageResult> {
  const sb = admin(client);
  const { data, error } = await (sb.rpc as any)('increment_quota_usage', {
    p_org_id: orgId,
    p_resource_type: resourceType,
    p_count: count,
  });
  if (error) throw new Error(`increment_quota_usage failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const orgUsed = (row?.org_used ?? 0) as number;
  const platformUsed = (row?.platform_used ?? 0) as number;

  // 觸發 alert 檢查（非同步、失敗不阻塞主流程）
  try {
    await checkAndSendAlerts(resourceType, orgId, orgUsed, platformUsed, sb);
  } catch (e) {
    // 不讓 alert 失敗影響原本的 recordUsage 成功
    console.error('[quota] checkAndSendAlerts failed (non-fatal):', e);
  }

  return { orgUsed, platformUsed };
}

/**
 * 取得當月所有 6 種 resource 的用量（用在 /settings/usage 頁面）。
 * 一次查詢比逐項 RPC 快。
 */
export async function getOrgUsageSnapshot(
  orgId: string,
  client?: AdminClient,
): Promise<
  Array<{
    resourceType: ResourceType;
    orgUsed: number;
    orgLimit: number;
    platformUsed: number;
    platformLimit: number;
  }>
> {
  const sb = admin(client);
  const periodStart = monthStartUTC(new Date()).toISOString().slice(0, 10);

  const { data, error } = await (sb as any)
    .from('quota_usage')
    .select('org_id, resource_type, count')
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .eq('period_start', periodStart);
  if (error) throw new Error(`getOrgUsageSnapshot failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    org_id: string | null;
    resource_type: string;
    count: number;
  }>;
  const orgMap = new Map<string, number>();
  const platMap = new Map<string, number>();
  for (const r of rows) {
    if (r.org_id == null) platMap.set(r.resource_type, r.count);
    else orgMap.set(r.resource_type, r.count);
  }

  const resources = Object.keys(PLAN_LIMITS.perOrg) as ResourceType[];
  return resources.map((rt) => ({
    resourceType: rt,
    orgUsed: orgMap.get(rt) ?? 0,
    orgLimit: getOrgLimit(rt),
    platformUsed: platMap.get(rt) ?? 0,
    platformLimit: getPlatformLimit(rt),
  }));
}

/**
 * 達到 80% / 100% threshold 時寄一封 alert email。
 * 同月同 threshold 只寄一次，靠 quota_alerts_sent 的 unique constraint 防重。
 */
export async function checkAndSendAlerts(
  resourceType: ResourceType,
  orgId: string,
  orgUsed: number,
  platformUsed: number,
  client?: AdminClient,
): Promise<void> {
  const sb = admin(client);
  const orgLimit = getOrgLimit(resourceType);
  const platformLimit = getPlatformLimit(resourceType);

  const scopes: AlertScope[] = [];

  for (const pct of PLAN_LIMITS.alertAt) {
    if (orgUsed * 100 >= orgLimit * pct) {
      const alertType: AlertType = pct === 100 ? 'org_100pct' : 'org_80pct';
      scopes.push({ kind: 'org', orgId, resourceType, alertType });
    }
    if (platformUsed * 100 >= platformLimit * pct) {
      const alertType: AlertType = pct === 100 ? 'platform_100pct' : 'platform_80pct';
      scopes.push({ kind: 'platform', resourceType, alertType });
    }
  }

  for (const scope of scopes) {
    await tryDispatchAlert(sb, scope, { orgUsed, orgLimit, platformUsed, platformLimit });
  }
}

async function tryDispatchAlert(
  sb: AdminClient,
  scope: AlertScope,
  meta: { orgUsed: number; orgLimit: number; platformUsed: number; platformLimit: number },
) {
  const periodStart = monthStartUTC(new Date()).toISOString().slice(0, 10);
  const row =
    scope.kind === 'org'
      ? {
          alert_type: scope.alertType,
          resource_type: scope.resourceType,
          org_id: scope.orgId,
          period_start: periodStart,
        }
      : {
          alert_type: scope.alertType,
          resource_type: scope.resourceType,
          org_id: null,
          period_start: periodStart,
        };

  // 直接 INSERT；若同月同 threshold 已寄過，會 unique constraint 失敗 → 視為已寄過。
  const { error } = await (sb as any).from('quota_alerts_sent').insert(row);
  if (error) {
    // 23505 = unique_violation → 已經寄過，跳過
    const code = (error as any).code;
    if (code === '23505') return;
    // 其他錯誤也不阻擋主流程，但要記下來
    console.error('[quota] alert dedup insert failed:', error);
    return;
  }

  // 真的剛 insert 成功 → 寄信
  await sendQuotaAlertEmail(scope, meta);
}

function monthStartUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// Re-export for convenience
export { PLAN_LIMITS, RESOURCE_LABELS, type ResourceType, RESOURCE_TYPES } from './limits';
export type { CheckQuotaResult, RecordUsageResult } from './types';
