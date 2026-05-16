import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkQuota, recordUsage } from '@/lib/quota';
import {
  loadTimeline,
  computeCurrentState,
  isStateCacheFresh,
} from '@/lib/topics/timeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/topics/[clusterId]/timeline
 *
 * Query params:
 *   refresh=1 → 強制重算 current_state（會 checkQuota + recordUsage）
 *
 * 回傳:
 *   {
 *     cluster: {...},
 *     events: [...],
 *     currentState: {... fromCache: bool} | null,
 *     quota?: { allowed, reason?, orgUsed, orgLimit, platformUsed, platformLimit }
 *   }
 *
 * current_state 邏輯:
 *   - cache fresh (< 30min) → 直接回 cached（不扣 quota）
 *   - cache stale 或 refresh=1 → 重算（先 checkQuota，成功 LLM → recordUsage）
 *   - quota 不夠 → 回 cached（若有）+ quota.allowed=false，前端顯示警示
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ clusterId: string }> },
) {
  const { clusterId } = await params;
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';

  // ----- Auth + RLS check -----
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const { data: member } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'no_org_membership' }, { status: 403 });

  // RLS 驗證 cluster 屬於 user 的 org
  const { data: clusterCheck } = await supabase
    .from('topic_clusters')
    .select('id, org_id, current_state_at')
    .eq('id', clusterId)
    .maybeSingle();
  if (!clusterCheck) {
    return NextResponse.json({ error: 'cluster_not_found_or_forbidden' }, { status: 404 });
  }

  // ----- Decide whether to (re)compute current_state -----
  const cacheFresh = isStateCacheFresh(clusterCheck.current_state_at);
  const shouldCompute = refresh || !cacheFresh;

  let quotaInfo: any = null;
  if (shouldCompute) {
    const q = await checkQuota(member.org_id, 'topic_timeline_query');
    quotaInfo = {
      allowed: q.allowed,
      reason: q.allowed ? null : (q as any).reason,
      orgUsed: q.orgUsed,
      orgLimit: q.orgLimit,
      platformUsed: q.platformUsed,
      platformLimit: q.platformLimit,
    };
    if (!q.allowed && refresh) {
      // 使用者主動 refresh 又超額 → 回 429
      return NextResponse.json(
        {
          error: 'QUOTA_EXCEEDED',
          reason: q.reason,
          message:
            q.reason === 'org_limit'
              ? `本月議題時間軸摘要額度已用完（${q.orgUsed}/${q.orgLimit}）`
              : '平台本月議題時間軸摘要額度已用完',
        },
        { status: 429 },
      );
    }
  }

  // ----- 用 admin client 撈完整 timeline -----
  const admin = getSupabaseAdmin();
  const bundle = await loadTimeline(admin, clusterId);
  if (!bundle) {
    return NextResponse.json({ error: 'cluster_not_found' }, { status: 404 });
  }

  // ----- 重算 current_state（如果有 quota & 需要）-----
  if (shouldCompute && quotaInfo?.allowed && bundle.events.length > 0) {
    try {
      const newState = await computeCurrentState(bundle.events);
      await admin
        .from('topic_clusters')
        .update({
          current_state_summary: {
            summary: newState.summary,
            next_step: newState.nextStep,
            open_blockers: newState.openBlockers,
          } as any,
          current_state_at: new Date().toISOString(),
        })
        .eq('id', clusterId);
      // LLM 成功 → 扣 quota
      await recordUsage(member.org_id, 'topic_timeline_query');

      bundle.currentState = {
        summary: newState.summary,
        nextStep: newState.nextStep,
        openBlockers: newState.openBlockers,
        computedAt: new Date().toISOString(),
        fromCache: false,
      };
    } catch (e) {
      console.error('[timeline] computeCurrentState failed:', e);
      // 失敗不扣 quota，回 cached（如果有）
    }
  }

  return NextResponse.json({
    ...bundle,
    quota: quotaInfo,
  });
}
