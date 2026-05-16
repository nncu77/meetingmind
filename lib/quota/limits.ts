/**
 * Phase 0 雙層 quota 上限。
 *
 * 設計原則：
 *   - perOrg：防單一 org 燒掉全平台預算
 *   - platform：防多 org 一起把預算炸到底
 *   - alertAt：達該 % 時寄一封警示信給 ALERT_RECIPIENT_EMAIL（同月不重複）
 *
 * 與既有 lib/cost/estimate.ts PLAN_LIMITS 完全分離：
 *   - 那一份管「處理會議的成本上限」（per-meeting 等級）
 *   - 這一份管「v2 新功能的使用次數」（feature-call 等級）
 */

export type ResourceType =
  | 'email_send'
  | 'strict_meeting'
  | 'share_link'
  | 'pdf_export'
  | 'docx_export'
  | 'topic_timeline_query';

export const RESOURCE_TYPES: readonly ResourceType[] = [
  'email_send',
  'strict_meeting',
  'share_link',
  'pdf_export',
  'docx_export',
  'topic_timeline_query',
] as const;

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  email_send: '寄送會議紀錄 email',
  strict_meeting: '嚴格模式會議（Llama 70B）',
  share_link: '公開分享連結',
  pdf_export: '匯出 PDF',
  docx_export: '匯出 Word',
  topic_timeline_query: '議題時間軸摘要',
};

export const PLAN_LIMITS = {
  perOrg: {
    email_send: 30,
    strict_meeting: 5,
    share_link: 5,
    pdf_export: 100,
    docx_export: 100,
    topic_timeline_query: 50,
  },
  platform: {
    email_send: 1000,
    strict_meeting: 50,
    share_link: 500,
    pdf_export: 5000,
    docx_export: 5000,
    topic_timeline_query: 2000,
  },
  alertAt: [80, 100] as const,
} as const;

export function getOrgLimit(resourceType: ResourceType): number {
  return PLAN_LIMITS.perOrg[resourceType];
}

export function getPlatformLimit(resourceType: ResourceType): number {
  return PLAN_LIMITS.platform[resourceType];
}
