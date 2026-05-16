import { Resend } from 'resend';
import { RESOURCE_LABELS } from './limits';
import type { AlertScope } from './types';

/**
 * Phase 0 alert email：用最簡單的 HTML 寄送，
 * 不引入 react-email（那是 Phase 1 才裝的）。
 *
 * From 預設 onboarding@resend.dev（Resend 沙箱 domain，
 * 不需 DNS 驗證但只能寄給帳號擁有者本人）。
 * 透過 RESEND_FROM_EMAIL env var 可以覆蓋。
 */

let cachedClient: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[quota] RESEND_API_KEY 未設定，alert email 跳過');
    return null;
  }
  if (!cachedClient) cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendQuotaAlertEmail(
  scope: AlertScope,
  meta: { orgUsed: number; orgLimit: number; platformUsed: number; platformLimit: number },
): Promise<void> {
  const to = process.env.ALERT_RECIPIENT_EMAIL;
  if (!to) {
    console.warn('[quota] ALERT_RECIPIENT_EMAIL 未設定，alert email 跳過');
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
  const resend = getResend();
  if (!resend) return;

  const resourceLabel = RESOURCE_LABELS[scope.resourceType];
  const subject = buildSubject(scope, resourceLabel);
  const html = buildHtml(scope, resourceLabel, meta);

  try {
    const { error } = await resend.emails.send({
      from: `MeetingMind 用量警示 <${from}>`,
      to: [to],
      subject,
      html,
    });
    if (error) {
      console.error('[quota] Resend 拒絕寄送 alert email:', error);
    }
  } catch (e) {
    console.error('[quota] sendQuotaAlertEmail 例外:', e);
  }
}

function buildSubject(scope: AlertScope, resourceLabel: string): string {
  const pct = scope.alertType.endsWith('100pct') ? '100%' : '80%';
  const tier = scope.kind === 'org' ? `Org ${scope.orgId.slice(0, 8)}` : '全平台';
  return `[MeetingMind] ${tier} ${resourceLabel} 已達 ${pct}`;
}

function buildHtml(
  scope: AlertScope,
  resourceLabel: string,
  meta: { orgUsed: number; orgLimit: number; platformUsed: number; platformLimit: number },
): string {
  const pct = scope.alertType.endsWith('100pct') ? 100 : 80;
  const color = pct === 100 ? '#dc2626' : '#ea580c';
  const tierLabel = scope.kind === 'org' ? `Org \`${scope.orgId}\`` : '全平台彙總';
  const used = scope.kind === 'org' ? meta.orgUsed : meta.platformUsed;
  const limit = scope.kind === 'org' ? meta.orgLimit : meta.platformLimit;

  return `<!doctype html>
<html lang="zh-Hant">
<body style="font-family: -apple-system, 'Noto Sans TC', sans-serif; padding: 24px; background: #f8fafc;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; border: 1px solid #e2e8f0;">
    <h2 style="color: ${color}; margin: 0 0 12px;">用量警示 · ${pct}%</h2>
    <p style="margin: 0 0 16px; color: #475569;">
      ${tierLabel} 的 <strong>${resourceLabel}</strong> 已達月度上限 ${pct}%。
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr style="background: #f1f5f9;">
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">已使用</td>
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>${used}</strong></td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">上限</td>
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${limit}</td>
      </tr>
      <tr style="background: #f1f5f9;">
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Org 當月用量</td>
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${meta.orgUsed} / ${meta.orgLimit}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">平台當月用量</td>
        <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${meta.platformUsed} / ${meta.platformLimit}</td>
      </tr>
    </table>
    <p style="color: #64748b; font-size: 13px; margin: 16px 0 0;">
      同月同警示只會寄一次。下個月 1 號 (UTC) 自動重置。
    </p>
    <p style="color: #94a3b8; font-size: 12px; margin: 24px 0 0;">
      MeetingMind · meetingmind-xi.vercel.app
    </p>
  </div>
</body>
</html>`;
}
