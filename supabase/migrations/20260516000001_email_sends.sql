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
