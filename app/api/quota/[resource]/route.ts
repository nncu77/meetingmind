import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkQuota } from '@/lib/quota';
import { RESOURCE_TYPES, type ResourceType } from '@/lib/quota/limits';

export const dynamic = 'force-dynamic';

/**
 * Generic quota check endpoint. UI 在 form 載入時呼叫此 endpoint 顯示用量
 * 進度條 + disable 超額按鈕。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  if (!RESOURCE_TYPES.includes(resource as ResourceType)) {
    return NextResponse.json({ error: 'bad_resource' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const { data: member } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'no_org_membership' }, { status: 403 });

  const q = await checkQuota(member.org_id, resource as ResourceType);
  return NextResponse.json({
    quota: {
      allowed: q.allowed,
      reason: q.allowed ? null : (q as any).reason,
      orgUsed: q.orgUsed,
      orgLimit: q.orgLimit,
      platformUsed: q.platformUsed,
      platformLimit: q.platformLimit,
    },
  });
}
