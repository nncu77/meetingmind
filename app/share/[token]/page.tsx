import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { clientIpFromRequest, rateLimit } from '@/lib/rate-limit';
import type { Database } from '@/lib/supabase/types';
import SharedReview from './SharedReview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  // 公開頁就算被連結到也不要被搜尋引擎索引
  robots: { index: false, follow: false },
  title: 'MeetingMind 分享連結',
};

type Props = { params: Promise<{ token: string }> };

export default async function SharePage({ params }: Props) {
  const { token } = await params;

  // ---- 1. Rate limit（30 / min / IP）----
  const h = await headers();
  const ip = clientIpFromRequest(h);
  const rl = rateLimit(`share:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return <ErrorPage title="請求過於頻繁" detail="請稍候片刻再試。" />;
  }

  // ---- 2. Look up token via service-role（訪客沒登入）----
  const admin = getSupabaseAdmin();
  const { data: link } = await admin
    .from('meeting_share_links')
    .select('id, meeting_id, expires_at, revoked_at, view_count, org_id')
    .eq('token', token)
    .maybeSingle();

  if (!link) {
    return <ErrorPage title="此連結無效或已過期" />;
  }
  if (link.revoked_at) {
    return <ErrorPage title="此連結無效或已過期" />;
  }
  if (link.expires_at && new Date(link.expires_at) <= new Date()) {
    return <ErrorPage title="此連結無效或已過期" />;
  }

  // ---- 3. Fetch meeting + related data ----
  const meetingId = link.meeting_id;
  const [meetingRes, topicsRes, actionsRes, decisionsRes, openQsRes, transcriptRes, orgRes] =
    await Promise.all([
      admin.from('meetings').select('*').eq('id', meetingId).maybeSingle(),
      admin.from('topic_segments').select('*').eq('meeting_id', meetingId).order('ordinal'),
      admin.from('action_items').select('*').eq('meeting_id', meetingId).order('source_start_seconds'),
      admin.from('decisions').select('*').eq('meeting_id', meetingId).order('source_start_seconds'),
      admin.from('open_questions').select('*').eq('meeting_id', meetingId).order('created_at'),
      admin
        .from('transcript_segments')
        .select('*')
        .eq('meeting_id', meetingId)
        .order('start_seconds'),
      admin.from('organizations').select('name').eq('id', link.org_id).maybeSingle(),
    ]);

  if (!meetingRes.data || meetingRes.data.status !== 'done') {
    return <ErrorPage title="此會議尚未處理完成或已被移除" />;
  }
  const meeting = meetingRes.data;

  // ---- 4. Resolve member names for action item / decision display ----
  const actionItems = actionsRes.data ?? [];
  const decisions = decisionsRes.data ?? [];
  const memberIdSet = new Set<string>();
  for (const a of actionItems) if (a.owner_member_id) memberIdSet.add(a.owner_member_id);
  for (const d of decisions) for (const id of d.agreed_by_member_ids ?? []) memberIdSet.add(id);

  let memberMap = new Map<string, string>();
  if (memberIdSet.size > 0) {
    const { data: members } = await admin
      .from('members')
      .select('id, name')
      .in('id', Array.from(memberIdSet));
    memberMap = new Map((members ?? []).map((m) => [m.id, m.name]));
  }

  // ---- 5. Re-sign audio URL so 永久 link 也有可用音檔 ----
  const audioUrl = await reSignAudioIfPossible(admin, meeting.audio_url);

  // ---- 6. Fire-and-forget: view_count++（不 await，不阻塞渲染）----
  void admin
    .from('meeting_share_links')
    .update({ view_count: (link.view_count ?? 0) + 1 })
    .eq('id', link.id);

  return (
    <SharedReview
      meeting={{
        id: meeting.id,
        title: meeting.title,
        durationSeconds: meeting.duration_seconds,
        createdAt: meeting.created_at,
        audioUrl,
      }}
      topics={topicsRes.data ?? []}
      actionItems={actionItems.map((a) => ({
        id: a.id,
        description: a.description,
        ownerLabel: a.owner_member_id
          ? memberMap.get(a.owner_member_id) ?? a.owner_raw_name ?? null
          : a.owner_raw_name,
        dueLabel: a.due_date ?? a.due_date_raw ?? null,
        sourceQuote: a.source_quote,
        sourceStartSeconds: a.source_start_seconds,
        confidence: a.confidence,
      }))}
      decisions={decisions.map((d) => ({
        id: d.id,
        description: d.description,
        agreedByLabels: (d.agreed_by_member_ids ?? [])
          .map((id) => memberMap.get(id))
          .filter((x): x is string => !!x),
        sourceQuote: d.source_quote,
      }))}
      openQuestions={(openQsRes.data ?? []).map((q) => ({
        id: q.id,
        question: q.question,
        raisedBy: q.raised_by_speaker,
      }))}
      transcript={(transcriptRes.data ?? []).map((t) => ({
        id: t.id,
        speaker: t.speaker_label,
        text: t.text,
        startSeconds: t.start_seconds,
        endSeconds: t.end_seconds,
      }))}
      orgName={orgRes.data?.name ?? 'MeetingMind'}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function reSignAudioIfPossible(
  admin: ReturnType<typeof getSupabaseAdmin>,
  audioUrl: string | null,
): Promise<string | null> {
  if (!audioUrl) return null;
  // 從原 signed URL 抽出 storage object path：
  //   https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
  const match = /\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/.exec(audioUrl);
  if (!match) return audioUrl; // 不是預期格式，原樣回傳（過期就過期）
  const bucket = match[1];
  const objectPath = decodeURIComponent(match[2]);
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24);
  if (error || !data) return audioUrl;
  return data.signedUrl;
}

function ErrorPage({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {detail ? <p className="mt-2 text-sm text-slate-600">{detail}</p> : null}
        <p className="mt-4 text-xs text-slate-400">
          MeetingMind · meetingmind-xi.vercel.app
        </p>
      </div>
    </main>
  );
}
