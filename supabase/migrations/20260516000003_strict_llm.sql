-- Phase 11: 機密會議走 Together AI Llama 70B
-- 加 llm_provider 欄位 + 把 'quota_blocked' 加到 status check

alter table meetings add column llm_provider text
  check (llm_provider in ('anthropic', 'together'));

-- 取代既有的 status check（無法直接 alter，只能 drop + add）
alter table meetings drop constraint if exists meetings_status_check;
alter table meetings add constraint meetings_status_check
  check (status in ('pending','processing','done','failed','quota_blocked'));

-- 既有 privacy_level 仍允許 'standard' / 'enhanced' / 'strict'（不動）。
-- Phase 11 spec 把 'enhanced' 從 UI 隱藏，但 DB 保留以免破壞舊資料。
