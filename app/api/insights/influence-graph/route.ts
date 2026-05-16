import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const RANGE_DAYS = { '7': 7, '30': 30, '90': 90, all: null } as const;
type RangeKey = keyof typeof RANGE_DAYS;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get('range') ?? '30') as RangeKey;
  const days = RANGE_DAYS[rangeParam] ?? 30;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const { data: me } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: 'no_org_membership' }, { status: 403 });

  const admin = getSupabaseAdmin();

  // 撈該 org 所有 members（節點候選）
  const { data: members } = await admin
    .from('members')
    .select('id, name, voice_embedding')
    .eq('org_id', me.org_id);
  const orgMembers = (members ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    hasVoice: m.voice_embedding != null,
  }));

  // 撈時間區間內,該 org 所有有效的 action_items + meeting
  const since = days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;

  let query = admin
    .from('action_items')
    .select(`
      id, owner_member_id, created_by_member_id, created_at,
      meeting:meetings!inner(id, title, created_at, org_id)
    `)
    .eq('meeting.org_id', me.org_id)
    .not('owner_member_id', 'is', null)
    .not('created_by_member_id', 'is', null);
  if (since) query = query.gte('meeting.created_at', since);

  const { data: rawActions, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'query_failed', message: error.message }, { status: 500 });
  }

  type ActionRow = {
    id: string;
    owner_member_id: string;
    created_by_member_id: string;
    created_at: string;
    meeting: { id: string; title: string; created_at: string; org_id: string };
  };
  const actions: ActionRow[] = (rawActions as any[]).filter(
    (a) =>
      a.owner_member_id &&
      a.created_by_member_id &&
      a.owner_member_id !== a.created_by_member_id &&
      a.meeting,
  ) as ActionRow[];

  // 聚合連線
  const linkMap = new Map<
    string,
    { source: string; target: string; weight: number; lastInteraction: string }
  >();
  // 每個 member 的「指派他人 / 被指派」分組統計
  const perMember: Record<
    string,
    {
      assigns: Record<string, number>;
      assigned: Record<string, number>;
      taskCount: number;
      recentMeetings: { id: string; title: string; date: string }[];
    }
  > = {};

  function bucket(id: string) {
    if (!perMember[id]) {
      perMember[id] = { assigns: {}, assigned: {}, taskCount: 0, recentMeetings: [] };
    }
    return perMember[id];
  }

  for (const a of actions) {
    const key = `${a.created_by_member_id}::${a.owner_member_id}`;
    const existing = linkMap.get(key);
    const interaction = a.meeting.created_at;
    if (existing) {
      existing.weight += 1;
      if (interaction > existing.lastInteraction) existing.lastInteraction = interaction;
    } else {
      linkMap.set(key, {
        source: a.created_by_member_id,
        target: a.owner_member_id,
        weight: 1,
        lastInteraction: interaction,
      });
    }
    const src = bucket(a.created_by_member_id);
    const tgt = bucket(a.owner_member_id);
    src.assigns[a.owner_member_id] = (src.assigns[a.owner_member_id] ?? 0) + 1;
    tgt.assigned[a.created_by_member_id] = (tgt.assigned[a.created_by_member_id] ?? 0) + 1;
    tgt.taskCount += 1; // node 大小用「被指派次數」
  }

  // 把每個 member 最近 5 場有交互的會議
  const meetingsByMember = new Map<string, Map<string, { title: string; date: string }>>();
  for (const a of actions) {
    for (const memberId of [a.created_by_member_id, a.owner_member_id]) {
      if (!meetingsByMember.has(memberId)) meetingsByMember.set(memberId, new Map());
      const inner = meetingsByMember.get(memberId)!;
      if (!inner.has(a.meeting.id)) {
        inner.set(a.meeting.id, { title: a.meeting.title, date: a.meeting.created_at });
      }
    }
  }
  for (const [memberId, mtgMap] of meetingsByMember) {
    bucket(memberId).recentMeetings = Array.from(mtgMap.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 5);
  }

  const memberById = new Map(orgMembers.map((m) => [m.id, m]));

  const nodes = orgMembers
    .filter((m) => perMember[m.id]) // 沒有任何交互的 member 不畫
    .map((m) => ({
      id: m.id,
      name: m.name,
      hasVoice: m.hasVoice,
      taskCount: perMember[m.id]?.taskCount ?? 0,
    }));

  const links = Array.from(linkMap.values())
    // 兩端都得在 nodes 裡（防 RLS 邊緣 case 漏 member）
    .filter((l) => memberById.has(l.source) && memberById.has(l.target));

  // 把 perMember 內的 ids 轉成 {memberId, name, count} 方便前端
  const perMemberOut: Record<
    string,
    {
      assigns: { memberId: string; name: string; count: number }[];
      assigned: { memberId: string; name: string; count: number }[];
      recentMeetings: { id: string; title: string; date: string }[];
    }
  > = {};
  for (const [id, p] of Object.entries(perMember)) {
    perMemberOut[id] = {
      assigns: Object.entries(p.assigns).map(([mid, count]) => ({
        memberId: mid,
        name: memberById.get(mid)?.name ?? '(未知)',
        count,
      })),
      assigned: Object.entries(p.assigned).map(([mid, count]) => ({
        memberId: mid,
        name: memberById.get(mid)?.name ?? '(未知)',
        count,
      })),
      recentMeetings: p.recentMeetings,
    };
  }

  return NextResponse.json({
    nodes,
    links,
    perMember: perMemberOut,
    me: { id: me.id },
    range: rangeParam,
  });
}
