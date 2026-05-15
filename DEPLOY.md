# MeetingMind 部署指南

把本地三進程跑通的程式碼上線。前端走 Vercel、worker 走 Modal、資料庫繼續用 Supabase。

整套會跑出來的成本（demo 流量 100 場/月）：

| 元件 | 月費 |
|---|---|
| Vercel Hobby | $0 |
| Supabase Free | $0 |
| Modal (L4 GPU, on-demand) | $5-15 |
| Groq Whisper (free tier) | $0 |
| OpenRouter Claude | $5-10 |
| **合計** | **$10-25** |

## Prerequisites

本地已經跑通完整 smoke test。沒跑過先不要部署。

確認下面四個值你都有：

```
GROQ_API_KEY         (本地 .env.local 已驗)
HF_TOKEN             (本地 .env.local 已驗)
ANTHROPIC_API_KEY    (OpenRouter key)
SUPABASE service-role JWT
```

---

## 1. Modal — 部署 Python worker

### 1a. 註冊 + 安裝 CLI

```powershell
# 在 worker venv 內裝 modal (已經在 requirements.txt)
cd C:\Users\88693\projects\meetingmind\worker
.\.venv\Scripts\Activate.ps1
modal --version   # 應該 0.66+
```

到 https://modal.com 用 GitHub SSO 註冊。新帳號有 $30 免費 credit，跑 demo 夠用。

### 1b. CLI 認證

```powershell
modal token new
```

會開瀏覽器讓你授權，自動把 token 寫到 `~/.modal.toml`。

### 1c. 建 Modal secrets

不要把 .env.local 的值塞進 modal_app.py 程式碼。改放 Modal secrets：

```powershell
modal secret create meetingmind-secrets `
  HF_TOKEN=hf_xxx `
  GROQ_API_KEY=gsk_xxx `
  ANTHROPIC_API_KEY=sk-or-v1-xxx `
  ANTHROPIC_BASE_URL=https://openrouter.ai/api `
  ANTHROPIC_MODEL_PRIMARY=anthropic/claude-sonnet-4.5 `
  NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co `
  SUPABASE_SERVICE_ROLE_KEY=eyJxxx `
  STT_BACKEND=groq `
  MODAL_GPU_TIER=l4 `
  WORKER_SHARED_SECRET=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
```

> 把 `WORKER_SHARED_SECRET` 那個產生的值複製下來，等下 Vercel 那邊也要設成一樣。

### 1d. Deploy

```powershell
cd C:\Users\88693\projects\meetingmind\worker
modal deploy modal_app.py
```

成功會印出類似：

```
✓ Created web endpoint for fastapi_app
✓ App deployed in 23.4s
└─ https://your-workspace--meetingmind-worker-fastapi-app.modal.run
```

**把那個 URL 記下來**，下面 Vercel `WORKER_URL` 要用。

### 1e. Smoke test deployed worker

```powershell
$wurl = 'https://your-workspace--meetingmind-worker-fastapi-app.modal.run'
$secret = '上面 secrets 裡的 WORKER_SHARED_SECRET'
Invoke-RestMethod -Uri "$wurl/health"  # 應該 {"ok": true}
```

第一次 cold start 會慢 60-90 秒（loading pyannote）。後續每 5 分鐘內的呼叫都 warm。

---

## 2. Supabase — 生產設定

你的 `zufgnifldkrhwqzdfkxu` 專案已經當作 prod 用。確認下面這些：

### 2a. 關閉 Email 確認（demo 用）

Dashboard → Authentication → Providers → Email → **Confirm email = OFF**

> 公開 demo 開放註冊時建議：上線後 1 週看狀況，如果有人亂註冊再打開。

### 2b. 啟用 auth signup trigger（可選）

跑 `supabase/migrations/20260515000000_auth_signup_trigger.sql`（之前可能還沒跑）。

這個 trigger 讓新註冊 user 自動有 org+member。App 端有 fallback 所以不裝也可以，但裝了更乾淨。

SQL Editor → New query → 貼整個檔案 → Run。

### 2c. Bucket 公開存取規則

Storage → meeting-audio → 確認 **Public bucket = OFF**。Worker 用 service-role 走 signed URL，外面打不到。

### 2d. RLS Smoke

用瀏覽器另開一個無痕視窗，連你的 Supabase Studio URL 試試 anon role 能不能 SELECT 任何 table。應該都回空陣列（被 RLS 擋掉）。

---

## 3. Vercel — 部署 Next.js

### 3a. Push 到 GitHub

```powershell
cd C:\Users\88693\projects\meetingmind
git add .
git commit -m "ship MeetingMind v1"
gh repo create meetingmind --private --source=. --push
```

（沒裝 gh CLI 就手動到 github.com 開 repo + git push）

### 3b. Import 到 Vercel

https://vercel.com/new → Import git repo → 選 meetingmind。

Framework Preset: **Next.js** (自動偵測)
Root Directory: 預設根目錄（**不要**指到 worker/，那是 Python）

### 3c. 環境變數

Project Settings → Environment Variables，照下面整個貼進去：

```
NEXT_PUBLIC_SUPABASE_URL          = https://zufgnifldkrhwqzdfkxu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     = eyJ... (legacy anon key)
SUPABASE_SERVICE_ROLE_KEY         = eyJ... (legacy service-role key)
ANTHROPIC_API_KEY                 = sk-or-v1-...
ANTHROPIC_BASE_URL                = https://openrouter.ai/api
ANTHROPIC_MODEL_PRIMARY           = anthropic/claude-sonnet-4.5
GROQ_API_KEY                      = gsk_...
HF_TOKEN                          = hf_...
WORKER_URL                        = https://your-workspace--meetingmind-worker-fastapi-app.modal.run
WORKER_SHARED_SECRET              = (跟 Modal secrets 那邊一模一樣)
INNGEST_EVENT_KEY                 = (見下方 Inngest 區)
INNGEST_SIGNING_KEY               = (見下方 Inngest 區)
MAX_AUDIO_UPLOAD_MB               = 50
NEXT_PUBLIC_APP_URL               = https://meetingmind-xxx.vercel.app (deploy 後拿到的網址)
```

> ⚠️ `WORKER_URL` 跟 `WORKER_SHARED_SECRET` 必須跟 Modal 那組完全相同，不然 worker 會拒絕請求。

### 3d. Inngest 雲端帳號

本地用的是 Inngest dev CLI。上線要用 Inngest cloud。

1. https://www.inngest.com → 註冊
2. 建一個 App，name 填 `meetingmind`
3. 拿 Event Key 和 Signing Key 填到 Vercel env vars 上面那兩個空格
4. Inngest 會自動 discovery：Vercel deploy 後它會去打 `https://your-app.vercel.app/api/inngest` 註冊 functions

### 3e. Deploy

Vercel 自動部署。等狀態變綠後，把分配到的 URL（例 `https://meetingmind-xxx.vercel.app`）填回 `NEXT_PUBLIC_APP_URL` 環境變數，redeploy 一次。

---

## 4. Post-deploy 端到端煙霧測試

1. 開 `https://meetingmind-xxx.vercel.app`
2. 註冊新 user（auto-confirm 因為剛剛關了 email 驗證）
3. 上傳一個 1 分鐘音檔
4. 等 30-60 秒（第一次 cold start 可能 90 秒）
5. 應該跳到 meeting detail 頁，看到 transcript + action_items

如果卡住：
- Vercel function logs（Vercel dashboard → Functions tab）
- Inngest dashboard → Runs（看 processMeeting function 有沒有跑、有沒有錯）
- Modal dashboard → Logs（看 worker /process 收到請求沒）

---

## 5. 後續可選

### 自訂網域

Vercel → Domains → 加你的網域。Supabase URL 不用換。

### Modal cost cap

Modal → Settings → Spend caps → 設 $20/月（保命）。

### 把已知 demo 帳號加進記憶體

如果你要把 portfolio link 寄給面試官：建一個 `demo@meetingmind.demo` 帳號，固定密碼，README 寫上去，讓他們直接登。

### Voice enrollment 在生產的注意

`/members/[id]/enroll` 用 MediaRecorder API，只在 HTTPS 環境下能用（Vercel 自動 HTTPS 所以沒問題）。Safari 上 webm 不支援，會自動 fallback 到 mp4，worker 端 ffmpeg 一樣處理得了。

---

寫到這邊。把這個 URL 寄給面試官、附上 `/eval` 連結（量化數字一頁清楚），那就是「上得了履歷的 portfolio 項目」。
