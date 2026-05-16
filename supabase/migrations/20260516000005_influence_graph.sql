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
