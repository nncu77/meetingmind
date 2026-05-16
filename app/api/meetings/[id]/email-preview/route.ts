import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildDigestBundle, renderDigestHtml } from '@/lib/email/meeting-digest';

export const dynamic = 'force-dynamic';

/**
 * 給 SendEmailModal 的 iframe 用。回傳 server-rendered HTML，
 * URL 可帶 ?msg= 顯示「附加訊息」的即時預覽（client 不必跑 React Email）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response('unauthorised', { status: 401 });
  }

  const { data: member } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) {
    return new Response('no_org_membership', { status: 403 });
  }

  // RLS check
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return new Response('meeting_not_found_or_forbidden', { status: 404 });
  }

  const url = new URL(req.url);
  const msg = url.searchParams.get('msg');

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
    appendedMessage: msg ?? null,
  });
  if (!bundle) {
    return new Response('meeting_data_missing', { status: 500 });
  }
  const html = await renderDigestHtml(bundle.props);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 不被搜尋引擎索引（雖然要登入才能讀）
      'x-robots-tag': 'noindex, nofollow',
      // 快取一小段時間，避免拖動 textarea 時每次 keystroke 都打 server
      'cache-control': 'private, max-age=2',
    },
  });
}
