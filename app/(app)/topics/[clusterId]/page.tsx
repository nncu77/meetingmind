import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { loadTimeline } from '@/lib/topics/timeline';
import TimelineView from './TimelineView';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function TopicTimelinePage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = await params;

  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) notFound();

  // RLS 自動限定:該 user 看得到的 cluster 才會回
  const { data: cluster } = await sb
    .from('topic_clusters')
    .select('id')
    .eq('id', clusterId)
    .maybeSingle();
  if (!cluster) notFound();

  // 撈 timeline（用 admin client 因為要 JOIN 多張表）
  const admin = getSupabaseAdmin();
  const bundle = await loadTimeline(admin, clusterId);
  if (!bundle) notFound();

  return <TimelineView initialBundle={bundle} clusterId={clusterId} />;
}
