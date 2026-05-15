import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * GET /api/meetings/[id]
 *
 * Returns everything needed to render the three-column review UI.
 * Uses service-role to bypass RLS for now — the MVP doesn't have browser-side
 * auth yet. Once Supabase auth login is wired, switch to the cookie-auth
 * server client and let RLS enforce visibility.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = getSupabaseAdmin();

  const [meeting, speakerSegs, transcript, topics, actionItems, decisions, openQuestions] =
    await Promise.all([
      admin.from('meetings').select('*').eq('id', id).maybeSingle(),
      admin
        .from('speaker_segments')
        .select('*')
        .eq('meeting_id', id)
        .order('start_seconds', { ascending: true }),
      admin
        .from('transcript_segments')
        .select('*')
        .eq('meeting_id', id)
        .order('start_seconds', { ascending: true }),
      admin
        .from('topic_segments')
        .select('*')
        .eq('meeting_id', id)
        .order('ordinal', { ascending: true }),
      admin
        .from('action_items')
        .select('*')
        .eq('meeting_id', id)
        .order('source_start_seconds', { ascending: true }),
      admin
        .from('decisions')
        .select('*')
        .eq('meeting_id', id)
        .order('source_start_seconds', { ascending: true }),
      admin
        .from('open_questions')
        .select('*')
        .eq('meeting_id', id)
        .order('created_at', { ascending: true }),
    ]);

  if (meeting.error || !meeting.data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({
    meeting: meeting.data,
    speakerSegments: speakerSegs.data ?? [],
    transcriptSegments: transcript.data ?? [],
    topicSegments: topics.data ?? [],
    actionItems: actionItems.data ?? [],
    decisions: decisions.data ?? [],
    openQuestions: openQuestions.data ?? [],
  });
}
