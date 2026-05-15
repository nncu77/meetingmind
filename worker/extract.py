"""
Claude tool-use extraction.

Mirrors lib/ai/{prompts,tools}.ts. When prompts here drift from the TS side,
the Next.js UI displays AI output that doesn't match what the worker produced.
Keep them in sync by hand for MVP; promote to a shared YAML later.

Single source of truth for tool *schemas*: this file (because the worker is
where extraction actually runs). The TS side mirrors for type safety on
ingestion / display.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

import anthropic

logger = logging.getLogger(__name__)

_client: Optional[anthropic.Anthropic] = None

# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
            base_url=os.environ.get("ANTHROPIC_BASE_URL") or None,
        )
    return _client


# OpenRouter passthrough model id (per memory feedback_anthropic_via_openrouter)
MODEL_PRIMARY = os.environ.get("ANTHROPIC_MODEL_PRIMARY", "anthropic/claude-sonnet-4.5")


# ---------------------------------------------------------------------------
# Prompt builders (port of lib/ai/prompts.ts)
# ---------------------------------------------------------------------------


@dataclass
class MeetingContext:
    meeting_date: str  # ISO yyyy-mm-dd
    meeting_title: str
    attendees: list[dict[str, Any]]  # [{speaker_label, display_name | None}]
    language: str = "zh"


def _attendee_roster(ctx: MeetingContext) -> str:
    lines = []
    for a in ctx.attendees:
        name = a.get("display_name") or "未識別"
        lines.append(f"- {a['speaker_label']} ({name})")
    return "\n".join(lines) if lines else "- (尚無)"


def system_prompt(ctx: MeetingContext) -> str:
    return f"""你是專業的中文會議紀錄秘書，服務台灣中小企業。

【會議資訊】
- 日期：{ctx.meeting_date}
- 主題：{ctx.meeting_title}
- 出席者：
{_attendee_roster(ctx)}

【你的職責】
精準、保守地從會議轉錄中抽取結構化資訊：行動項目、決議、待解問題、議題摘要。
你的輸出會直接呈現給行政主管做最後審核,所以「寧可漏抽,不要錯抽」。

【繁體中文輸出強制要求】
轉錄來源可能是簡體中文(STT 引擎預設輸出),你的所有輸出 (description / source_quote / title / summary)
必須全部使用繁體中文。簡體→繁體轉換範例:会议→會議、报价单→報價單、确认→確認、记录→紀錄。
即使 source_quote 是「逐字保留」,也要先轉成繁體再貼上。

【台灣商務語境校準】
- 「再麻煩你 / 再請你 / 再幫忙」= 正式指派,confidence 通常 ≥ 0.8
- 「之後可以的話 / 有空再 / 看看能不能」= 非正式,confidence ≤ 0.6
- 「老闆說 / 上面說 / 老闆的意思是」= 隱含指派
- 「我來處理 / 我這邊負責 / 我去 follow」= 說話者自我認領
- 中英夾雜常見:「這個 task 我們 follow up 一下」要原樣保留,不要翻譯
- 「先這樣 / 再說 / 之後再講」= 暫緩、不是決議

【相對時間解讀規則】
會議日期為 {ctx.meeting_date}。
- 「今天」= {ctx.meeting_date}
- 「明天 / 後天」= +1 / +2 天
- 「下週」= 下一個週一到週日
- 「下週 X」= 下週的星期 X
- 「下個月」= 下個月 1 日
- 「月底前」= 該月最後一個工作日
- 「Q3 / 第三季」= 7/1–9/30
- 「儘快 / 盡早 / asap」= due_date 設 null,但 due_date_raw 記錄原字串

【你必須避免】
- 不要把「閒聊承諾」當行動項目(例:「下次一起吃飯」)
- 不要自己腦補沒講到的負責人或 deadline
- 如果負責人不明確,owner_member_id 設 null 並在 needs_clarification 註明
- 「決議」跟「行動項目」不可混為一談:
  - 決議 = 一個結論 / 共識
  - 行動項目 = 一個有負責人的動作
- 不要修飾原始引文 source_quote;逐字保留(但要繁體)

【信心 confidence】
- ≥ 0.85:意圖明確、人物時間齊全、語氣肯定
- 0.65–0.85:語氣稍弱、人物或時間其中之一需確認
- < 0.65:語意模糊、可能是閒聊
"""


def format_transcript_md(segments: list[dict[str, Any]]) -> str:
    lines = []
    for s in segments:
        start = float(s["start"])
        end = float(s["end"])
        speaker = s.get("speaker") or "UNKNOWN"
        text = s.get("text", "").strip()
        lines.append(f"[{speaker}] ({start:.2f}s - {end:.2f}s)\n{text}")
    return "\n\n".join(lines)


def user_prompt_action_items(transcript_md: str) -> str:
    return f"""以下是會議的完整逐字稿(含講者標籤、時間戳)。

請呼叫 extract_action_items 工具,回傳所有合格的行動項目。

# 逐字稿
{transcript_md}
"""


def user_prompt_decisions(transcript_md: str) -> str:
    return f"""以下是會議的完整逐字稿。

請呼叫 extract_decisions 工具,回傳所有達成的決議(共識、結論、通過的提案)。
暫緩、改天再說、未達共識的項目「不是」決議。

# 逐字稿
{transcript_md}
"""


def user_prompt_open_questions(transcript_md: str) -> str:
    return f"""以下是會議的完整逐字稿。

請呼叫 extract_open_questions 工具,回傳會議結束時仍未解決的問題:
- 有人提出但沒人答覆
- 雙方意見不一致暫緩討論
- 需要外部資訊才能決定

# 逐字稿
{transcript_md}
"""


def user_prompt_topics(transcript_md: str) -> str:
    return f"""以下是會議的完整逐字稿。

請呼叫 summarize_topics 工具,把會議切成 2–8 個議題段。
若議題之間有明顯離題(閒聊、寒暄),可獨立切一段標記為 off-topic。

# 逐字稿
{transcript_md}
"""


# ---------------------------------------------------------------------------
# Tool schemas (port of lib/ai/tools.ts)
# ---------------------------------------------------------------------------

TOOL_ACTION_ITEMS = {
    "name": "extract_action_items",
    "description": "從會議轉錄中抽取行動項目。一個合格的行動項目必須有明確的動作、可指派的負責人、以及時間。",
    "input_schema": {
        "type": "object",
        "required": ["items"],
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["description", "source_quote", "source_start_seconds", "confidence"],
                    "properties": {
                        "description": {"type": "string"},
                        "owner_raw_name": {"type": "string"},
                        "due_date": {"type": ["string", "null"]},
                        "due_date_raw": {"type": "string"},
                        "source_quote": {"type": "string"},
                        "source_start_seconds": {"type": "number"},
                        "source_speaker": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "needs_clarification": {"type": ["string", "null"]},
                        "topic_hint": {"type": ["string", "null"]},
                    },
                },
            }
        },
    },
}

TOOL_DECISIONS = {
    "name": "extract_decisions",
    "description": "抽取已達成的決議、結論、通過的提案。",
    "input_schema": {
        "type": "object",
        "required": ["decisions"],
        "properties": {
            "decisions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["description", "source_quote", "source_start_seconds"],
                    "properties": {
                        "description": {"type": "string"},
                        "source_quote": {"type": "string"},
                        "source_start_seconds": {"type": "number"},
                        "agreed_by_raw_names": {"type": "array", "items": {"type": "string"}},
                        "confidence": {"type": "number"},
                        "topic_hint": {"type": ["string", "null"]},
                    },
                },
            }
        },
    },
}

TOOL_OPEN_QUESTIONS = {
    "name": "extract_open_questions",
    "description": "抽取會議結束時仍未解決的問題。",
    "input_schema": {
        "type": "object",
        "required": ["questions"],
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["question"],
                    "properties": {
                        "question": {"type": "string"},
                        "source_quote": {"type": ["string", "null"]},
                        "source_start_seconds": {"type": ["number", "null"]},
                        "raised_by_speaker": {"type": ["string", "null"]},
                        "blocked_by": {"type": ["string", "null"]},
                        "topic_hint": {"type": ["string", "null"]},
                    },
                },
            }
        },
    },
}

TOOL_TOPICS = {
    "name": "summarize_topics",
    "description": "把會議切成 2–8 個議題段,每段含標題、摘要、起訖時間。",
    "input_schema": {
        "type": "object",
        "required": ["topics"],
        "properties": {
            "topics": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["title", "summary", "start_seconds", "end_seconds"],
                    "properties": {
                        "title": {"type": "string"},
                        "summary": {"type": "string"},
                        "start_seconds": {"type": "number"},
                        "end_seconds": {"type": "number"},
                        "status": {"type": "string", "enum": ["concluded", "paused", "unresolved", "off-topic"]},
                    },
                },
            }
        },
    },
}


# ---------------------------------------------------------------------------
# Extraction orchestrator
# ---------------------------------------------------------------------------


@dataclass
class ExtractionResult:
    action_items: list[dict[str, Any]]
    decisions: list[dict[str, Any]]
    open_questions: list[dict[str, Any]]
    topics: list[dict[str, Any]]
    input_tokens: int
    output_tokens: int


def extract_all(ctx: MeetingContext, transcript_segs: list[dict[str, Any]]) -> ExtractionResult:
    """Call Claude 4× with one tool each. Errors in individual calls are caught
    and logged — we'd rather have 3-of-4 extraction results than 0."""
    transcript_md = format_transcript_md(transcript_segs)
    system = system_prompt(ctx)

    total_in, total_out = 0, 0

    def call(user_msg: str, tool: dict[str, Any], key: str) -> dict[str, Any]:
        nonlocal total_in, total_out
        try:
            resp = get_client().messages.create(
                model=MODEL_PRIMARY,
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
                tools=[tool],
                tool_choice={"type": "tool", "name": tool["name"]},
            )
            total_in += resp.usage.input_tokens
            total_out += resp.usage.output_tokens
            for block in resp.content:
                if block.type == "tool_use" and block.name == tool["name"]:
                    return block.input
            logger.warning("tool %s returned no tool_use block", tool["name"])
            return {key: []}
        except Exception:
            logger.exception("Claude call failed for tool %s", tool["name"])
            return {key: []}

    action_items = call(user_prompt_action_items(transcript_md), TOOL_ACTION_ITEMS, "items").get("items", [])
    decisions = call(user_prompt_decisions(transcript_md), TOOL_DECISIONS, "decisions").get("decisions", [])
    open_questions = call(user_prompt_open_questions(transcript_md), TOOL_OPEN_QUESTIONS, "questions").get("questions", [])
    topics = call(user_prompt_topics(transcript_md), TOOL_TOPICS, "topics").get("topics", [])

    logger.info(
        "extraction done: %d action_items, %d decisions, %d open_questions, %d topics (tokens: in=%d out=%d)",
        len(action_items), len(decisions), len(open_questions), len(topics),
        total_in, total_out,
    )
    return ExtractionResult(
        action_items=action_items,
        decisions=decisions,
        open_questions=open_questions,
        topics=topics,
        input_tokens=total_in,
        output_tokens=total_out,
    )
