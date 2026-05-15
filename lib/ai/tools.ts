/**
 * Tool Use schemas for Claude Sonnet 4.5 extraction calls.
 *
 * Section 7.2 of spec. Every extracted artifact must include source_quote +
 * source_start_seconds so the admin UI can jump back to the original audio.
 */

import type Anthropic from '@anthropic-ai/sdk';

type Tool = Anthropic.Tool;

export const extractActionItemsTool: Tool = {
  name: 'extract_action_items',
  description:
    '從會議轉錄中抽取行動項目。一個合格的行動項目必須有明確的動作、可指派的負責人、以及時間（具體或模糊）。閒聊承諾不要抽。',
  input_schema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'description',
            'source_quote',
            'source_start_seconds',
            'confidence',
          ],
          properties: {
            description: {
              type: 'string',
              description: '行動項目的精簡描述（≤ 40 字），主詞為 owner_raw_name。',
            },
            owner_member_id: {
              type: ['string', 'null'],
              description:
                '如果可比對到出席者名單中的成員，填入該成員的 UUID；否則 null。',
            },
            owner_raw_name: {
              type: 'string',
              description: '原始講話內容裡提到的人名／代稱（例：「業務部 Peter」、「Mark」、「我」、「你」）。',
            },
            due_date: {
              type: ['string', 'null'],
              description: 'ISO yyyy-mm-dd。若無法確定具體日期則 null。',
            },
            due_date_raw: {
              type: 'string',
              description: '原始字串，例：「下週三」、「月底前」、「儘快」、「Q3」。',
            },
            source_quote: {
              type: 'string',
              description: '原始講話引文（逐字、不修飾、≤ 60 字）。',
            },
            source_start_seconds: {
              type: 'number',
              description: '該引文在錄音中的起始秒數。',
            },
            source_speaker: {
              type: 'string',
              description: '說這句話的人（speaker_label 或顯示名稱）。',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description:
                '≥0.85 直接信任；0.65–0.85 提醒複核；<0.65 紅色框警示。',
            },
            needs_clarification: {
              type: ['string', 'null'],
              description:
                '若 owner / due_date 不明，說明需要釐清什麼（例：「未指明負責部門」）。',
            },
            topic_hint: {
              type: ['string', 'null'],
              description: '所屬議題的簡短標題（用於跟 topic_segments 對齊）。',
            },
          },
        },
      },
    },
  },
};

export const extractDecisionsTool: Tool = {
  name: 'extract_decisions',
  description:
    '抽取會議中已達成的決議／結論／通過的提案。暫緩或未達共識的「不是」決議。',
  input_schema: {
    type: 'object',
    required: ['decisions'],
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['description', 'source_quote', 'source_start_seconds'],
          properties: {
            description: { type: 'string' },
            source_quote: { type: 'string' },
            source_start_seconds: { type: 'number' },
            agreed_by_raw_names: {
              type: 'array',
              items: { type: 'string' },
              description: '同意此決議的成員名稱／speaker_label 列表（用於日後糾紛舉證）。',
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            topic_hint: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
};

export const extractOpenQuestionsTool: Tool = {
  name: 'extract_open_questions',
  description:
    '抽取會議結束時仍未解決的問題：被提出但沒結論、或需要外部資訊才能決定的。',
  input_schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string' },
            source_quote: { type: ['string', 'null'] },
            source_start_seconds: { type: ['number', 'null'] },
            raised_by_speaker: { type: ['string', 'null'] },
            blocked_by: {
              type: ['string', 'null'],
              description: '阻塞原因，例：「等法務確認」、「資料還沒拿到」。',
            },
            topic_hint: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
};

export const summarizeTopicsTool: Tool = {
  name: 'summarize_topics',
  description: '把會議切成 2–8 個議題段，每段含標題、摘要、起訖時間。',
  input_schema: {
    type: 'object',
    required: ['topics'],
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'summary', 'start_seconds', 'end_seconds'],
          properties: {
            title: { type: 'string', description: '≤ 15 字' },
            summary: { type: 'string', description: '1–3 句話的議題摘要' },
            start_seconds: { type: 'number' },
            end_seconds: { type: 'number' },
            status: {
              type: 'string',
              enum: ['concluded', 'paused', 'unresolved', 'off-topic'],
            },
          },
        },
      },
    },
  },
};

export const allTools: Tool[] = [
  extractActionItemsTool,
  extractDecisionsTool,
  extractOpenQuestionsTool,
  summarizeTopicsTool,
];

// Helper to pin Claude to invoke a specific tool
export const toolChoice = (name: string): Anthropic.MessageCreateParams['tool_choice'] => ({
  type: 'tool',
  name,
});
