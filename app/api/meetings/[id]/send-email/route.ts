import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Resend } from 'resend';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkQuota, recordUsage } from '@/lib/quota';
import { buildDigestBundle, renderDigestHtml, defaultSubject } from '@/lib/email/meeting-digest';

const Body = z.object({
  recipients: z.array(z.string().email()).min(1).max(50),
  subject: z.string().min(1).max(500).optional(),
  appendedMessage: z.string().max(2000).optional(),
});

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await params;

  // ----- 解析 + 驗證 user / org -----
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { data: member } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: 'no_org_membership' }, { status: 403 });
  }

  // ----- 確認 user 真的可以讀這場 meeting（RLS 會擋）-----
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, org_id, title, created_at, status')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: 'meeting_not_found_or_forbidden' }, { status: 404 });
  }
  if (meeting.status !== 'done') {
    return NextResponse.json(
      { error: 'meeting_not_ready', message: '會議尚未處理完成，無法寄送紀錄' },
      { status: 409 },
    );
  }

  // ----- Parse body -----
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'bad_request', message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // ----- Quota check（先檢查不扣）-----
  const quota = await checkQuota(member.org_id, 'email_send');
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: 'QUOTA_EXCEEDED',
        reason: quota.reason,
        message:
          quota.reason === 'org_limit'
            ? `本月寄信額度已用完（${quota.orgUsed}/${quota.orgLimit}），下個月 1 號重置`
            : `平台本月寄信額度已用完，請聯絡管理員`,
      },
      { status: 429 },
    );
  }

  // ----- 用 admin client 抓 org name + digest data（service-role 確保即使會議是 confidential 也讀得到）-----
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
    appendedMessage: body.appendedMessage ?? null,
  });
  if (!bundle) {
    return NextResponse.json({ error: 'meeting_data_missing' }, { status: 500 });
  }

  const html = await renderDigestHtml(bundle.props);
  const subject = body.subject?.trim() || defaultSubject(meeting.title, meeting.created_at);

  // ----- Resend 寄送 -----
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'resend_not_configured', message: 'RESEND_API_KEY 未設定' },
      { status: 500 },
    );
  }
  const resend = new Resend(apiKey);
  const fromAddr = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
  const fromLine = `${org?.name ?? 'MeetingMind'} 透過 MeetingMind <${fromAddr}>`;

  const recipients = Array.from(new Set(body.recipients.map((e) => e.trim().toLowerCase()))).filter(Boolean);

  // 寫一筆 pending 紀錄，方便事後追
  const pendingInsert = await admin
    .from('email_sends')
    .insert({
      meeting_id: meetingId,
      sent_by: user.id,
      recipients,
      subject,
      status: 'pending',
    })
    .select('id')
    .single();
  const sendId = pendingInsert.data?.id ?? null;

  try {
    const { data: sendResult, error: sendErr } = await resend.emails.send({
      from: fromLine,
      to: recipients,
      subject,
      html,
    });
    if (sendErr) {
      if (sendId) {
        await admin
          .from('email_sends')
          .update({ status: 'failed', error_message: sendErr.message ?? 'unknown' })
          .eq('id', sendId);
      }
      return NextResponse.json(
        { error: 'resend_failed', message: sendErr.message ?? '寄送失敗' },
        { status: 502 },
      );
    }

    // ----- 成功 → recordUsage（Phase 0 規約：操作成功才扣額度）-----
    await recordUsage(member.org_id, 'email_send');

    if (sendId) {
      await admin
        .from('email_sends')
        .update({
          status: 'sent',
          resend_message_id: sendResult?.id ?? null,
        })
        .eq('id', sendId);
    }

    return NextResponse.json({
      ok: true,
      messageId: sendResult?.id ?? null,
      recipientCount: recipients.length,
    });
  } catch (e) {
    if (sendId) {
      await admin
        .from('email_sends')
        .update({
          status: 'failed',
          error_message: e instanceof Error ? e.message : String(e),
        })
        .eq('id', sendId);
    }
    return NextResponse.json(
      { error: 'send_exception', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
