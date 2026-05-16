import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkQuota } from '@/lib/quota';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await params;

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

  // RLS 確認 user 看得到這場 meeting
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: 'meeting_not_found_or_forbidden' }, { status: 404 });
  }

  const quota = await checkQuota(member.org_id, 'share_link');
  return NextResponse.json({
    quota: {
      allowed: quota.allowed,
      reason: quota.allowed ? null : (quota as any).reason,
      orgUsed: quota.orgUsed,
      orgLimit: quota.orgLimit,
      platformUsed: quota.platformUsed,
      platformLimit: quota.platformLimit,
    },
  });
}
