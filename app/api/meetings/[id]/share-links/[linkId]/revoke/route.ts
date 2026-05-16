import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id: meetingId, linkId } = await params;

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

  // 先用 RLS-protected client 確認這個 link 屬於 user 看得到的 meeting
  const { data: link } = await supabase
    .from('meeting_share_links')
    .select('id, org_id, meeting_id, revoked_at')
    .eq('id', linkId)
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (!link) {
    return NextResponse.json({ error: 'link_not_found_or_forbidden' }, { status: 404 });
  }
  if (link.org_id !== member.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (link.revoked_at) {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }

  // service-role 寫入（authenticated 沒 update policy）
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('meeting_share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId);
  if (error) {
    return NextResponse.json(
      { error: 'revoke_failed', message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
