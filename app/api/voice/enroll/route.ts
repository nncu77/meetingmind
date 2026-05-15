import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_CLIP_BYTES = 5 * 1024 * 1024; // 5 MB per clip

/**
 * POST /api/voice/enroll  (multipart/form-data)
 *
 * Fields:
 *   memberId: uuid
 *   clip: File (repeated, expected 3 entries)
 *
 * Flow:
 *   1. Verify caller is in same org as memberId
 *   2. Upload each clip to Storage with service-role
 *   3. Generate signed URLs for the worker
 *   4. POST {member_id, audio_urls} to worker /voice/enroll
 *   5. Worker downloads, embeds via Resemblyzer, writes mean to members.voice_embedding
 */
export async function POST(req: Request) {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const fd = await req.formData();
  const memberId = fd.get('memberId')?.toString();
  const clips = fd.getAll('clip').filter((v): v is File => v instanceof File);
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 });
  if (clips.length < 1) return NextResponse.json({ error: 'no clips' }, { status: 400 });
  if (clips.length > 5) return NextResponse.json({ error: 'too many clips' }, { status: 400 });
  for (const c of clips) {
    if (c.size > MAX_CLIP_BYTES) {
      return NextResponse.json(
        { error: `clip exceeds ${MAX_CLIP_BYTES} bytes` },
        { status: 413 },
      );
    }
  }

  // Verify member is in caller's org
  const { data: caller } = await sb
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const { data: target } = await sb
    .from('members')
    .select('id, org_id')
    .eq('id', memberId)
    .maybeSingle();
  if (!caller || !target || caller.org_id !== target.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const ts = Date.now();
  const audioUrls: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const ext = mimeToExt(clip.type);
    const objectPath = `voice-enroll/${target.org_id}/${memberId}/${ts}-${i}.${ext}`;
    const buf = Buffer.from(await clip.arrayBuffer());

    const up = await admin.storage
      .from('meeting-audio')
      .upload(objectPath, buf, { contentType: clip.type || 'audio/webm', upsert: true });
    if (up.error) {
      return NextResponse.json(
        { error: `upload failed: ${up.error.message}` },
        { status: 500 },
      );
    }

    const signed = await admin.storage
      .from('meeting-audio')
      .createSignedUrl(objectPath, 60 * 60); // 1h is enough for worker call
    if (!signed.data) {
      return NextResponse.json({ error: 'sign failed' }, { status: 500 });
    }
    audioUrls.push(signed.data.signedUrl);
  }

  // Call worker
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json({ error: 'WORKER_URL not configured' }, { status: 500 });
  }
  const workerRes = await fetch(`${workerUrl}/voice/enroll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WORKER_SHARED_SECRET || ''}`,
    },
    body: JSON.stringify({ member_id: memberId, audio_urls: audioUrls }),
  });
  if (!workerRes.ok) {
    const txt = await workerRes.text();
    return NextResponse.json(
      { error: `worker error ${workerRes.status}: ${txt.slice(0, 300)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, member_id: memberId, clips: audioUrls.length });
}

function mimeToExt(mime: string): string {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}
