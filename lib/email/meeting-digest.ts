import type { SupabaseClient } from '@supabase/supabase-js';
import { render } from '@react-email/render';
import MeetingDigest, {
  type MeetingDigestProps,
  type DigestActionItem,
  type DigestDecision,
  type DigestQuestion,
  type DigestTopic,
} from '@/emails/MeetingDigest';
import type { Database } from '@/lib/supabase/types';
import React from 'react';

/**
 * 整理會議所有資料，組成 React Email 模板所需 props。
 * 同時回傳:
 *   - recipients: 從 action_items.owner_member_id JOIN members.email 抽出，去重
 *   - unresolvedOwnerCount: 有 owner_raw_name 但沒解析到 member 的條數
 */
export type DigestBundle = {
  props: MeetingDigestProps;
  recipients: { email: string; name: string }[];
  unresolvedOwnerCount: number;
  meeting: Database['public']['Tables']['meetings']['Row'];
};

export async function buildDigestBundle(params: {
  client: SupabaseClient<Database>;
  meetingId: string;
  appUrl: string;
  orgName: string;
  appendedMessage?: string | null;
}): Promise<DigestBundle | null> {
  const { client, meetingId, appUrl, orgName, appendedMessage } = params;

  const [meetingRes, topicsRes, actionsRes, decisionsRes, openQsRes] = await Promise.all([
    client.from('meetings').select('*').eq('id', meetingId).maybeSingle(),
    client.from('topic_segments').select('*').eq('meeting_id', meetingId).order('ordinal'),
    client.from('action_items').select('*').eq('meeting_id', meetingId).order('source_start_seconds'),
    client.from('decisions').select('*').eq('meeting_id', meetingId).order('source_start_seconds'),
    client.from('open_questions').select('*').eq('meeting_id', meetingId).order('created_at'),
  ]);
  if (!meetingRes.data) return null;
  const meeting = meetingRes.data;

  const actionItems = actionsRes.data ?? [];
  const decisions = decisionsRes.data ?? [];
  const openQuestions = openQsRes.data ?? [];
  const topics = topicsRes.data ?? [];

  // Collect all member ids that need resolving (action item owners + decision agree-by)
  const memberIdSet = new Set<string>();
  for (const a of actionItems) if (a.owner_member_id) memberIdSet.add(a.owner_member_id);
  for (const d of decisions) for (const id of d.agreed_by_member_ids ?? []) memberIdSet.add(id);

  let memberRows: Array<{ id: string; name: string; email: string | null }> = [];
  if (memberIdSet.size > 0) {
    const { data } = await client
      .from('members')
      .select('id, name, email')
      .in('id', Array.from(memberIdSet));
    memberRows = data ?? [];
  }
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  // Recipients: dedupe by email; need both member_id resolved AND email present.
  const recipientMap = new Map<string, { email: string; name: string }>();
  let unresolvedOwnerCount = 0;
  for (const a of actionItems) {
    if (a.owner_member_id) {
      const m = memberMap.get(a.owner_member_id);
      if (m?.email) {
        const key = m.email.toLowerCase();
        if (!recipientMap.has(key)) recipientMap.set(key, { email: m.email, name: m.name });
      }
    } else if (a.owner_raw_name) {
      unresolvedOwnerCount += 1;
    }
  }

  const digestTopics: DigestTopic[] = topics.map((t) => ({
    title: t.title,
    summary: t.summary,
  }));

  const digestActions: DigestActionItem[] = actionItems.map((a) => {
    const ownerLabel = a.owner_member_id
      ? memberMap.get(a.owner_member_id)?.name ?? a.owner_raw_name ?? '—'
      : a.owner_raw_name;
    return {
      description: a.description,
      ownerLabel: ownerLabel ?? null,
      dueLabel: formatDueLabel(a.due_date, a.due_date_raw),
      confidence: a.confidence,
      sourceQuote: a.source_quote ?? null,
    };
  });

  const digestDecisions: DigestDecision[] = decisions.map((d) => ({
    description: d.description,
    agreedByLabels: (d.agreed_by_member_ids ?? [])
      .map((id) => memberMap.get(id)?.name)
      .filter((x): x is string => !!x),
    sourceQuote: d.source_quote ?? null,
  }));

  const digestQuestions: DigestQuestion[] = openQuestions.map((q) => ({
    question: q.question,
    raisedBy: q.raised_by_speaker,
  }));

  const meetingUrl = `${appUrl.replace(/\/$/, '')}/meetings/${meetingId}`;
  const meetingDate = formatDateZH(meeting.created_at);
  const durationLabel = formatDuration(meeting.duration_seconds);

  return {
    meeting,
    recipients: Array.from(recipientMap.values()),
    unresolvedOwnerCount,
    props: {
      meetingTitle: meeting.title,
      meetingDate,
      durationLabel,
      meetingUrl,
      appendedMessage: appendedMessage ?? null,
      topics: digestTopics,
      actionItems: digestActions,
      decisions: digestDecisions,
      openQuestions: digestQuestions,
      unresolvedOwnerCount,
      orgName,
    },
  };
}

export async function renderDigestHtml(props: MeetingDigestProps): Promise<string> {
  return render(React.createElement(MeetingDigest, props));
}

function formatDateZH(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.round(seconds / 60);
  if (m < 1) return `${seconds} 秒`;
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} 小時 ${rem} 分鐘` : `${h} 小時`;
}

function formatDueLabel(due_date: string | null, due_raw: string | null): string | null {
  if (due_date) {
    const d = new Date(due_date);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return due_raw;
}

export function defaultSubject(meetingTitle: string, isoDate: string): string {
  const d = new Date(isoDate);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `[會議紀錄] ${meetingTitle} - ${yyyy}/${mm}/${dd}`;
}
