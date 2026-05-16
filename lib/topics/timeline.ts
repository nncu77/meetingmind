import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODELS } from '@/lib/ai/client';
import type { Database } from '@/lib/supabase/types';

/**
 * Phase 2: 為一個 topic cluster 組裝跨會議時間軸資料。
 */

export type TimelineEvent = {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  topicTitle: string;
  topicSummary: string | null;
  topicStartSeconds: number;
  decisions: { description: string; sourceQuote: string | null }[];
  actionItems: {
    description: string;
    ownerLabel: string | null;
    dueLabel: string | null;
    confidence: number;
  }[];
  openQuestions: { question: string; raisedBy: string | null }[];
};

export type CurrentState = {
  summary: string;
  nextStep: string;
  openBlockers: string[];
  computedAt: string;     // ISO
  fromCache: boolean;
};

export type TimelineBundle = {
  cluster: {
    id: string;
    canonical_title: string;
    member_count: number;
    updated_at: string;
  };
  events: TimelineEvent[];
  currentState: CurrentState | null;
};

// ---------------------------------------------------------------------------
// 取得 timeline 資料（不含 LLM 摘要計算 — 摘要邏輯獨立）
// ---------------------------------------------------------------------------

export async function loadTimeline(
  admin: SupabaseClient<Database>,
  clusterId: string,
): Promise<TimelineBundle | null> {
  const { data: cluster } = await admin
    .from('topic_clusters')
    .select('id, canonical_title, member_count, updated_at, current_state_summary, current_state_at, org_id')
    .eq('id', clusterId)
    .maybeSingle();
  if (!cluster) return null;

  // 撈 cluster 內所有 topic_segments
  const { data: topics } = await admin
    .from('topic_segments')
    .select('id, meeting_id, title, summary, start_seconds')
    .eq('cluster_id', clusterId);

  if (!topics || topics.length === 0) {
    return {
      cluster: {
        id: cluster.id,
        canonical_title: cluster.canonical_title,
        member_count: cluster.member_count,
        updated_at: cluster.updated_at,
      },
      events: [],
      currentState: cachedStateFrom(cluster),
    };
  }

  const topicIds = topics.map((t) => t.id);
  const meetingIds = Array.from(new Set(topics.map((t) => t.meeting_id)));

  const [meetingsRes, decisionsRes, actionsRes, openQsRes] = await Promise.all([
    admin
      .from('meetings')
      .select('id, title, created_at')
      .in('id', meetingIds),
    admin
      .from('decisions')
      .select('id, topic_segment_id, description, source_quote')
      .in('topic_segment_id', topicIds),
    admin
      .from('action_items')
      .select(
        'id, topic_segment_id, description, owner_member_id, owner_raw_name, due_date, due_date_raw, confidence',
      )
      .in('topic_segment_id', topicIds),
    admin
      .from('open_questions')
      .select('id, topic_segment_id, question, raised_by_speaker')
      .in('topic_segment_id', topicIds),
  ]);

  const meetingMap = new Map((meetingsRes.data ?? []).map((m) => [m.id, m]));

  // 解析 action item owner -> name
  const memberIdSet = new Set<string>();
  for (const a of actionsRes.data ?? []) {
    if (a.owner_member_id) memberIdSet.add(a.owner_member_id);
  }
  let memberMap = new Map<string, string>();
  if (memberIdSet.size > 0) {
    const { data: members } = await admin
      .from('members')
      .select('id, name')
      .in('id', Array.from(memberIdSet));
    memberMap = new Map((members ?? []).map((m) => [m.id, m.name]));
  }

  // 按 topic_segment_id 分組 sub-data
  function group<T extends { topic_segment_id: string | null }>(rows: T[]) {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.topic_segment_id) continue;
      if (!m.has(r.topic_segment_id)) m.set(r.topic_segment_id, []);
      m.get(r.topic_segment_id)!.push(r);
    }
    return m;
  }
  const decisionsByTopic = group(decisionsRes.data ?? []);
  const actionsByTopic = group(actionsRes.data ?? []);
  const openQsByTopic = group(openQsRes.data ?? []);

  const events: TimelineEvent[] = [];
  for (const t of topics) {
    const meeting = meetingMap.get(t.meeting_id);
    if (!meeting) continue;
    const actions = (actionsByTopic.get(t.id) ?? []).map((a) => ({
      description: a.description,
      ownerLabel: a.owner_member_id
        ? memberMap.get(a.owner_member_id) ?? a.owner_raw_name ?? null
        : a.owner_raw_name,
      dueLabel: a.due_date ?? a.due_date_raw ?? null,
      confidence: a.confidence,
    }));
    events.push({
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.created_at,
      topicTitle: t.title,
      topicSummary: t.summary,
      topicStartSeconds: t.start_seconds,
      decisions: (decisionsByTopic.get(t.id) ?? []).map((d) => ({
        description: d.description,
        sourceQuote: d.source_quote ?? null,
      })),
      actionItems: actions,
      openQuestions: (openQsByTopic.get(t.id) ?? []).map((q) => ({
        question: q.question,
        raisedBy: q.raised_by_speaker,
      })),
    });
  }
  events.sort((a, b) => +new Date(a.meetingDate) - +new Date(b.meetingDate));

  return {
    cluster: {
      id: cluster.id,
      canonical_title: cluster.canonical_title,
      member_count: cluster.member_count,
      updated_at: cluster.updated_at,
    },
    events,
    currentState: cachedStateFrom(cluster),
  };
}

function cachedStateFrom(cluster: {
  current_state_summary: any;
  current_state_at: string | null;
}): CurrentState | null {
  if (!cluster.current_state_summary || !cluster.current_state_at) return null;
  const s = cluster.current_state_summary as any;
  return {
    summary: s.summary ?? '',
    nextStep: s.nextStep ?? s.next_step ?? '',
    openBlockers: s.openBlockers ?? s.open_blockers ?? [],
    computedAt: cluster.current_state_at,
    fromCache: true,
  };
}

// ---------------------------------------------------------------------------
// current_state LLM 摘要
// ---------------------------------------------------------------------------

const STATE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘

export function isStateCacheFresh(
  current_state_at: string | null | undefined,
): boolean {
  if (!current_state_at) return false;
  const age = Date.now() - new Date(current_state_at).getTime();
  return age < STATE_CACHE_TTL_MS;
}

const TOOL_CURRENT_STATE = {
  name: 'report_topic_current_state',
  description:
    '根據多場會議裡同一議題的演進，產出當前狀態摘要、下一步、以及尚未解決的 blocker。',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '這個議題到目前為止的進展與結論的 2-3 句摘要。中文（繁體）。',
      },
      next_step: {
        type: 'string',
        description: '建議的下一步行動，1 句。中文。',
      },
      open_blockers: {
        type: 'array',
        items: { type: 'string' },
        description: '尚未解決的 blocker 列表（去重）。中文。空陣列代表沒有。',
      },
    },
    required: ['summary', 'next_step', 'open_blockers'],
  },
} as const;

export async function computeCurrentState(events: TimelineEvent[]): Promise<{
  summary: string;
  nextStep: string;
  openBlockers: string[];
  inputTokens: number;
  outputTokens: number;
}> {
  const eventLines = events.map((e, i) => {
    const date = new Date(e.meetingDate).toISOString().slice(0, 10);
    const lines: string[] = [];
    lines.push(`【會議 ${i + 1}】${date} · ${e.meetingTitle}`);
    lines.push(`議題:${e.topicTitle}`);
    if (e.topicSummary) lines.push(`摘要:${e.topicSummary}`);
    if (e.decisions.length > 0) {
      lines.push('決議:');
      for (const d of e.decisions) lines.push(`  - ${d.description}`);
    }
    if (e.actionItems.length > 0) {
      lines.push('行動項目:');
      for (const a of e.actionItems) {
        lines.push(`  - [${a.ownerLabel ?? '?'}] ${a.description} (截止:${a.dueLabel ?? '—'})`);
      }
    }
    if (e.openQuestions.length > 0) {
      lines.push('未決問題:');
      for (const q of e.openQuestions) lines.push(`  - ${q.question}`);
    }
    return lines.join('\n');
  });

  const userPrompt = `以下是同一個議題在 ${events.length} 場會議裡的演進，按時間排序:

${eventLines.join('\n\n')}

請以 \`report_topic_current_state\` tool 回報這議題目前的整體狀態。`;

  const resp = await anthropic.messages.create({
    model: MODELS.fast,  // Haiku 4.5 — 摘要不需要 Sonnet 等級
    max_tokens: 1000,
    system: '你是中文會議紀錄分析師，把跨會議的議題演進總結成可執行的下一步。',
    messages: [{ role: 'user', content: userPrompt }],
    tools: [TOOL_CURRENT_STATE as any],
    tool_choice: { type: 'tool', name: TOOL_CURRENT_STATE.name },
  });

  const inputTokens = resp.usage?.input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;

  for (const block of resp.content) {
    if (block.type === 'tool_use' && block.name === TOOL_CURRENT_STATE.name) {
      const input = block.input as any;
      return {
        summary: String(input.summary ?? ''),
        nextStep: String(input.next_step ?? ''),
        openBlockers: Array.isArray(input.open_blockers)
          ? input.open_blockers.map(String)
          : [],
        inputTokens,
        outputTokens,
      };
    }
  }
  throw new Error('Claude tool_use block not returned');
}
