# MeetingMind 成本與用量

「我真的很窮」— 這份文件就是為你寫的。把每個會花錢的環節攤開，算給你看。

> **2026-05-15 更新**：你已經是 Supabase Pro 用戶（$25/月，全 org 共用）。MeetingMind 從 Free org 搬到 Pro org 後 bucket 上限拉到 50 GB。所以這份文件以下 Pro 用戶數字為準，Free 用戶數字僅供其他人參考。

## 一場 60 分鐘會議花多少錢

預設組合（Groq STT + Modal CPU diarization + Claude Sonnet 4.5 via OpenRouter）：

| 步驟 | 用量 | 單價 | 成本 |
|---|---|---|---|
| Groq Whisper STT | 60 分鐘音檔 | 免費 tier 內（每日 7,200 秒） | **$0** |
| pyannote diarization (Modal CPU) | ~12 分鐘 CPU 時間 | $0.135 / hr | **$0.027** |
| Claude Sonnet 4.5 extraction | ~30k in + ~2k out tokens | $3/M in + $15/M out | **$0.120** |
| Cold start 攤提 | 10 秒 CPU | $0.135 / hr | **$0.0004** |
| **合計** | | | **~$0.15 (15 cents)** |

每小時會議燒 5 元台幣不到。**比 ScanBook 一張收據還便宜**。

## 每月燒多少

### 對你（Supabase Pro 用戶）

| 項目 | 月費 | 性質 |
|---|---|---|
| Supabase Pro 訂閱 | **$25** | 固定，整個 nncu77's Org 共用（fitme / face-access / scanbook / meetingmind 一起算） |
| MeetingMind 變動成本（Modal + OpenRouter + Groq） | ~$5-10 | 100 場/月情境 |
| **MeetingMind 月度地板** | **$0** | 完全不用就不用付 |
| **MeetingMind 月度天花板**（被 PLAN_LIMITS 擋下） | 看你 org 的 plan 欄位 | 預設你的 meetingmind dev org 是 `team` plan,$50 上限 |

> ⚠️ Supabase Pro 那 $25 是無論你用不用 MeetingMind 都要付的（為了 fitme/scanbook 那幾個 project）。MeetingMind 本身的「邊際成本」其實是 0 起跳。

### 對其他人（從你 portfolio fork 來自己跑的）

各 plan 上限（寫死在 `lib/cost/estimate.ts` PLAN_LIMITS）：

| Plan | 單檔上限 | 每日上限 | **每月成本天花板** | 60 分鐘會議能跑幾場 |
|---|---|---|---|---|
| free | 5 分鐘 | 3 場 | $5 | ~33 場 |
| team | 60 分鐘 | 50 場 | $50 | ~330 場 |
| business | 180 分鐘 | 500 場 | $500 | ~1100 場（3 小時） |

> **天花板會阻擋上傳**：到達 100% 後新會議直接 429 拒絕。`/meetings` 頁面顯示用量條，到 80% 變橘色警示，100% 變紅色。

## Supabase 升級 / 搬家後續（已完成 2026-05-15）

你的 meetingmind project 原本在某個 Free org，已搬到 `nncu77's Org`(Pro)：

| Resource | 之前 (Free) | 現在 (Pro) |
|---|---|---|
| Single file size | 50 MB hard | **50 GB**（已 PUT 設成此值） |
| Storage total | 1 GB | 100 GB |
| DB size | 500 MB | 8 GB |
| Bandwidth | 5 GB/月 | 250 GB/月 |
| Auth MAU | 50k | 100k |

App 端 `MAX_AUDIO_UPLOAD_MB=500` — 把 hard cap 設在 500 MB（5h MP3 128kbps 等級）。要更大就改這個 env 變數,Supabase 那邊已經放到 50 GB 不會擋你。

## 其他省錢槓桿（不用升任何東西）

### 槓桿 1：嚴格 plan 切到 Haiku 4.5

預設用 Sonnet 4.5。Haiku 4.5 便宜 4 倍但抽取質量略降。改：

```ts
// lib/cost/estimate.ts
// 把 sonnet_45_* 改用 haiku_45_*
```

或在 worker `.env` 加：
```
ANTHROPIC_MODEL_PRIMARY=anthropic/claude-haiku-4.5
```

省約 60% LLM 成本，每場降到 ~6 cents。

### 槓桿 2：暫停 Claude 抽取，只做轉錄 + 講者分離

修 `worker/transcribe.py`，把 `extract_all(...)` 那行註解掉。每場降到 ~3 cents（只剩 diarization 成本）。

### 槓桿 3：本地 worker 取代 Modal（最省）

不部署到 Modal，永遠跑你筆電：
- Modal 成本歸 0
- 缺點：你電腦必須開機（demo 給人看時不方便）

### 槓桿 4：用 Groq Haiku 抽取（最便宜的 LLM 路徑）

OpenRouter 有 Groq 跑的 Llama 模型，每 M token 不到 $0.10。但中文質量會差 Claude 一截。Portfolio demo 不建議。

## 怎麼把這個專案的「月燒錢」看清楚

兩個地方：

1. **/meetings 列表頁頂端** — 用量條，本月已花 / 上限。每次重整都是即時的。
2. **/eval 頁面** — 總成本、平均每場、token 使用、處理時間 breakdown。

兩個都是 server-side 從 Supabase 算出來，沒造假。

## 改 plan 等級的 SQL

預設新註冊是 `free`。要升級你自己的 org：

```sql
update organizations
set plan = 'team'
where id = '9131c975-6e0d-47cc-be8e-e666d76a7c4a';  -- 換成你的 org id
```

Dashboard → SQL Editor 跑這行。team plan 立即生效（60 分鐘單檔 / 50 場/日 / $50 月上限）。

## 真出意外被誰偷打 API 怎麼辦

1. **OpenRouter** 後台 Settings → Keys → 把那把 key revoke（停掉 LLM 成本）
2. **Groq** 同上
3. **Modal** Dashboard → Settings → Spend caps 設 $20（保命止血）
4. **Supabase** Settings → Billing → Set spend cap

四道防線都建議現在就設一下，5 分鐘搞定。

---

寫到這邊，你的月度地板（什麼都不做）是 $0，天花板（用滿 free plan）是 $5。Sleep tight。
