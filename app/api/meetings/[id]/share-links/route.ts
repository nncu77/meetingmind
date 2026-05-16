import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkQuota, recordUsage } from '@/lib/quota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DURATIONS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  permanent: null,
} as const;

const CreateBody = z.object({
  duration: z.enum(['7d', '30d', 'permanent']),
});

// ----- GET: list all links for this meeting -----
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await params;
  const auth = await authMeeting(meetingId);
  if (auth.error) return auth.error;

  const sb = auth.supabase;
  const { data, error } = await sb
    .from('meeting_share_links')
    .select('id, token, expires_at, revoked_at, view_count, created_at')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'list_failed', message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ links: data ?? [] });
}

// ----- POST: create new link -----
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await params;
  const auth = await authMeeting(meetingId);
  if (auth.error) return auth.error;

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'bad_request', message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Quota check（先檢查不扣）
  const quota = await checkQuota(auth.orgId, 'share_link');
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: 'QUOTA_EXCEEDED',
        reason: quota.reason,
        message:
          quota.reason === 'org_limit'
            ? `本月分享連結額度已用完（${quota.orgUsed}/${quota.orgLimit}），下個月 1 號重置`
            : `平台本月分享連結額度已用完，請聯絡管理員`,
      },
      { status: 429 },
    );
  }

  // Generate token: 24 bytes → 32 base64url chars
  const token = crypto.randomBytes(24).toString('base64url');
  const durationMs = DURATIONS[body.duration];
  const expiresAt = durationMs == null ? null : new Date(Date.now() + durationMs).toISOString();

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('meeting_share_links')
    .insert({
      meeting_id: meetingId,
      org_id: auth.orgId,
      token,
      expires_at: expiresAt,
      created_by: auth.userId,
    })
    .select('id, token, expires_at, created_at, view_count, revoked_at')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: 'create_failed', message: error?.message ?? 'unknown' },
      { status: 500 },
    );
  }

  // 建立成功才 recordUsage
  await recordUsage(auth.orgId, 'share_link');

  return NextResponse.json({ link: data });
}

// ---------------------------------------------------------------------------
// 共用 auth helper
// ---------------------------------------------------------------------------

async function authMeeting(meetingId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: 'unauthorised' }, { status: 401 }),
      supabase,
      orgId: '',
      userId: '',
    };
  }

  const { data: member } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) {
    return {
      error: NextResponse.json({ error: 'no_org_membership' }, { status: 403 }),
      supabase,
      orgId: '',
      userId: user.id,
    };
  }

  // RLS verifies user can read this meeting
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return {
      error: NextResponse.json(
        { error: 'meeting_not_found_or_forbidden' },
        { status: 404 },
      ),
      supabase,
      orgId: member.org_id,
      userId: user.id,
    };
  }

  return { error: null, supabase, orgId: member.org_id, userId: user.id };
}
