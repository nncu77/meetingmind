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
