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
