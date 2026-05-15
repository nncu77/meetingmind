import { inngest, type MeetingProcessEvent } from './client';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Inngest function: dispatch an audio job to the Python worker on Modal.
 *
 * The worker takes 3–6 minutes for a 60-minute audio file, well past
 * Vercel's serverless 60s ceiling — Inngest's step.run gives us
 * automatic retries and observability.
 */
export const processMeeting = inngest.createFunction(
  {
    id: 'process-meeting',
    retries: 2,
    triggers: [{ event: 'meeting/process.requested' }],
  },
  async ({ event, step }) => {
    const { meetingId, audioUrl, language, privacyLevel } =
      event.data as MeetingProcessEvent['data'];

    await step.run('mark-processing', async () => {
      await getSupabaseAdmin()
        .from('meetings')
        .update({ status: 'processing' })
        .eq('id', meetingId);
    });

    const result = await step.run('call-worker', async () => {
      const workerUrl = process.env.WORKER_URL;
      if (!workerUrl) throw new Error('WORKER_URL not set');

      const res = await fetch(`${workerUrl}/process`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}`,
        },
        body: JSON.stringify({
          meeting_id: meetingId,
          audio_url: audioUrl,
          language,
          privacy_level: privacyLevel,
        }),
      });

      if (!res.ok) {
        throw new Error(`Worker ${res.status}: ${await res.text()}`);
      }
      return res.json();
    });

    await step.run('mark-done', async () => {
      await getSupabaseAdmin()
        .from('meetings')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', meetingId);
    });

    return result;
  },
);
