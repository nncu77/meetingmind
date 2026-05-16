# MeetingMind — Demo & Technical Walkthrough

> 中小企業會議智慧助手。從錄音到「可寄出的會議紀錄」，從 90 分鐘的會後處理壓到 8 分鐘。

**Live**: https://meetingmind-xi.vercel.app
**Source**: github.com/nncu77/meetingmind
**Eval metrics**: https://meetingmind-xi.vercel.app/eval

---

## 1. 我為什麼做這個

下午四點半，行政主管 Linda 剛開完今天第四場跨部門會議。她要在六點前把會議紀錄寄出去。錄音 76 分鐘、手寫筆記只有自己看得懂、業務主管已經傳訊問「剛剛說的截止日是哪天？」隔天 Peter 來找她：「那不是我說的，是 Mark 說的，我從來沒答應這件事。」

MeetingMind 解決的就是這個下午：

- **每一句話都能溯源到原始錄音的精確秒數**
- **誰說的不會搞錯**（pyannote 講者分離 + Resemblyzer 聲紋註冊）
- **行動項目自動分派**：動詞 + 負責人 + 截止日，三者齊備才算
- **全程繁體中文**：STT 出來簡中也在 worker 邊界自動轉繁

差異化關鍵：**聲紋註冊**（Otter.ai 因 GDPR 不敢做，中小企業沒這顧慮 — 公司 30 人聲音都認得）。

---

## 2. 怎麼用（5 分鐘 demo）

### 2a. 註冊（30 秒）

1. 開 https://meetingmind-xi.vercel.app
2. 點「建立一個」進 /signup
3. 填 email + 密碼 + 名字 → 註冊
4. 後端自動建 `xxx's org` + member（owner 角色）

> 技術點：用 `@supabase/ssr` 做 cookie-based auth，session 自動 refresh。proxy.ts (Next.js 16 的 middleware) 攔截未登入請求 redirect 到 /login。

### 2b. 現場直錄一段會議（1 分鐘）

1. /meetings → 點紅色「**● 現場直錄**」
2. 填會議標題 → 開始錄音
3. **念這段測試文本**（會有明確的 action items）：
   > 「大家好，今天的會議我們要討論三件事。第一，Mark 你下週三要交報價單給我，再麻煩你了。第二，Peter 你月底前確認新員工人選。第三，Linda 麻煩幫忙整理會議紀錄，今天下午寄出。」
4. 停止 → 預覽 → 「上傳並處理」

> 技術點：MediaRecorder API 用 opus 64 kbps 編碼，60 分鐘會議只佔 28 MB。直接 PUT 到 Supabase Storage 的 signed URL，繞過 Vercel 4.5 MB body 上限。

### 2c. 看結果（30 秒）

跳到 /meetings/[id]，**等 15-30 秒**第一次 cold start：

**畫面分三欄**：

| 欄位 | 內容 |
|---|---|
| 左：逐字稿時間軸 | 講者用顏色區分，每段顯示時間戳。**點任一句話 → 音檔自動跳到那一秒** |
| 中：議題摘要 + 決議 + 未決問題 | Claude 把整場切成 2-8 個議題段，繁中摘要 |
| 右：行動項目 | 每條含負責人、deadline（含相對時間解析如「下週三」→ 2026-05-21）、信心分數（綠橘紅三色）、引文 |

**互動**：
- 點任一行動項目 → 音檔跳到引文那秒 + 對應的逐字稿段落高亮閃黃
- 點上方講者標籤（SPEAKER_00 那種）→ **可以改名**「業務部 Peter」，全會議連動更新

### 2d. 看 /eval 量化頁（30 秒）

點上方「指標」連結：

- 總會議數、總時長、總成本（美分計）
- 平均處理時間
- 行動項目信心分布（綠/橘/紅各幾條）
- LLM token 使用量
- STT backend / GPU tier 分布
- 處理時間 min / median / max

> 全部從 Supabase 即時算出來，**沒造假**。

### 2e. 聲紋註冊（差異化功能 demo，1 分鐘）

1. 上方「成員」 → /members
2. 點任一成員旁的「錄聲紋」
3. 依次念 3 段提示文本（日常語調 / 商務語調 / 強調語氣，各 10 秒）
4. 提交 → worker 用 Resemblyzer 抽 256 維 embedding → 平均 + L2 normalise → 存進 pgvector

註冊後**未來會議錄音**會自動把這個成員的發言段標出真名（cosine similarity ≥ 0.82 才標，保守避免錯認）。

---

## 3. 技術架構

```
┌──────────────────────────────────────────────────────────┐
│                     使用者瀏覽器                            │
│  MediaRecorder 錄音 → Supabase signed URL PUT (直傳)        │
└─────────────────┬────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────┐
│                  Vercel (Next.js 16)                       │
│  • Auth middleware (Supabase SSR cookies, RLS)             │
│  • /api/upload: 兩步上傳（POST signed URL → PATCH 觸發）    │
│  • Server components: /meetings, /meetings/[id], /eval     │
│  • Client islands: 三欄式 review UI、live recorder         │
└──────┬─────────────────────────────────────────┬──────────┘
       │                                         │
       │ inngest.send()                          │ service-role
       ▼                                         ▼
┌────────────────────────┐    ┌────────────────────────────┐
│   Inngest Cloud        │    │   Supabase (Tokyo, Pro)    │
│   (event queue,        │    │   • Postgres + RLS         │
│    retry, dead-letter) │    │   • pgvector (聲紋 256-dim)│
└──────┬─────────────────┘    │   • Storage (50GB bucket)  │
       │ webhook POST          │   • Auth                   │
       ▼                       └────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│   Modal worker (L4 GPU, FastAPI, opensource AI stack)       │
│                                                             │
│   download_audio → ffmpeg normalize 16k mono wav            │
│         ↓                                                   │
│   pyannote.audio 3.3 diarization → speaker_segments         │
│         ↓                                                   │
│   ┌──────────────────────────────┐                         │
│   │ STT_BACKEND switch:           │                         │
│   │  - groq (default, free tier) │ ← OpenAI-compat API     │
│   │  - local (faster-whisper)    │                         │
│   └──────────────────────────────┘                         │
│         ↓                                                   │
│   align speakers ↔ transcript → opencc s2twp 簡→繁          │
│         ↓                                                   │
│   ┌──────────────────────────────┐                         │
│   │ Claude Sonnet 4.5 tool_use   │ ← OpenRouter           │
│   │  × 4 parallel calls:          │                         │
│   │   extract_action_items        │                         │
│   │   extract_decisions           │                         │
│   │   extract_open_questions      │                         │
│   │   summarize_topics            │                         │
│   └──────────────────────────────┘                         │
│         ↓                                                   │
│   write back to Supabase                                    │
└────────────────────────────────────────────────────────────┘
```

### 為什麼這樣分？

| 元件 | 替代方案 | 為什麼選現在這個 |
|---|---|---|
| Next.js + Vercel | Remix / SvelteKit / 純後端 + React SPA | Server actions + RSC 讓 server 端能直接渲染受 RLS 保護的資料,不用寫一堆 API gateway |
| Python worker | Node 跑同樣事 | pyannote / Whisper / Resemblyzer 三個關鍵套件 Python 生態遠勝 Node |
| Modal | AWS Lambda / Cloudflare Workers | Lambda 15 分鐘上限不夠長會議; CF Workers 沒 GPU; Modal 有 GPU on-demand + 60 秒內 cold start |
| Inngest | Vercel cron / 自己寫 queue | Vercel function 60 秒上限,長處理必須丟給外部 queue; Inngest 自動 retry + 死信佇列 + 觀察工具 |
| Supabase | 自架 Postgres + S3 + Auth | RLS 直接在 DB 層做 multi-tenant 隔離,前端不用寫 if-checking,寫錯也不會洩漏 |
| Groq STT | self-host Whisper / OpenAI API / Azure | Groq 跑 Whisper 比 OpenAI 自己快 10×、每日 7,200 秒免費; OpenAI 中文 punctuation 比 Whisper 差 |
| Claude via OpenRouter | OpenAI / Gemini / Claude 直接訂閱 | 中文摘要不會有翻譯腔（vs GPT-4o）; 台灣信用卡刷不過 Anthropic Stripe,OpenRouter 走得通 |

---

## 4. 工程決策深入（面試會被問的點）

### 4a. 成本工程：每場會議 4-15 美分

不是巧合，是設計：

```
60 分鐘會議：
- Groq STT             $0           (免費 tier 內,每日 7,200 秒免費)
- pyannote diarization $0.02-0.03   (Modal L4, 1-2 分鐘 GPU)
- Claude extraction    $0.10-0.12   (~30k input + 2k output tokens)
- Cold start 攤提      $0.005-0.01
─────────────────────────────────
Total                  ~$0.12-0.16 / 場
```

**4 道防線防止失控**：
- OpenRouter key 設 `$5` total cap（用完自動失效）
- Modal `$20`/月 spend limit
- Groq 沒綁卡（用完 rate limit 擋下）
- Supabase Pro `$25` 月費固定 + spend cap ON
- App 層 `PLAN_LIMITS.maxMonthlyCostCents` 強制執行（到 80% 警示, 100% 直接 429 拒絕新上傳）

### 4b. 繁體中文 pipeline 不是「設個語言就好」

- Groq Whisper 對 zh 預設輸出**簡體**（「下周三」「报价单」「员工」）
- 解法 1（直覺）：Claude 抽取時 prompt 強制繁體 → 抽出物是繁體但**原始逐字稿還是簡體**，UI 兩種混雜
- 解法 2（採用）：在 worker stt.py 邊界用 `opencc-python-reimplemented` config=`s2twp` 轉換**所有 STT 輸出**，DB 寫進去就是繁體，全下游一致

**為什麼是 s2twp 不是 s2tw？** 詞彙級轉換差異：
- s2tw: 软件 → 軟件
- s2twp: 软件 → **軟體**（台灣慣用）

### 4c. 防止錯認講者：保守的聲紋閾值

Resemblyzer 是 LibriSpeech 英文訓練的。中文聲紋準度沒那麼高，**特別是男聲音域接近時容易混**。spec 第 1.1 節 Linda 那場會議就是錯認講者的故事 — 「那不是我說的」。

對策：
- 預設閾值 0.82 cosine（vs 預設 0.75）
- 沒過 → 標「未知講者」而不強迫貼名字
- 一個 owner_member_id 自動解析也做了 3 層 fallback（完全匹配 → raw 含 member → member 含 raw），都失敗 → 留 owner_raw_name 給人工複核

**信心分層在 UI 三色化**：
- 綠 ≥ 0.85: 直接信任
- 橘 0.65-0.85: 提醒複核
- 紅 < 0.65: 必須複核

### 4d. Tool Use 而不是 prompt + regex 解析

Claude Sonnet 4.5 的 Tool Use API：給它 JSON schema，模型保證輸出符合 schema 的 JSON。

```python
TOOL_ACTION_ITEMS = {
    "name": "extract_action_items",
    "description": "...",
    "input_schema": {
        "type": "object", "required": ["items"],
        "properties": {
            "items": {"type": "array", "items": {
                "type": "object",
                "required": ["description", "source_quote",
                             "source_start_seconds", "confidence"],
                "properties": {
                    "description": {"type": "string"},
                    "owner_raw_name": {"type": "string"},
                    "due_date": {"type": ["string", "null"]},  # ISO yyyy-mm-dd
                    "confidence": {"type": "number", "min": 0, "max": 1},
                    ...
                }
            }}
        }
    }
}
```

每場會議跑 4 個獨立 tool call（action_items / decisions / open_questions / topics），錯一個不影響其他 — 3 of 4 至少有 3。每個 artifact 都必須回傳 `source_start_seconds` + `source_quote`，這就是「點摘要跳回原始錄音」的承諾基礎。

### 4e. RLS 多租戶隔離

每張表都開了 row-level security，Postgres 規則：

```sql
create policy "meetings visible to org unless confidential"
  on meetings for select
  using (
    org_id in (select auth_user_org_ids())
    and (is_confidential = false or created_by = auth.uid())
  );
```

`auth_user_org_ids()` 是 security-definer function，從 `members` 表用 `auth.uid()` 查當前使用者的 org_id 列表。

效果：
- 公司 A 的 user 永遠看不到公司 B 的會議
- 標記為機密的會議只有發起人能看（即使同公司同事也看不到）
- 行動項目的負責人能看到指派給自己的（即使整場會議不公開）

寫前端時不用記得寫 `WHERE org_id = ?`，**寫錯也不會洩漏資料**（RLS 在 DB 層擋下）。

---

## 4f. v2 擴充進度（進行中）

`feat/v2-expansion` 分支正在加 6 個新功能 + 1 套雙層 quota 系統。所有花錢功能（寄信、Llama 70B 嚴格模式、PDF/Word 匯出、分享連結、議題時間軸 LLM 摘要）都必須先過 `checkQuota()` → 操作後 `recordUsage()`。

**Phase 0(完成）：雙層 quota 系統**

- 每 org 月度上限 + 全平台月度 hard cap，兩道都檢查
- 達 80% / 100% 自動寄 alert email 給 `ALERT_RECIPIENT_EMAIL`（同月不重複）
- `/settings/usage` 顯示當月所有 6 種 resource 的進度條
- 既有 4 道成本防線（`lib/cost/estimate.ts` PLAN_LIMITS）完全不受影響——這套是「v2 新功能呼叫次數」的 quota，與「處理會議的成本」是分離的。

**新增的環境變數（Phase 0）：**

```
RESEND_API_KEY=re_xxx            # Resend API key（alert email 與 Phase 1 寄送會議紀錄共用）
ALERT_RECIPIENT_EMAIL=you@x.com  # 收 quota 警示信的位址（通常就是你自己）
RESEND_FROM_EMAIL=onboarding@resend.dev  # 寄件位址，預設 Resend 沙箱 domain
```

---

## 5. 沒做的事（誠實）

- **多人邀請**：目前 org 是「一個人一個 org」。團隊邀請功能（email 連結 + token-based join）沒做
- **強制 email 驗證**：為了 demo 方便目前 Supabase Auth confirm email = OFF
- **即時逐字稿**：v2 路線圖。MediaRecorder 上傳完整檔再處理，不是 streaming
- **錄音中途瀏覽器當掉的恢復**：v2 用 IndexedDB 緩存 chunks
- **Zoom / Google Meet 整合**：v2
- **「嚴格」隱私層級的 self-hosted Llama 70B**：spec 寫了，但實作上 Together AI hosted Llama 70B 反而比自架便宜 50×（每場 +$0.01），所以延後
- **歷次會議追蹤**：某專案橫跨多場會議的時間軸串接，spec v2

---

## 6. 怎麼快速給人看：3 分鐘 demo 腳本

```
0:00  打開 https://meetingmind-xi.vercel.app
       說：「中小企業會議 SaaS，繁中,可溯源」

0:15  點建立一個 → 30 秒註冊新帳號

0:45  /meetings 空清單 → 點現場直錄
       對麥克風念：「Mark 下週三交報價單,Linda 今天下午整理紀錄」
       說：「在瀏覽器錄音,opus 64kbps,60分鐘只佔 28MB」

1:30  停止 → 上傳並處理
       等 30 秒(第一次 cold start)

2:00  跳到 meeting 詳情頁
       點「Mark 下週三...」那條 action item
       → 音檔自動跳秒,逐字稿高亮閃黃
       說：「每個 artifact 都帶 source_quote + source_seconds,行政點摘要可跳回原始錄音 — 這是『誰說的不會錯』的承諾」

2:30  點「指標」連結
       說：「Portfolio 量化頁,Supabase 即時算的,沒造假。一場成本 4-15 美分」

3:00  結束
```

---

## 7. 給經理的快速問題集

| 經理可能問 | 你準備好的答案 |
|---|---|
| 多少錢一個月？ | 月度地板 $0,demo 流量天花板 $30。Supabase Pro $25 是 sunk cost(跟 fitme/scanbook 共用) |
| 為什麼不用 Otter.ai？ | Otter 不做聲紋註冊(GDPR),不做繁體優化,沒 source-seconds 溯源 |
| AI 抽錯的場景怎麼辦？ | 信心 < 0.85 自動標橘,< 0.65 標紅。Tool Use 強制 JSON schema 防出格答案。原始引文必帶,人工 30 秒複核 |
| Build 多久？ | spec 拿到 → 上線可 demo:4 天 |
| 用了什麼 LLM？ | Claude Sonnet 4.5 via OpenRouter(成本 $3/M input)。中文摘要無翻譯腔。可一鍵切 Haiku 4.5 降成本 4× |
| GPU 哪來？ | Modal serverless GPU,L4 $0.80/hr,只在處理時計費(scaledown 5 分鐘) |
| 程式 open source 嗎? | github.com/nncu77/meetingmind(目前 private,可以開) |

---

寫到這邊。打開 /eval 頁面 + 跑一場 demo,大概 5-7 分鐘就把整個說完。
