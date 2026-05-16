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
