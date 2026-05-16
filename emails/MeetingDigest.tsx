import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export type DigestActionItem = {
  description: string;
  ownerLabel: string | null;
  dueLabel: string | null;
  confidence: number;
  sourceQuote: string | null;
};

export type DigestDecision = {
  description: string;
  agreedByLabels: string[];
  sourceQuote: string | null;
};

export type DigestQuestion = {
  question: string;
  raisedBy: string | null;
};

export type DigestTopic = {
  title: string;
  summary: string | null;
};

export type MeetingDigestProps = {
  meetingTitle: string;
  meetingDate: string;          // 已格式化為「2026 年 5 月 16 日」
  durationLabel: string;        // 已格式化為「48 分鐘」
  meetingUrl: string;           // 跳回 web 詳情頁
  appendedMessage?: string | null;
  topics: DigestTopic[];
  actionItems: DigestActionItem[];
  decisions: DigestDecision[];
  openQuestions: DigestQuestion[];
  unresolvedOwnerCount: number; // owner_raw_name 但沒解析到 member 的數量
  orgName: string;
};

const CONF = {
  ok: { border: '#10b981', bg: '#ecfdf5', text: '#065f46', label: '可信' },
  warn: { border: '#f59e0b', bg: '#fffbeb', text: '#92400e', label: '建議複核' },
  block: { border: '#ef4444', bg: '#fef2f2', text: '#7f1d1d', label: '需要複核' },
} as const;

function confTone(c: number) {
  if (c >= 0.85) return CONF.ok;
  if (c >= 0.65) return CONF.warn;
  return CONF.block;
}

export default function MeetingDigest(props: MeetingDigestProps) {
  const {
    meetingTitle,
    meetingDate,
    durationLabel,
    meetingUrl,
    appendedMessage,
    topics,
    actionItems,
    decisions,
    openQuestions,
    unresolvedOwnerCount,
    orgName,
  } = props;

  return (
    <Html lang="zh-Hant">
      <Head />
      <Preview>{`會議紀錄 · ${meetingTitle}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            <Heading as="h1" style={h1}>{meetingTitle}</Heading>
            <Text style={subtle}>
              {meetingDate} · 時長 {durationLabel} · 由 {orgName} 整理
            </Text>
          </Section>

          {appendedMessage ? (
            <Section style={messageSection}>
              <Text style={messageText}>{appendedMessage}</Text>
            </Section>
          ) : null}

          {/* Topics */}
          {topics.length > 0 ? (
            <Section style={section}>
              <Heading as="h2" style={h2}>議題摘要</Heading>
              {topics.map((t, i) => (
                <div key={i} style={topicBlock}>
                  <Text style={topicTitle}>{i + 1}. {t.title}</Text>
                  {t.summary ? <Text style={topicSummary}>{t.summary}</Text> : null}
                </div>
              ))}
            </Section>
          ) : null}

          {/* Action items */}
          {actionItems.length > 0 ? (
            <Section style={section}>
              <Heading as="h2" style={h2}>
                行動項目（{actionItems.length}）
              </Heading>
              {unresolvedOwnerCount > 0 ? (
                <Text style={warning}>
                  ⚠ 其中 {unresolvedOwnerCount} 條負責人尚未對應到成員，請手動 follow up
                </Text>
              ) : null}
              <table cellPadding={0} cellSpacing={0} width="100%" style={table}>
                <thead>
                  <tr>
                    <th style={th}>負責人</th>
                    <th style={th}>內容</th>
                    <th style={th}>截止</th>
                    <th style={th}>信心</th>
                  </tr>
                </thead>
                <tbody>
                  {actionItems.map((a, i) => {
                    const tone = confTone(a.confidence);
                    return (
                      <tr key={i} style={{ backgroundColor: tone.bg, borderLeft: `3px solid ${tone.border}` }}>
                        <td style={td}>{a.ownerLabel ?? '—'}</td>
                        <td style={tdMain}>{a.description}</td>
                        <td style={td}>{a.dueLabel ?? '—'}</td>
                        <td style={{ ...td, color: tone.text, whiteSpace: 'nowrap' }}>
                          {tone.label}<br />
                          <span style={{ fontSize: 11 }}>{Math.round(a.confidence * 100)}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          ) : null}

          {/* Decisions */}
          {decisions.length > 0 ? (
            <Section style={section}>
              <Heading as="h2" style={h2}>決議（{decisions.length}）</Heading>
              {decisions.map((d, i) => (
                <Row key={i} style={listItemRow}>
                  <div style={greenBullet} />
                  <div style={listItemBody}>
                    <Text style={decisionText}>{d.description}</Text>
                    {d.agreedByLabels.length > 0 ? (
                      <Text style={meta}>同意者：{d.agreedByLabels.join('、')}</Text>
                    ) : null}
                    {d.sourceQuote ? (
                      <Text style={quote}>「{d.sourceQuote}」</Text>
                    ) : null}
                  </div>
                </Row>
              ))}
            </Section>
          ) : null}

          {/* Open questions */}
          {openQuestions.length > 0 ? (
            <Section style={section}>
              <Heading as="h2" style={h2}>未決問題（{openQuestions.length}）</Heading>
              {openQuestions.map((q, i) => (
                <Row key={i} style={listItemRow}>
                  <div style={orangeBullet} />
                  <div style={listItemBody}>
                    <Text style={questionText}>{q.question}</Text>
                    {q.raisedBy ? <Text style={meta}>提出者：{q.raisedBy}</Text> : null}
                  </div>
                </Row>
              ))}
            </Section>
          ) : null}

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              完整錄音與逐字稿：
              <Link href={meetingUrl} style={link}>{meetingUrl}</Link>
            </Text>
            <Text style={footerSubtle}>
              由 MeetingMind 自動產生 · 點擊任何行動項目可在 Web 介面跳秒回原始錄音
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ============================================================================
// Inline styles (React Email 慣例：所有 style 都 inline)
// ============================================================================

const body = {
  backgroundColor: '#f8fafc',
  fontFamily: '-apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
  margin: 0,
  padding: '24px 0',
};

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '640px',
  padding: '32px',
};

const headerSection = {
  borderBottom: '1px solid #e2e8f0',
  marginBottom: '20px',
  paddingBottom: '16px',
};

const h1 = {
  color: '#0f172a',
  fontSize: '22px',
  fontWeight: 600,
  lineHeight: '1.3',
  margin: 0,
};

const h2 = {
  color: '#1e293b',
  fontSize: '16px',
  fontWeight: 600,
  margin: '20px 0 10px',
};

const subtle = {
  color: '#64748b',
  fontSize: '13px',
  margin: '6px 0 0',
};

const section = {
  margin: '12px 0',
};

const messageSection = {
  backgroundColor: '#f1f5f9',
  borderRadius: '6px',
  margin: '16px 0',
  padding: '12px 16px',
};

const messageText = {
  color: '#334155',
  fontSize: '14px',
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
};

const topicBlock = {
  borderLeft: '3px solid #cbd5e1',
  margin: '10px 0',
  padding: '6px 12px',
};

const topicTitle = {
  color: '#0f172a',
  fontSize: '14px',
  fontWeight: 600,
  margin: 0,
};

const topicSummary = {
  color: '#475569',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '4px 0 0',
};

const warning = {
  backgroundColor: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: '4px',
  color: '#92400e',
  fontSize: '13px',
  margin: '0 0 8px',
  padding: '8px 12px',
};

const table = {
  borderCollapse: 'collapse' as const,
  margin: '8px 0',
  width: '100%',
};

const th = {
  backgroundColor: '#f1f5f9',
  borderBottom: '1px solid #cbd5e1',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
  padding: '8px 10px',
  textAlign: 'left' as const,
};

const td = {
  borderBottom: '1px solid #e2e8f0',
  color: '#334155',
  fontSize: '13px',
  padding: '10px',
  verticalAlign: 'top' as const,
};

const tdMain = {
  ...td,
  fontWeight: 500,
};

const listItemRow = {
  alignItems: 'flex-start' as const,
  display: 'flex',
  margin: '10px 0',
};

const greenBullet = {
  backgroundColor: '#16a34a',
  borderRadius: '50%',
  flexShrink: 0,
  height: '10px',
  marginRight: '12px',
  marginTop: '6px',
  width: '10px',
};

const orangeBullet = {
  backgroundColor: '#ea580c',
  borderRadius: '50%',
  flexShrink: 0,
  height: '10px',
  marginRight: '12px',
  marginTop: '6px',
  width: '10px',
};

const listItemBody = {
  flex: 1,
};

const decisionText = {
  color: '#0f172a',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: '1.5',
  margin: 0,
};

const questionText = {
  color: '#7c2d12',
  fontSize: '14px',
  lineHeight: '1.5',
  margin: 0,
};

const meta = {
  color: '#64748b',
  fontSize: '12px',
  margin: '4px 0 0',
};

const quote = {
  borderLeft: '2px solid #cbd5e1',
  color: '#64748b',
  fontSize: '12px',
  fontStyle: 'italic' as const,
  margin: '6px 0 0',
  paddingLeft: '8px',
};

const hr = {
  border: 'none',
  borderTop: '1px solid #e2e8f0',
  margin: '24px 0 16px',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  color: '#475569',
  fontSize: '13px',
  margin: '0 0 4px',
};

const footerSubtle = {
  color: '#94a3b8',
  fontSize: '11px',
  margin: 0,
};

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
};
