import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import MeetingReview from './MeetingReview';

export type ReviewData = {
  meeting: Database['public']['Tables']['meetings']['Row'];
  speakerSegments: Database['public']['Tables']['speaker_segments']['Row'][];
  transcriptSegments: Database['public']['Tables']['transcript_segments']['Row'][];
  topicSegments: Database['public']['Tables']['topic_segments']['Row'][];
  actionItems: Database['public']['Tables']['action_items']['Row'][];
  decisions: Database['public']['Tables']['decisions']['Row'][];
  openQuestions: Database['public']['Tables']['open_questions']['Row'][];
  uniqueSpeakers: string[];
};

async function fetchMeeting(id: string): Promise<ReviewData | null> {
  const sb = await createSupabaseServerClient();
  const [meeting, speakerSegs, transcript, topics, actionItems, decisions, openQuestions] =
    await Promise.all([
      sb.from('meetings').select('*').eq('id', id).maybeSingle(),
      sb.from('speaker_segments').select('*').eq('meeting_id', id).order('start_seconds'),
      sb.from('transcript_segments').select('*').eq('meeting_id', id).order('start_seconds'),
      sb.from('topic_segments').select('*').eq('meeting_id', id).order('ordinal'),
      sb.from('action_items').select('*').eq('meeting_id', id).order('source_start_seconds'),
      sb.from('decisions').select('*').eq('meeting_id', id).order('source_start_seconds'),
      sb.from('open_questions').select('*').eq('meeting_id', id).order('created_at'),
    ]);
  if (!meeting.data) return null;

  const transcriptSegments = transcript.data ?? [];
  const speakerSegments = speakerSegs.data ?? [];
  const speakerSet = new Set<string>();
  for (const s of speakerSegments) speakerSet.add(s.speaker_label);
  for (const t of transcriptSegments) if (t.speaker_label) speakerSet.add(t.speaker_label);

  return {
    meeting: meeting.data,
    speakerSegments,
    transcriptSegments,
    topicSegments: topics.data ?? [],
    actionItems: actionItems.data ?? [],
    decisions: decisions.data ?? [],
    openQuestions: openQuestions.data ?? [],
    uniqueSpeakers: Array.from(speakerSet).sort(),
  };
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await fetchMeeting(id);
  if (!data) notFound();
  return <MeetingReview data={data} />;
}
