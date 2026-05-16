import { inngest, type MeetingProcessEvent } from './client';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkQuota, recordUsage } from '@/lib/quota';

/**
 * Inngest function: dispatch an audio job to the Python worker on Modal.
 *
 * The worker takes 3–6 minutes for a 60-minute audio file, well past
 * Vercel's serverless 60s ceiling — Inngest's step.run gives us
 * automatic retries and observability.
 *
 * Phase 11: strict 模式（Llama 70B via Together AI）有獨立的 monthly quota，
 * 在進 worker 前先檢查；不通過就把 status 設成 'quota_blocked'，前端會顯示
 * 「改用標準模式重新處理」按鈕。
 */
export const processMeeting = inngest.createFunction(
  {
    id: 'process-meeting',
    retries: 2,
    triggers: [{ event: 'meeting/process.requested' }],
  },
  async ({ event, step }) => {
    const { meetingId, audioUrl, language, privacyLevel } =
      event.data as MeetingProcessEvent['data'];

    // Phase 11: strict 走 Llama 70B → 先 quota check
    const isStrict = privacyLevel === 'strict';
    if (isStrict) {
      const quotaOk = await step.run('check-strict-quota', async () => {
        // 拿 meeting 的 org_id 來查 quota
        const { data: m } = await getSupabaseAdmin()
          .from('meetings')
          .select('org_id')
          .eq('id', meetingId)
          .maybeSingle();
        if (!m) return { allowed: false, reason: 'meeting_missing' as const };

        const q = await checkQuota(m.org_id, 'strict_meeting');
        if (!q.allowed) {
          return {
            allowed: false as const,
            reason: q.reason as 'org_limit' | 'platform_limit',
            orgUsed: q.orgUsed,
            orgLimit: q.orgLimit,
          };
        }
        // 通過 → 立刻 recordUsage 佔位（spec 規約「通過 → 繼續處理 + recordUsage」）
        await recordUsage(m.org_id, 'strict_meeting');
        return { allowed: true as const, orgId: m.org_id };
      });

      if (!quotaOk.allowed) {
        await step.run('mark-quota-blocked', async () => {
          const reasonMsg =
            quotaOk.reason === 'org_limit'
              ? '本月嚴格模式額度已用完'
              : quotaOk.reason === 'platform_limit'
              ? '平台本月嚴格模式額度已用完'
              : '無法檢查嚴格模式額度';
          await getSupabaseAdmin()
            .from('meetings')
            .update({
              status: 'quota_blocked',
              error_message: reasonMsg,
              processed_at: new Date().toISOString(),
            })
            .eq('id', meetingId);
        });
        return { quotaBlocked: true, reason: quotaOk.reason };
      }
    }

    await step.run('mark-processing', async () => {
      await getSupabaseAdmin()
        .from('meetings')
        .update({ status: 'processing' })
        .eq('id', meetingId);
    });

    const result = await step.run('call-worker', async () => {
      const workerUrl = process.env.WORKER_URL;
      if (!workerUrl) throw new Error('WORKER_URL not set');

      const res = await fetch(`${workerUrl}/process`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}`,
        },
        body: JSON.stringify({
          meeting_id: meetingId,
          audio_url: audioUrl,
          language,
          privacy_level: privacyLevel,
        }),
      });

      if (!res.ok) {
        throw new Error(`Worker ${res.status}: ${await res.text()}`);
      }
      return res.json();
    });

    await step.run('mark-done', async () => {
      // worker 會自己 update status='done' + llm_provider，這裡只是
      // 保險（與既有行為一致），如果 worker 沒寫到 status 則由這步補上
      await getSupabaseAdmin()
        .from('meetings')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', meetingId);
    });

    return result;
  },
);
