import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkQuota, recordUsage, checkAndSendAlerts } from '../index';
import { PLAN_LIMITS } from '../limits';

/**
 * Phase 0 quota unit tests
 *
 * 用一個 in-memory fake supabase admin client，
 * 模擬 RPC + INSERT 的行為，驗證 quota 邏輯。
 */

// Mock email module: 我們只想知道有沒有「寄出」（也就是有沒有成功 insert alert row），
// 不想真的呼叫 Resend。
vi.mock('../email', () => ({
  sendQuotaAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendQuotaAlertEmail } from '../email';

// ----------------------------------------------------------------------------
// Fake Supabase Admin Client
// ----------------------------------------------------------------------------

type Row = {
  org_id: string | null;
  resource_type: string;
  period_start: string;
  count: number;
};

type AlertRow = {
  alert_type: string;
  resource_type: string;
  org_id: string | null;
  period_start: string;
};

function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function makeFakeClient(initial: {
  usage?: Row[];
  alertsSent?: AlertRow[];
}) {
  const usageRows: Row[] = [...(initial.usage ?? [])];
  const alertRows: AlertRow[] = [...(initial.alertsSent ?? [])];

  function findUsage(orgId: string | null, resource: string, period: string): Row | undefined {
    return usageRows.find(
      (r) => r.org_id === orgId && r.resource_type === resource && r.period_start === period,
    );
  }

  return {
    _usageRows: usageRows,
    _alertRows: alertRows,
    rpc(name: string, params: any) {
      const period = thisMonth();
      if (name === 'get_quota_status') {
        const org = findUsage(params.p_org_id, params.p_resource_type, period);
        const plat = findUsage(null, params.p_resource_type, period);
        return Promise.resolve({
          data: [{ org_used: org?.count ?? 0, platform_used: plat?.count ?? 0 }],
          error: null,
        });
      }
      if (name === 'increment_quota_usage') {
        const incBy = params.p_count ?? 1;
        // Org
        let org = findUsage(params.p_org_id, params.p_resource_type, period);
        if (!org) {
          org = {
            org_id: params.p_org_id,
            resource_type: params.p_resource_type,
            period_start: period,
            count: 0,
          };
          usageRows.push(org);
        }
        org.count += incBy;
        // Platform
        let plat = findUsage(null, params.p_resource_type, period);
        if (!plat) {
          plat = {
            org_id: null,
            resource_type: params.p_resource_type,
            period_start: period,
            count: 0,
          };
          usageRows.push(plat);
        }
        plat.count += incBy;
        return Promise.resolve({
          data: [{ org_used: org.count, platform_used: plat.count }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
    from(table: string) {
      if (table === 'quota_alerts_sent') {
        return {
          insert(row: AlertRow) {
            const dup = alertRows.find(
              (r) =>
                r.alert_type === row.alert_type &&
                r.resource_type === row.resource_type &&
                r.org_id === row.org_id &&
                r.period_start === row.period_start,
            );
            if (dup) {
              return Promise.resolve({ error: { code: '23505', message: 'unique_violation' } });
            }
            alertRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`fake client doesn't support table ${table}`);
    },
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const PERIOD = thisMonth();

describe('checkQuota', () => {
  it('allows when both org and platform are under limits', async () => {
    const fake = makeFakeClient({});
    const r = await checkQuota(ORG_A, 'email_send', fake as any);
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.orgUsed).toBe(0);
      expect(r.orgLimit).toBe(PLAN_LIMITS.perOrg.email_send);
      expect(r.platformLimit).toBe(PLAN_LIMITS.platform.email_send);
    }
  });

  it('blocks with reason=org_limit when org has hit its per-month cap', async () => {
    const fake = makeFakeClient({
      usage: [
        {
          org_id: ORG_A,
          resource_type: 'email_send',
          period_start: PERIOD,
          count: PLAN_LIMITS.perOrg.email_send,
        },
        // 平台還沒滿
        { org_id: null, resource_type: 'email_send', period_start: PERIOD, count: 50 },
      ],
    });
    const r = await checkQuota(ORG_A, 'email_send', fake as any);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('org_limit');
  });

  it('blocks with reason=platform_limit when org is under but platform is full', async () => {
    const fake = makeFakeClient({
      usage: [
        { org_id: ORG_A, resource_type: 'email_send', period_start: PERIOD, count: 5 },
        {
          org_id: null,
          resource_type: 'email_send',
          period_start: PERIOD,
          count: PLAN_LIMITS.platform.email_send,
        },
      ],
    });
    const r = await checkQuota(ORG_A, 'email_send', fake as any);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('platform_limit');
  });

  it('blocks when org over but platform also over (reports org_limit first)', async () => {
    // 文件規格沒明定優先順序，但實作上先檢查 org，所以 org_limit 應該贏
    const fake = makeFakeClient({
      usage: [
        {
          org_id: ORG_A,
          resource_type: 'strict_meeting',
          period_start: PERIOD,
          count: PLAN_LIMITS.perOrg.strict_meeting + 1,
        },
        {
          org_id: null,
          resource_type: 'strict_meeting',
          period_start: PERIOD,
          count: PLAN_LIMITS.platform.strict_meeting + 10,
        },
      ],
    });
    const r = await checkQuota(ORG_A, 'strict_meeting', fake as any);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('org_limit');
  });
});

describe('checkAndSendAlerts', () => {
  it('sends 80% alert exactly once when org usage reaches 80% threshold', async () => {
    const fake = makeFakeClient({});
    const cap = PLAN_LIMITS.perOrg.email_send;
    const at80 = Math.ceil(cap * 0.8);

    await checkAndSendAlerts('email_send', ORG_A, at80, 0, fake as any);
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(1);

    // 同月再呼叫一次（已到 80% 但還沒 100%），不應再寄
    await checkAndSendAlerts('email_send', ORG_A, at80 + 1, 0, fake as any);
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('sends 100% alert exactly once when org usage hits cap', async () => {
    const fake = makeFakeClient({});
    const cap = PLAN_LIMITS.perOrg.email_send;

    // 第一次：80% + 100% 都觸發（從 0 跳到 cap）
    await checkAndSendAlerts('email_send', ORG_A, cap, 0, fake as any);
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(2);

    // 再呼叫同 org 同 resource，都不應該再寄
    await checkAndSendAlerts('email_send', ORG_A, cap + 1, 0, fake as any);
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(2);
  });

  it('sends platform-level alerts independently from org-level', async () => {
    const fake = makeFakeClient({});
    const platCap = PLAN_LIMITS.platform.email_send;
    const orgCap = PLAN_LIMITS.perOrg.email_send;

    // 只有平台到 80%，org 還很低
    await checkAndSendAlerts(
      'email_send',
      ORG_A,
      Math.floor(orgCap * 0.1),
      Math.ceil(platCap * 0.8),
      fake as any,
    );
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(1);
    const arg = (sendQuotaAlertEmail as any).mock.calls[0][0];
    expect(arg.kind).toBe('platform');
    expect(arg.alertType).toBe('platform_80pct');
  });

  it('different orgs are tracked separately', async () => {
    const fake = makeFakeClient({});
    const cap = PLAN_LIMITS.perOrg.share_link;

    await checkAndSendAlerts('share_link', ORG_A, cap, 0, fake as any);
    // ORG_A 觸發 80% + 100% = 2 封
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(2);

    await checkAndSendAlerts('share_link', ORG_B, cap, 0, fake as any);
    // ORG_B 是獨立的 org，再觸發 2 封
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(4);
  });
});

describe('recordUsage', () => {
  it('atomically increments org + platform counters', async () => {
    const fake = makeFakeClient({});
    const r1 = await recordUsage(ORG_A, 'pdf_export', 1, fake as any);
    expect(r1.orgUsed).toBe(1);
    expect(r1.platformUsed).toBe(1);

    const r2 = await recordUsage(ORG_A, 'pdf_export', 3, fake as any);
    expect(r2.orgUsed).toBe(4);
    expect(r2.platformUsed).toBe(4);
  });

  it('triggers alert via checkAndSendAlerts when crossing threshold', async () => {
    const fake = makeFakeClient({});
    const cap = PLAN_LIMITS.perOrg.share_link;
    const at80 = Math.ceil(cap * 0.8);

    for (let i = 0; i < at80; i++) {
      await recordUsage(ORG_A, 'share_link', 1, fake as any);
    }
    expect(sendQuotaAlertEmail).toHaveBeenCalledTimes(1);
  });
});
