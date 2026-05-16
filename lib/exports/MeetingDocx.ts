import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  Header,
  Footer,
  PageNumber,
} from 'docx';
import type { MeetingDigestProps } from '@/emails/MeetingDigest';

const CONF = {
  ok: { hex: 'D1FAE5', label: '可信' },        // emerald-100
  warn: { hex: 'FEF3C7', label: '建議複核' },   // amber-100
  block: { hex: 'FEE2E2', label: '需要複核' },  // rose-100
};

function confTone(c: number) {
  if (c >= 0.85) return CONF.ok;
  if (c >= 0.65) return CONF.warn;
  return CONF.block;
}

export type MeetingDocxProps = MeetingDigestProps & {
  confidential: boolean;
};

export async function renderMeetingDocx(props: MeetingDocxProps): Promise<Buffer> {
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

  // Header on every page
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({ text: 'MeetingMind', bold: true, size: 18 }),
          new TextRun({ text: '   ' }),
          new TextRun({ text: meetingTitle, size: 16, color: '64748b' }),
        ],
      }),
    ],
  });

  // Footer on every page
  const footerChildren: TextRun[] = [];
  if (confidential) {
    footerChildren.push(
      new TextRun({ text: '機密 · 限內部使用 · ', bold: true, color: 'B91C1C', size: 16 }),
    );
  }
  footerChildren.push(
    new TextRun({ text: `由 ${orgName} 透過 MeetingMind 自動整理 · 第 `, size: 16, color: '94a3b8' }),
    new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94a3b8' }),
    new TextRun({ text: ' / ', size: 16, color: '94a3b8' }),
    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '94a3b8' }),
    new TextRun({ text: ' 頁', size: 16, color: '94a3b8' }),
  );
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: footerChildren,
      }),
    ],
  });

  const body: Array<Paragraph | Table> = [];

  // Title block
  body.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [new TextRun({ text: meetingTitle, bold: true, size: 36 })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `${meetingDate} · 時長 ${durationLabel}`,
          color: '64748b',
          size: 20,
        }),
      ],
    }),
  );

  // Appended message
  if (appendedMessage) {
    body.push(
      new Paragraph({
        spacing: { after: 200 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
        children: [new TextRun({ text: appendedMessage, size: 22 })],
      }),
    );
  }

  // Topics
  if (topics.length > 0) {
    body.push(headingPara('議題摘要'));
    topics.forEach((t, i) => {
      body.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [
            new TextRun({ text: `${i + 1}. ${t.title}`, bold: true, size: 22 }),
          ],
        }),
      );
      if (t.summary) {
        body.push(
          new Paragraph({
            spacing: { after: 120 },
            indent: { left: 360 },
            children: [
              new TextRun({ text: t.summary, size: 20, color: '475569' }),
            ],
          }),
        );
      }
    });
  }

  // Action items table
  if (actionItems.length > 0) {
    body.push(headingPara(`行動項目（${actionItems.length}）`));
    if (unresolvedOwnerCount > 0) {
      body.push(
        new Paragraph({
          spacing: { after: 120 },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFBEB' },
          children: [
            new TextRun({
              text: `⚠ 其中 ${unresolvedOwnerCount} 條負責人尚未對應到成員`,
              size: 20,
              color: '92400E',
            }),
          ],
        }),
      );
    }

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('負責人', 18),
        headerCell('內容', 52),
        headerCell('截止', 14),
        headerCell('信心', 16),
      ],
    });

    const dataRows = actionItems.map((a) => {
      const tone = confTone(a.confidence);
      return new TableRow({
        children: [
          bodyCell(a.ownerLabel ?? '—', 18),
          bodyCell(a.description, 52),
          bodyCell(a.dueLabel ?? '—', 14),
          bodyCell(`${tone.label} · ${Math.round(a.confidence * 100)}%`, 16, tone.hex),
        ],
      });
    });

    body.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...dataRows],
      }),
      new Paragraph({ spacing: { after: 200 }, children: [] }),
    );
  }

  // Decisions
  if (decisions.length > 0) {
    body.push(headingPara(`決議（${decisions.length}）`));
    decisions.forEach((d) => {
      body.push(
        new Paragraph({
          spacing: { after: 60 },
          bullet: { level: 0 },
          children: [
            new TextRun({ text: '✓ ', bold: true, color: '16A34A', size: 22 }),
            new TextRun({ text: d.description, size: 22 }),
          ],
        }),
      );
      if (d.agreedByLabels.length > 0) {
        body.push(
          new Paragraph({
            spacing: { after: 40 },
            indent: { left: 720 },
            children: [
              new TextRun({
                text: `同意者：${d.agreedByLabels.join('、')}`,
                size: 18,
                color: '64748b',
              }),
            ],
          }),
        );
      }
      if (d.sourceQuote) {
        body.push(
          new Paragraph({
            spacing: { after: 120 },
            indent: { left: 720 },
            children: [
              new TextRun({
                text: `「${d.sourceQuote}」`,
                italics: true,
                size: 18,
                color: '94A3B8',
              }),
            ],
          }),
        );
      }
    });
  }

  // Open questions
  if (openQuestions.length > 0) {
    body.push(headingPara(`未決問題（${openQuestions.length}）`));
    openQuestions.forEach((q) => {
      body.push(
        new Paragraph({
          spacing: { after: 60 },
          bullet: { level: 0 },
          children: [
            new TextRun({ text: '? ', bold: true, color: 'EA580C', size: 22 }),
            new TextRun({ text: q.question, size: 22, color: '7C2D12' }),
          ],
        }),
      );
      if (q.raisedBy) {
        body.push(
          new Paragraph({
            spacing: { after: 80 },
            indent: { left: 720 },
            children: [
              new TextRun({
                text: `提出者：${q.raisedBy}`,
                size: 18,
                color: '64748b',
              }),
            ],
          }),
        );
      }
    });
  }

  const doc = new Document({
    creator: 'MeetingMind',
    title: meetingTitle,
    description: '會議紀錄',
    sections: [
      {
        headers: { default: header },
        footers: { default: footer },
        children: body,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headingPara(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 26 })],
  });
}

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 18, color: '475569' })],
      }),
    ],
  });
}

function bodyCell(text: string, widthPct: number, fillHex?: string): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    ...(fillHex
      ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: fillHex } }
      : {}),
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 20 })],
      }),
    ],
  });
}
