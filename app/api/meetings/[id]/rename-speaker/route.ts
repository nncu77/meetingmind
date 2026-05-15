import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const Body = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
});

/**
 * POST /api/meetings/[id]/rename-speaker
 * Body: { from: "SPEAKER_02", to: "業務部 Peter" }
 *
 * Renames a speaker label across all rows in this meeting:
 *   - speaker_segments.speaker_label
 *   - transcript_segments.speaker_label
 *   - action_items.source_speaker
 *
 * Per-meeting scope. Cross-meeting persistence is handled by voice enrollment.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  // Verify the user can see this meeting (RLS does the work)
  const { data: meeting } = await sb.from('meetings').select('id').eq('id', id).maybeSingle();
  if (!meeting) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { from, to } = parsed.data;
  if (from === to) return NextResponse.json({ updated: 0 });

  // Service-role for the cascade update (RLS already verified above)
  const admin = getSupabaseAdmin();
  const [ss, ts, ai] = await Promise.all([
    admin.from('speaker_segments').update({ speaker_label: to }).eq('meeting_id', id).eq('speaker_label', from).select('id'),
    admin.from('transcript_segments').update({ speaker_label: to }).eq('meeting_id', id).eq('speaker_label', from).select('id'),
    admin.from('action_items').update({ source_speaker: to }).eq('meeting_id', id).eq('source_speaker', from).select('id'),
  ]);

  return NextResponse.json({
    updated: {
      speaker_segments: ss.data?.length ?? 0,
      transcript_segments: ts.data?.length ?? 0,
      action_items: ai.data?.length ?? 0,
    },
  });
}
