import * as React from 'react';
import path from 'node:path';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type { MeetingDigestProps } from '@/emails/MeetingDigest';

// ---------------------------------------------------------------------------
// 字型：Noto Sans TC variable font。
// 必須在模組載入時 register，react-pdf 在 renderToBuffer 之前就讀字型表了。
// ---------------------------------------------------------------------------

const FONT_FAMILY = 'NotoSansTC';

let fontRegistered = false;
export function registerFonts() {
  if (fontRegistered) return;
  // process.cwd() 在 Next.js server runtime 是專案根（Vercel 上也是）
  const fontPath = path.resolve(process.cwd(), 'public/fonts/NotoSansTC.ttf');
  // Noto Sans TC variable font 只有 wght axis、沒有 italic axis；
  // 但 react-pdf 在元素標 fontStyle: 'italic' 時會去要 italic variant，
  // 找不到就 throw。所以註冊 normal 與 italic 兩種，都指向同一個檔案
  // （文字會以正體呈現而非斜體 — Noto Sans TC 本身就沒斜體設計）。
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: fontPath },
      { src: fontPath, fontStyle: 'italic' },
    ],
  });
  // 讓 long 中文段落能斷行（react-pdf 預設只在空白處斷行，中文要關掉這檢查）
  Font.registerHyphenationCallback((word) =>
    word.split('').flatMap((c, i) => (i === 0 ? [c] : ['', c])),
  );
  fontRegistered = true;
}

// 模組載入時就嘗試 register（Next.js runtime 走這條），
// 同時 export 一個顯式 registerFonts() 讓 caller 在 renderToBuffer 之前可以 force。
registerFonts();

// ---------------------------------------------------------------------------
// 顏色（對齊 email 模板）
// ---------------------------------------------------------------------------

const CONF = {
  ok: { border: '#10b981', bg: '#ecfdf5', text: '#065f46', label: '可信' },
  warn: { border: '#f59e0b', bg: '#fffbeb', text: '#92400e', label: '建議複核' },
  block: { border: '#ef4444', bg: '#fef2f2', text: '#7f1d1d', label: '需要複核' },
};

function confTone(c: number) {
  if (c >= 0.85) return CONF.ok;
  if (c >= 0.65) return CONF.warn;
  return CONF.block;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    paddingTop: 56,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontFamily: FONT_FAMILY,
    fontSize: 10,
    color: '#1e293b',
  },
  // Header (fixed = appears on every page)
  pageHeader: {
    position: 'absolute',
    top: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#cbd5e1',
  },
  wordmark: {
    fontSize: 11,
    color: '#0f172a',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 9,
    color: '#475569',
    maxWidth: 320,
    textAlign: 'right',
  },
  // Footer
  pageFooter: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: '#cbd5e1',
    fontSize: 8,
    color: '#94a3b8',
  },
  confidentialBadge: {
    color: '#b91c1c',
    fontSize: 8,
  },

  // Title block on page 1
  meetingTitle: {
    fontSize: 18,
    color: '#0f172a',
    marginBottom: 4,
  },
  meetingMeta: {
    fontSize: 9,
    color: '#64748b',
    marginBottom: 12,
  },
  appendedBox: {
    backgroundColor: '#f1f5f9',
    borderLeftWidth: 3,
    borderLeftColor: '#94a3b8',
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  appendedText: {
    fontSize: 10,
    color: '#334155',
  },

  section: {
    marginBottom: 10,
  },
  h2: {
    fontSize: 12,
    color: '#0f172a',
    marginTop: 8,
    marginBottom: 5,
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },

  // Topic
  topicBlock: {
    marginBottom: 6,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#cbd5e1',
  },
  topicTitle: {
    fontSize: 10,
    color: '#0f172a',
    marginBottom: 2,
  },
  topicSummary: {
    fontSize: 9,
    color: '#475569',
    lineHeight: 1.4,
  },

  // Action items table
  warning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 0.5,
    borderRadius: 2,
    color: '#92400e',
    fontSize: 9,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  table: {
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
    borderRadius: 2,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 0.5,
    borderBottomColor: '#cbd5e1',
  },
  th: {
    fontSize: 9,
    color: '#475569',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  td: {
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 6,
    color: '#1e293b',
  },
  colOwner: { width: '18%' },
  colDesc: { width: '52%' },
  colDue: { width: '14%' },
  colConf: { width: '16%' },

  // Decisions / questions list
  listItem: {
    flexDirection: 'row',
    marginVertical: 3,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
    marginTop: 4,
  },
  greenBullet: { backgroundColor: '#16a34a' },
  orangeBullet: { backgroundColor: '#ea580c' },
  listBody: { flex: 1 },
  decisionText: {
    fontSize: 10,
    color: '#0f172a',
  },
  questionText: {
    fontSize: 10,
    color: '#7c2d12',
  },
  meta: {
    fontSize: 8,
    color: '#64748b',
    marginTop: 1,
  },
  quote: {
    fontSize: 8,
    color: '#64748b',
    fontStyle: 'italic',
    marginTop: 2,
    paddingLeft: 5,
    borderLeftWidth: 1,
    borderLeftColor: '#cbd5e1',
  },
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type MeetingPdfProps = MeetingDigestProps & {
  confidential: boolean;
};

export default function MeetingPDF(props: MeetingPdfProps) {
  const {
    meetingTitle,
    meetingDate,
    durationLabel,
    appendedMessage,
    topics,
    actionItems,
    decisions,
    openQuestions,
    unresolvedOwnerCount,
    orgName,
    confidential,
  } = props;

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Fixed page header */}
        <View style={styles.pageHeader} fixed>
          <Text style={styles.wordmark}>MeetingMind</Text>
          <Text style={styles.headerTitle}>{meetingTitle}</Text>
        </View>

        {/* Fixed page footer */}
        <View style={styles.pageFooter} fixed>
          <Text>
            由 {orgName} 透過 MeetingMind 自動整理
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {confidential ? (
              <Text style={styles.confidentialBadge}>
                機密 · 限內部使用 ·{' '}
              </Text>
            ) : null}
            <Text
              render={({ pageNumber, totalPages }) =>
                `第 ${pageNumber} / ${totalPages} 頁`
              }
            />
          </View>
        </View>

        {/* Title block */}
        <View>
          <Text style={styles.meetingTitle}>{meetingTitle}</Text>
          <Text style={styles.meetingMeta}>
            {meetingDate} · 時長 {durationLabel}
          </Text>
        </View>

        {appendedMessage ? (
          <View style={styles.appendedBox} wrap={false}>
            <Text style={styles.appendedText}>{appendedMessage}</Text>
          </View>
        ) : null}

        {/* Topics */}
        {topics.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>議題摘要</Text>
            {topics.map((t, i) => (
              <View key={i} style={styles.topicBlock} wrap={false}>
                <Text style={styles.topicTitle}>
                  {i + 1}. {t.title}
                </Text>
                {t.summary ? <Text style={styles.topicSummary}>{t.summary}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* Action items */}
        {actionItems.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>行動項目（{actionItems.length}）</Text>
            {unresolvedOwnerCount > 0 ? (
              <Text style={styles.warning}>
                ⚠ 其中 {unresolvedOwnerCount} 條負責人尚未對應到成員
              </Text>
            ) : null}
            <View style={styles.table}>
              <View style={styles.tableHeader} fixed>
                <Text style={[styles.th, styles.colOwner]}>負責人</Text>
                <Text style={[styles.th, styles.colDesc]}>內容</Text>
                <Text style={[styles.th, styles.colDue]}>截止</Text>
                <Text style={[styles.th, styles.colConf]}>信心</Text>
              </View>
              {actionItems.map((a, i) => {
                const tone = confTone(a.confidence);
                return (
                  <View
                    key={i}
                    style={[styles.tableRow, { backgroundColor: tone.bg }]}
                    wrap={false}
                  >
                    <Text style={[styles.td, styles.colOwner]}>{a.ownerLabel ?? '—'}</Text>
                    <Text style={[styles.td, styles.colDesc]}>{a.description}</Text>
                    <Text style={[styles.td, styles.colDue]}>{a.dueLabel ?? '—'}</Text>
                    <Text style={[styles.td, styles.colConf, { color: tone.text }]}>
                      {tone.label} · {Math.round(a.confidence * 100)}%
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Decisions */}
        {decisions.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>決議（{decisions.length}）</Text>
            {decisions.map((d, i) => (
              <View key={i} style={styles.listItem} wrap={false}>
                <View style={[styles.bullet, styles.greenBullet]} />
                <View style={styles.listBody}>
                  <Text style={styles.decisionText}>{d.description}</Text>
                  {d.agreedByLabels.length > 0 ? (
                    <Text style={styles.meta}>同意者:{d.agreedByLabels.join('、')}</Text>
                  ) : null}
                  {d.sourceQuote ? (
                    <Text style={styles.quote}>「{d.sourceQuote}」</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Open questions */}
        {openQuestions.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>未決問題（{openQuestions.length}）</Text>
            {openQuestions.map((q, i) => (
              <View key={i} style={styles.listItem} wrap={false}>
                <View style={[styles.bullet, styles.orangeBullet]} />
                <View style={styles.listBody}>
                  <Text style={styles.questionText}>{q.question}</Text>
                  {q.raisedBy ? (
                    <Text style={styles.meta}>提出者:{q.raisedBy}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
