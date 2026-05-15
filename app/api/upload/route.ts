import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest/client';
import { PLAN_LIMITS, type Plan } from '@/lib/cost/estimate';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Match Supabase Storage bucket file_size_limit. Free tier is hard-capped at
// 50 MB per file; Pro plan supports up to 50 GB. If you upgrade and bump the
// bucket limit in Supabase Storage settings, override MAX_AUDIO_UPLOAD_MB here.
const MAX_AUDIO_UPLOAD_BYTES =
  (Number(process.env.MAX_AUDIO_UPLOAD_MB) || 50) * 1024 * 1024;

const Body = z.object({
  title: z.string().min(1).max(200),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive().max(MAX_AUDIO_UPLOAD_BYTES),
  durationSeconds: z.number().int().positive(),
  language: z.enum(['zh', 'zh-en']).default('zh'),
  privacyLevel: z.enum(['standard', 'enhanced', 'strict']).default('standard'),
  isConfidential: z.boolean().default(false),
});

/**
 * POST /api/upload
 *
 * Two-step upload (see PATCH below for the completion call).
 *
 * Cost guards applied here, BEFORE any audio bytes hit Storage:
 *   - durationSeconds is client-supplied (from HTML5 audio.duration).
 *     We re-verify in the worker via ffprobe; clients that lie get failed.
 *   - per-plan max audio length (PLAN_LIMITS.maxAudioSec)
 *   - per-user daily meeting quota (PLAN_LIMITS.dailyMeetings)
 *
 * If a meeting hits Storage but the worker rejects it, we still charge
 * pennies. The duration cap at this stage saves real money.
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  // Resolve org via members table
  const { data: member, error: memberErr } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (memberErr || !member) {
    return NextResponse.json({ error: 'no org membership' }, { status: 403 });
  }

  // ---------- Cost guards ---------------------------------------------------
  const { data: org } = await supabase
    .from('organizations')
    .select('plan')
    .eq('id', member.org_id)
    .single();
  const plan = (org?.plan ?? 'free') as Plan;
  const limits = PLAN_LIMITS[plan];

  if (body.durationSeconds > limits.maxAudioSec) {
    return NextResponse.json(
      {
        error: 'audio_too_long',
        message: `Plan "${plan}" caps audio at ${limits.maxAudioSec}s; got ${body.durationSeconds}s.`,
      },
      { status: 413 },
    );
  }

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .gte('created_at', startOfDayUtc.toISOString());

  if ((todayCount ?? 0) >= limits.dailyMeetings) {
    return NextResponse.json(
      {
        error: 'quota_exceeded',
        message: `Daily quota of ${limits.dailyMeetings} meetings reached for plan "${plan}".`,
      },
      { status: 429 },
    );
  }

  // Monthly cost cap: sum cost_estimate_cents across this org for the current
  // calendar month (UTC). Block new uploads once the cap is hit.
  const startOfMonthUtc = new Date();
  startOfMonthUtc.setUTCDate(1);
  startOfMonthUtc.setUTCHours(0, 0, 0, 0);
  const { data: monthRows } = await supabase
    .from('meetings')
    .select('cost_estimate_cents')
    .eq('org_id', member.org_id)
    .gte('created_at', startOfMonthUtc.toISOString());
  const monthSpentCents = (monthRows ?? []).reduce(
    (s, r) => s + (r.cost_estimate_cents ?? 0),
    0,
  );

  if (monthSpentCents >= limits.maxMonthlyCostCents) {
    return NextResponse.json(
      {
        error: 'monthly_cost_cap_reached',
        message: `本月用量已達 plan "${plan}" 上限 $${(limits.maxMonthlyCostCents / 100).toFixed(2)}。下個月自動重置或升級方案。`,
        spentCents: monthSpentCents,
        capCents: limits.maxMonthlyCostCents,
      },
      { status: 429 },
    );
  }

  // ---------- Create meeting row + signed upload URL -----------------------
  const { data: meeting, error: meetErr } = await supabase
    .from('meetings')
    .insert({
      org_id: member.org_id,
      title: body.title,
      language: body.language,
      privacy_level: body.privacyLevel,
      is_confidential: body.isConfidential,
      created_by: user.id,
      duration_seconds: body.durationSeconds,
    })
    .select('id')
    .single();
  if (meetErr || !meeting) {
    return NextResponse.json({ error: meetErr?.message ?? 'insert failed' }, { status: 500 });
  }

  const objectPath = `${member.org_id}/${meeting.id}/${Date.now()}-${body.filename}`;
  const admin = getSupabaseAdmin();
  const { data: signed, error: signErr } = await admin.storage
    .from('meeting-audio')
    .createSignedUploadUrl(objectPath);
  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message ?? 'signing failed' }, { status: 500 });
  }

  return NextResponse.json({
    meetingId: meeting.id,
    uploadUrl: signed.signedUrl,
    objectPath,
    token: signed.token,
    plan,
    limits,
  });
}

/**
 * PATCH /api/upload
 *
 * Called after the client PUT succeeds. Persists the audio URL on the
 * meeting row and enqueues the worker job via Inngest.
 */
export async function PATCH(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const Complete = z.object({
    meetingId: z.string().uuid(),
    objectPath: z.string().min(1),
    durationSeconds: z.number().int().nonnegative().optional(),
  });
  const parsed = Complete.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { meetingId, objectPath, durationSeconds } = parsed.data;

  const admin = getSupabaseAdmin();
  const { data: meeting } = await admin
    .from('meetings')
    .select('id, language, privacy_level, created_by')
    .eq('id', meetingId)
    .single();
  if (!meeting || meeting.created_by !== user.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { data: signed } = await admin.storage
    .from('meeting-audio')
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
  if (!signed) {
    return NextResponse.json({ error: 'signing failed' }, { status: 500 });
  }

  await admin
    .from('meetings')
    .update({
      audio_url: signed.signedUrl,
      duration_seconds: durationSeconds ?? null,
      status: 'pending',
    })
    .eq('id', meetingId);

  await inngest.send({
    name: 'meeting/process.requested',
    data: {
      meetingId,
      audioUrl: signed.signedUrl,
      language: meeting.language as 'zh' | 'zh-en',
      privacyLevel: meeting.privacy_level as 'standard' | 'enhanced' | 'strict',
    },
  });

  return NextResponse.json({ ok: true });
}
