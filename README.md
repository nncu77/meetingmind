# MeetingMind

> 中小企業會議智慧助手 — 把錄音變成可寄出的會議紀錄，從會後 90 分鐘壓到 8 分鐘。

🌐 **Live**: https://meetingmind-xi.vercel.app
📊 **Eval metrics**: https://meetingmind-xi.vercel.app/eval
🎬 **完整 5 分鐘 walkthrough**: [DEMO.md](./DEMO.md)

---

## 它解決什麼

下午四點，行政主管剛開完今天第四場會議。要在六點前把紀錄寄出去 — 錄音 76 分鐘、手寫筆記只有自己看得懂、業務主管已經傳訊問「截止日是哪天？」 隔天同事又來找：「那不是我說的。」

MeetingMind 把這場會議攤平成：

- **每一句話都能溯源到原始錄音的精確秒數**
- **誰說的不會搞錯**（pyannote 講者分離 + Resemblyzer 聲紋註冊）
- **行動項目自動分派**：動詞 + 負責人 + 截止日，三者齊備才算
- **跨會議議題記憶**：同一個議題在多場會議的演進，自動聚類
- **影響圈圖譜**：誰實際在 org 內推進事情、誰只是被動接任務
- **多管道輸出**：寄 email / 公開分享連結 / PDF / Word 一鍵到位
- **嚴格隱私模式**：機密會議走 Together AI Llama 3.3 70B（不上美國雲）

差異化關鍵：**聲紋註冊**。Otter / Fireflies 因 GDPR 不敢做，中小企業沒這顧慮 — 30 人公司聲音都認得。

---

## Tech stack

**Frontend**
Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · React 19

**Auth & Data**
Supabase (Postgres + pgvector + Storage + Auth) · @supabase/ssr cookie-based session · RLS on every table

**AI worker** （獨立 Modal service, L4 GPU $0.80/hr, scale-to-zero）
Groq Whisper-large-v3 STT (免費 tier) · pyannote.audio 3.3.2 diarization · Resemblyzer 聲紋 · Anthropic Claude Sonnet 4.5 via OpenRouter · Together AI Llama 3.3 70B（嚴格隱私） · OpenAI text-embedding-3-small（議題聚類）

**Infra & 開發**
Inngest Cloud（事件驅動 worker dispatch） · Resend（會議紀錄寄信） · @react-pdf/renderer + docx · Vitest · ESLint · Vercel

---

## 架構

```
[Browser]
   │  MediaRecorder (opus 64kbps)  /  檔案上傳
   ▼
[Supabase Storage]  ← signed URL 直傳，繞過 Vercel 4.5MB body 上限
   │
   ▼
[Next.js on Vercel]
   │  · @supabase/ssr cookie auth
   │  · proxy.ts (Next 16 middleware) 全站 redirect
   │  · 4 道成本防線：OpenRouter $5 cap / Modal $20 cap /
   │    Groq free tier / Supabase spend cap
   │
   ▼ Inngest event
[Modal Worker (Python FastAPI, L4 GPU)]
   ├─ Groq Whisper STT → 繁中逐字稿 (opencc 簡轉繁)
   ├─ pyannote diarization → speaker_segments
   ├─ Resemblyzer 比對已 enrolled members (cosine ≥ 0.82)
   ├─ Claude tool-use 結構化抽取
   │    ├─ topic_segments (議題切段 + 摘要)
   │    ├─ action_items (owner + due_date 含相對時間解析)
   │    ├─ decisions (含 agreed_by 成員)
   │    └─ open_questions
   ├─ OpenAI embedding → topic_segments.embedding (1536d)
   └─ 跨會議聚類 (centroid cosine merge) → topic_clusters
       │
       ▼  writes back via service-role
   [Supabase] status=done
       │
       ▼
   /meetings/[id] 3-column review · /topics timeline · /insights 影響圈
```

---

## AI 怎麼用

**多模型分工，而不是萬能一顆 LLM**：

| 階段 | 模型 | 為什麼選 |
|---|---|---|
| STT | Groq Whisper-large-v3 | 免費 7200 sec/day，速度 5× self-host |
| 講者分離 | pyannote.audio 3.3.2 | open-source SOTA |
| 聲紋識別 | Resemblyzer | 256d embedding 夠用、CPU 跑得動 |
| 結構化抽取 | Claude Sonnet 4.5 (via OpenRouter) | tool-use 強制 JSON schema，避免解析錯誤 |
| 嚴格隱私模式 | Together AI Llama 3.3 70B | 用戶選 strict → 整場走非美國雲 LLM |
| 議題 embedding | OpenAI text-embedding-3-small | $0.02/M token，跨會議聚類用 |
| 跨會議摘要 | Claude Haiku 4.5 | 摘要任務不需 Sonnet 等級，30 分鐘 cache |

**Cost per meeting**: ~$0.04-0.15（依長度）。詳見 [PRICING.md](./PRICING.md)。

---

## 成本紀律

中小企業 SaaS 最容易死的不是流量，是某個 user 上傳 8 小時錄音把帳單炸出來。MeetingMind 從一開始就設 4 道防線：

1. **OpenRouter $5/key cap** — Claude 用量硬上限
2. **Modal $20/month cap** — GPU 用量硬上限
3. **Groq 沒綁卡** = 免費 tier 自然 rate-limit
4. **Supabase Pro spend cap** = 不會 over-bill

加上 phase 0 的 **org-level + platform-level 雙層 quota 系統** + 80%/100% alert email — 任何單一 user 或全平台爆量都會被擋。

---

## 怎麼試？

**最短路徑（3 分鐘）**：

1. https://meetingmind-xi.vercel.app/signup 註冊
2. `/meetings` → 「現場直錄」用麥克風念這段（會有 action items 可抽）：
   > 「今天的會議我們要討論三件事。第一，Mark 你下週三要交報價單。第二，Peter 你月底前確認新員工人選。第三，Linda 麻煩整理會議紀錄今天下午寄出。」
3. 停止 → 上傳 → 等 30 秒處理 → 看 3-column review 跟自動抽出的行動項目

更完整的功能 demo（聲紋註冊、議題時間軸、影響圈、嚴格隱私）見 [DEMO.md](./DEMO.md)。

---

## 本地開發

```bash
git clone https://github.com/nncu77/meetingmind
cd meetingmind
npm install
cp .env.local.example .env.local   # 填上 Supabase / Resend / Anthropic / Modal keys
npm run dev
```

Modal worker 在 `worker/`，獨立部署：

```bash
cd worker
modal deploy worker_main.py
```

DB migrations：`supabase/migrations/*.sql` 直接在 Supabase SQL Editor 跑（依檔名時間戳序）。

---

## 已知限制

- **PDF 字重**：react-pdf 對 Noto Sans TC variable font 支援不穩，匯出字重偏細（功能正常，純 cosmetic）
- **Resend free tier**：寄信收件人限定帳號擁有者，多人收件需 verified sender domain
- **Modal cold start**：首場處理 +15-30 秒；scale-to-zero 設定為了 portfolio 成本考量

---

## License

未授權（portfolio demo 用）。如需評估或洽談請直接聯絡。
