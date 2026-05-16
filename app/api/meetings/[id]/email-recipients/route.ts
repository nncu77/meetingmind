import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkQuota } from '@/lib/quota';
import { buildDigestBundle, defaultSubject } from '@/lib/email/meeting-digest';

export const dynamic = 'force-dynamic';

/**
 * SendEmailModal 開啟時呼叫：回預設收件人、預設主旨、quota 狀態、
 * 以及「N 條 action item 未分派」警示計數。
 */
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

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, created_at, status')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: 'meeting_not_found_or_forbidden' }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', member.org_id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://meetingmind-xi.vercel.app';
  const bundle = await buildDigestBundle({
    client: admin,
    meetingId,
    appUrl,
    orgName: org?.name ?? 'MeetingMind',
  });

  const quota = await checkQuota(member.org_id, 'email_send');

  return NextResponse.json({
    defaultRecipients: bundle?.recipients ?? [],
    unresolvedOwnerCount: bundle?.unresolvedOwnerCount ?? 0,
    defaultSubject: defaultSubject(meeting.title, meeting.created_at),
    quota: {
      allowed: quota.allowed,
      reason: quota.allowed ? null : (quota as any).reason,
      orgUsed: quota.orgUsed,
      orgLimit: quota.orgLimit,
      platformUsed: quota.platformUsed,
      platformLimit: quota.platformLimit,
    },
    meetingStatus: meeting.status,
  });
}
