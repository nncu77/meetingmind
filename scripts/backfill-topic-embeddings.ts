/**
 * Phase 2: 一次性 script，幫所有舊 topic_segments 算 embedding + 指派 cluster。
 *
 * 用法（本機跑一次即可）:
 *   1. 確認 .env.local 有 OPENAI_API_KEY、NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
 *   2. npx tsx scripts/backfill-topic-embeddings.ts
 *
 * 行為:
 *   - 撈所有 embedding 為 NULL 的 topic_segments，每 100 條一批
 *   - 一批一次 embeddings API 呼叫（OpenAI batch 是免費的效能加速）
 *   - 對每個 topic 找該 org 內最相近的 cluster：cosine ≥ 0.75 加入，否則新建
 *   - 一筆一筆 update（簡單可重跑）
 *
 * 與 worker/clustering.py 邏輯保持一致（同樣的閾值 0.75、同樣的 model）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import type { Database } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COSINE_THRESHOLD = 0.75;
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const BATCH_SIZE = 100;

// Manually load .env.local since `dotenv/config` 預設只讀 .env
function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  try {
    const raw = readFileSync(path, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (e) {
    console.warn('[backfill] .env.local not found at', path);
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY');
  process.exit(1);
}

const sb = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseVector(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string') {
    const s = raw.trim().replace(/^\[|\]$/g, '');
    if (!s) return null;
    return s.split(',').map(Number);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[backfill] scanning topic_segments with NULL embedding...');
  // 因為要 JOIN meetings.org_id，用兩段查詢比較簡單
  const { data: topics, error: topicsErr } = await sb
    .from('topic_segments')
    .select('id, meeting_id, title, summary')
    .is('embedding', null);
  if (topicsErr) throw topicsErr;
  console.log(`[backfill] found ${topics?.length ?? 0} topics to backfill`);
  if (!topics || topics.length === 0) {
    console.log('[backfill] nothing to do');
    return;
  }

  // 撈每個 meeting 的 org_id 一併 cache
  const meetingIds = Array.from(new Set(topics.map((t) => t.meeting_id)));
  const { data: meetings } = await sb
    .from('meetings')
    .select('id, org_id')
    .in('id', meetingIds);
  const orgByMeeting = new Map<string, string>(
    (meetings ?? []).map((m) => [m.id, m.org_id]),
  );

  // 按 org 分組 — cluster 是 per-org 的
  const byOrg = new Map<string, typeof topics>();
  for (const t of topics) {
    const orgId = orgByMeeting.get(t.meeting_id);
    if (!orgId) continue;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(t);
  }

  let total = 0;
  let joined = 0;
  let seeded = 0;
  for (const [orgId, orgTopics] of byOrg) {
    console.log(`[backfill] org ${orgId.slice(0, 8)}: ${orgTopics.length} topics`);

    // 撈該 org 所有現存 cluster
    const { data: rawClusters } = await sb
      .from('topic_clusters')
      .select('id, canonical_title, centroid, member_count')
      .eq('org_id', orgId);
    const clusters = (rawClusters ?? []).map((c) => ({
      id: c.id,
      canonical_title: c.canonical_title,
      centroid: parseVector(c.centroid),
      member_count: c.member_count ?? 0,
    }));

    // 一批一批呼 embedding API
    for (let i = 0; i < orgTopics.length; i += BATCH_SIZE) {
      const batch = orgTopics.slice(i, i + BATCH_SIZE);
      const inputs = batch.map(
        (t) => `${t.title}\n${t.summary ?? ''}`.trim().slice(0, 8000),
      );
      const resp = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
      });
      const embeddings = resp.data.map((d) => d.embedding as number[]);

      for (let j = 0; j < batch.length; j++) {
        const topic = batch[j];
        const emb = embeddings[j];

        // 找最佳 cluster
        let bestId: string | null = null;
        let bestSim = -1;
        for (const c of clusters) {
          if (!c.centroid) continue;
          const sim = cosine(emb, c.centroid);
          if (sim > bestSim) {
            bestSim = sim;
            bestId = c.id;
          }
        }

        let clusterId: string;
        if (bestId && bestSim >= COSINE_THRESHOLD) {
          const c = clusters.find((x) => x.id === bestId)!;
          const newCount = c.member_count + 1;
          const newCentroid = c.centroid!.map(
            (v, k) => (v * (newCount - 1) + emb[k]) / newCount,
          );
          await sb
            .from('topic_clusters')
            .update({
              centroid: newCentroid as any,
              member_count: newCount,
              updated_at: new Date().toISOString(),
              current_state_summary: null,
              current_state_at: null,
            })
            .eq('id', c.id);
          c.centroid = newCentroid;
          c.member_count = newCount;
          clusterId = c.id;
          joined++;
        } else {
          const { data: inserted, error: insErr } = await sb
            .from('topic_clusters')
            .insert({
              org_id: orgId,
              canonical_title: topic.title,
              centroid: emb as any,
              member_count: 1,
            })
            .select('id')
            .single();
          if (insErr || !inserted) {
            console.error('cluster insert failed:', insErr);
            continue;
          }
          clusters.push({
            id: inserted.id,
            canonical_title: topic.title,
            centroid: emb,
            member_count: 1,
          });
          clusterId = inserted.id;
          seeded++;
        }

        await sb
          .from('topic_segments')
          .update({
            embedding: emb as any,
            cluster_id: clusterId,
          })
          .eq('id', topic.id);
        total++;
      }
      process.stdout.write(`  ...${Math.min(i + BATCH_SIZE, orgTopics.length)}/${orgTopics.length}\r`);
    }
    console.log();
  }

  console.log(`[backfill] done: ${total} topics processed (${joined} joined existing, ${seeded} new clusters)`);
}

main().catch((e) => {
  console.error('[backfill] FAILED:', e);
  process.exit(1);
});
