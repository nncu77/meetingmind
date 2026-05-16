import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 把已被 quota_blocked 的 strict meeting 改回 standard 並重新派工。
 * 不會撤銷已 recordUsage 的 strict 額度（因為其實沒扣到 — 進 quota_blocked
 * 前就攔了），但會把 privacy_level 改成 standard。
 */
export async function POST(
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

  // RLS 驗證
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, status, privacy_level, audio_url, language, org_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: 'meeting_not_found_or_forbidden' }, { status: 404 });
  }
  if (meeting.status !== 'quota_blocked') {
    return NextResponse.json(
      { error: 'wrong_status', message: '只能重新處理 quota_blocked 狀態的會議' },
      { status: 409 },
    );
  }
  if (!meeting.audio_url) {
    return NextResponse.json({ error: 'no_audio' }, { status: 409 });
  }

  // service-role 寫:改 privacy_level 並 status 回 pending
  const admin = getSupabaseAdmin();
  const { error: updateErr } = await admin
    .from('meetings')
    .update({
      privacy_level: 'standard',
      status: 'pending',
      error_message: null,
      processed_at: null,
    })
    .eq('id', meetingId);
  if (updateErr) {
    return NextResponse.json(
      { error: 'update_failed', message: updateErr.message },
      { status: 500 },
    );
  }

  // 重新派 Inngest event
  await inngest.send({
    name: 'meeting/process.requested',
    data: {
      meetingId,
      audioUrl: meeting.audio_url,
      language: meeting.language as 'zh' | 'zh-en',
      privacyLevel: 'standard',
    },
  });

  return NextResponse.json({ ok: true });
}
