-- Phase 0: 雙層 quota 系統（每 org + 平台 hard cap）
-- 本 migration 只新增表與函式，不動既有 schema。
-- 既有 lib/cost/estimate.ts 的 4 道成本防線完全不受影響。

-- ============================================================================
-- 用量計數表
-- ============================================================================
-- 一張表同時記錄 org 級與平台級用量：
--   - org 列：org_id 為實際 UUID
--   - 平台列：org_id 為 NULL，代表全平台彙總
-- ============================================================================

create table quota_usage (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,  -- NULL = platform-level
  resource_type text not null,
  period_start date not null,
  count int not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Postgres 對 UNIQUE 中的 NULL 視為「不相等」，
-- 因此必須分成兩個 partial unique index 才能同時鎖 org 列與平台列。
create unique index quota_usage_org_unique
  on quota_usage (org_id, resource_type, period_start)
  where org_id is not null;

create unique index quota_usage_platform_unique
  on quota_usage (resource_type, period_start)
  where org_id is null;

create index quota_usage_org_period_idx
  on quota_usage (org_id, period_start desc)
  where org_id is not null;

-- ============================================================================
-- Alert 寄送紀錄（80% / 100% 同月不重複）
-- ============================================================================

create table quota_alerts_sent (
  id uuid primary key default uuid_generate_v4(),
  alert_type text not null check (alert_type in ('org_80pct','org_100pct','platform_80pct','platform_100pct')),
  resource_type text not null,
  org_id uuid references organizations(id) on delete cascade,  -- NULL = platform-level
  period_start date not null,
  sent_at timestamptz not null default now()
);

create unique index quota_alerts_sent_org_unique
  on quota_alerts_sent (alert_type, resource_type, org_id, period_start)
  where org_id is not null;

create unique index quota_alerts_sent_platform_unique
  on quota_alerts_sent (alert_type, resource_type, period_start)
  where org_id is null;

-- ============================================================================
-- 原子計數函式：一次 RPC 同時 +1 org 列與平台列，回傳新計數
-- ============================================================================
-- 用 plpgsql 包成單一 transaction，避免兩個 upsert 中間有人讀到不一致狀態。
-- security definer 允許 anon 用 service_role 之外的 client 也能 call（但我們
-- 還是只在 server route 用 admin client 呼叫）。
-- ============================================================================

create or replace function increment_quota_usage(
  p_org_id uuid,
  p_resource_type text,
  p_count int default 1
)
returns table(org_used int, platform_used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date := date_trunc('month', now() at time zone 'utc')::date;
  v_org_used int;
  v_platform_used int;
begin
  -- Org 列
  insert into quota_usage (org_id, resource_type, period_start, count)
  values (p_org_id, p_resource_type, v_period_start, p_count)
  on conflict (org_id, resource_type, period_start) where org_id is not null
  do update set count = quota_usage.count + p_count, updated_at = now()
  returning count into v_org_used;

  -- 平台列
  insert into quota_usage (org_id, resource_type, period_start, count)
  values (null, p_resource_type, v_period_start, p_count)
  on conflict (resource_type, period_start) where org_id is null
  do update set count = quota_usage.count + p_count, updated_at = now()
  returning count into v_platform_used;

  return query select v_org_used, v_platform_used;
end;
$$;

-- 讀取目前用量（不變動）
create or replace function get_quota_status(
  p_org_id uuid,
  p_resource_type text
)
returns table(org_used int, platform_used int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period_start date := date_trunc('month', now() at time zone 'utc')::date;
begin
  return query
    select
      coalesce((select count from quota_usage
        where org_id = p_org_id
          and resource_type = p_resource_type
          and period_start = v_period_start), 0)::int as org_used,
      coalesce((select count from quota_usage
        where org_id is null
          and resource_type = p_resource_type
          and period_start = v_period_start), 0)::int as platform_used;
end;
$$;

-- ============================================================================
-- RLS
-- ============================================================================

alter table quota_usage enable row level security;
alter table quota_alerts_sent enable row level security;

-- quota_usage: org member 只能讀自己 org 的列（平台列對使用者不可見）
create policy "quota_usage visible within org"
  on quota_usage for select
  using (org_id in (select auth_user_org_ids()));

-- quota_alerts_sent: 不加任何 policy，service_role 自動繞過 RLS
-- 一般 authenticated client 因為 RLS 開啟且無 policy，預設不可讀寫。
-- Phase 1: 會議紀錄 email 寄送紀錄

create table email_sends (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  sent_by uuid references auth.users(id) on delete set null,
  recipients text[] not null,
  subject text not null,
  resend_message_id text,
  status text not null default 'sent' check (status in ('sent','failed','pending')),
  error_message text,
  sent_at timestamptz not null default now()
);

create index email_sends_meeting_idx on email_sends(meeting_id, sent_at desc);

alter table email_sends enable row level security;

-- meeting-scoped RLS：同 org 看得到 meeting 就看得到該會議的寄送紀錄
create policy "email_sends visible via meeting access"
  on email_sends for select
  using (
    meeting_id in (
      select id from meetings
      where org_id in (select auth_user_org_ids())
        and (is_confidential = false or created_by = auth.uid())
    )
  );

-- 寫入只能由 service-role 處理（server route 已驗證 user owns meeting），
-- 不開 insert policy 給 authenticated。
-- Phase 3: 公開分享連結（read-only）

create table meeting_share_links (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  org_id uuid not null references organizations(id),   -- 冗餘但方便 quota 統計與 RLS 簡化
  token text unique not null,
  expires_at timestamptz,                              -- NULL = 永久
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  view_count int not null default 0 check (view_count >= 0)
);

create index meeting_share_links_meeting_idx on meeting_share_links(meeting_id, created_at desc);
create index meeting_share_links_token_idx on meeting_share_links(token);

alter table meeting_share_links enable row level security;

-- org 成員可以讀「自己 org 名下」的分享連結紀錄
create policy "share_links visible within org"
  on meeting_share_links for select
  using (org_id in (select auth_user_org_ids()));

-- 建立要透過 server route 用 service-role 寫（route 已驗 user owns meeting），
-- 不開 insert / update policy 給 authenticated。
-- /share/[token] 公開頁也用 service-role 直接讀 token（訪客沒登入）。
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
-- Phase 2: 議題時間軸（跨會議聚類）
-- topic_segments 加 embedding + cluster_id;新建 topic_clusters 表

-- 1. topic_segments 加欄位 -------------------------------------------------
alter table topic_segments add column embedding vector(1536);
alter table topic_segments add column cluster_id uuid;  -- FK 在 cluster 表建好後補

-- 2. topic_clusters 表 -----------------------------------------------------
create table topic_clusters (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  canonical_title text not null,
  centroid vector(1536),
  member_count int not null default 0,        -- cluster 內 topic 數量
  current_state_summary jsonb,                -- LLM 摘要 cache：{summary, next_step, open_blockers[]}
  current_state_at timestamptz,               -- 上次 LLM 摘要時間（30 分鐘 cache）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index topic_clusters_org_idx on topic_clusters(org_id, updated_at desc);
create index topic_clusters_centroid_idx
  on topic_clusters using ivfflat (centroid vector_cosine_ops)
  with (lists = 100);

-- 補上 FK：cluster_id → topic_clusters.id（先建 cluster 表才能 FK）
alter table topic_segments
  add constraint topic_segments_cluster_fk
  foreign key (cluster_id) references topic_clusters(id) on delete set null;

-- topic_segments embedding 也建一個 ivfflat 方便 backfill / 重 cluster 用
create index topic_segments_embedding_idx
  on topic_segments using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 3. RLS -------------------------------------------------------------------
alter table topic_clusters enable row level security;

create policy "topic_clusters visible within org"
  on topic_clusters for select
  using (org_id in (select auth_user_org_ids()));

-- 寫入 / 更新都由 worker（service-role）或 backfill script 處理，
-- 不開 insert/update policy 給 authenticated。
-- Phase 15: 會議影響圈圖譜
-- action_items 加 created_by_member_id（建立者 = 會議建立 user 對應的 member）

alter table action_items add column created_by_member_id uuid
  references members(id) on delete set null;

-- Backfill 既有 rows：對每個 action_item，找其 meeting.created_by → 在該 org 內
-- 對應的 members.id（user_id 配對）。沒對到就留 NULL。
update action_items ai
set created_by_member_id = sub.member_id
from (
  select
    ai2.id as action_id,
    m.id as member_id
  from action_items ai2
  join meetings mt on mt.id = ai2.meeting_id
  join members m on m.user_id = mt.created_by and m.org_id = mt.org_id
) sub
where ai.id = sub.action_id;

create index action_items_created_by_idx on action_items(created_by_member_id);

-- 影響圈 view:在某時間區間內,A 指派任務給 B 的次數
-- meetings.created_at 用作會議時間（spec 寫 started_at，現有 schema 沒這欄位，
-- 改用 created_at 等價）
create or replace view influence_graph as
select
  mt.org_id,
  ai.created_by_member_id as source_id,
  ai.owner_member_id as target_id,
  count(*)::int as weight,
  max(mt.created_at) as last_interaction
from action_items ai
join meetings mt on mt.id = ai.meeting_id
where ai.owner_member_id is not null
  and ai.created_by_member_id is not null
  and ai.created_by_member_id <> ai.owner_member_id
group by mt.org_id, ai.created_by_member_id, ai.owner_member_id;

-- View 沒辦法直接 RLS（PG view 套上 underlying table 的 RLS）。
-- 我們從 Next.js 端只用 RLS-aware client 查它,自動只回該 user 看得到的 org。
