-- MeetingMind initial schema
-- Section 6 of spec. RLS on every table.

create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- ============================================================================
-- 1. Organizations & members
-- ============================================================================

create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  plan text not null default 'free' check (plan in ('free','team','business')),
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  role text not null default 'member' check (role in ('owner','admin','member','guest')),
  voice_embedding vector(256),
  enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create index members_org_idx on members(org_id);
create index members_voice_idx on members using ivfflat (voice_embedding vector_cosine_ops) with (lists = 100);

-- ============================================================================
-- 2. Meetings
-- ============================================================================

create table meetings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  audio_url text,
  duration_seconds int,
  language text not null default 'zh',
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  privacy_level text not null default 'standard' check (privacy_level in ('standard','enhanced','strict')),
  is_confidential boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

create index meetings_org_idx on meetings(org_id, created_at desc);

-- ============================================================================
-- 3. Speaker / transcript / topic segments
-- ============================================================================

create table speaker_segments (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  speaker_label text not null,
  matched_member_id uuid references members(id) on delete set null,
  match_confidence numeric(4,3),
  start_seconds numeric(10,3) not null,
  end_seconds numeric(10,3) not null
);

create index speaker_segments_meeting_idx on speaker_segments(meeting_id, start_seconds);

create table transcript_segments (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  speaker_label text,
  text text not null,
  start_seconds numeric(10,3) not null,
  end_seconds numeric(10,3) not null,
  confidence numeric(4,3),
  is_reviewed boolean not null default false,
  has_overlap boolean not null default false
);

create index transcript_segments_meeting_idx on transcript_segments(meeting_id, start_seconds);

create table topic_segments (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  title text not null,
  summary text,
  start_seconds numeric(10,3) not null,
  end_seconds numeric(10,3) not null,
  ordinal int not null default 0
);

create index topic_segments_meeting_idx on topic_segments(meeting_id, ordinal);

-- ============================================================================
-- 4. Action items & decisions
-- ============================================================================

create table action_items (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  topic_segment_id uuid references topic_segments(id) on delete set null,
  description text not null,
  owner_member_id uuid references members(id) on delete set null,
  owner_raw_name text,
  due_date date,
  due_date_raw text,
  source_quote text not null,
  source_start_seconds numeric(10,3) not null,
  source_speaker text,
  status text not null default 'pending' check (status in ('pending','sent','confirmed','done','cancelled')),
  confidence numeric(4,3) not null,
  needs_clarification text,
  created_at timestamptz not null default now()
);

create index action_items_meeting_idx on action_items(meeting_id);
create index action_items_owner_idx on action_items(owner_member_id) where owner_member_id is not null;

create table decisions (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  topic_segment_id uuid references topic_segments(id) on delete set null,
  description text not null,
  source_quote text not null,
  source_start_seconds numeric(10,3) not null,
  agreed_by_member_ids uuid[] not null default '{}',
  confidence numeric(4,3),
  created_at timestamptz not null default now()
);

create index decisions_meeting_idx on decisions(meeting_id);

create table open_questions (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  topic_segment_id uuid references topic_segments(id) on delete set null,
  question text not null,
  source_quote text,
  source_start_seconds numeric(10,3),
  raised_by_speaker text,
  created_at timestamptz not null default now()
);

create index open_questions_meeting_idx on open_questions(meeting_id);

-- ============================================================================
-- 5. Redaction rules
-- ============================================================================

create table redaction_rules (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  pattern text not null,
  is_regex boolean not null default false,
  redaction_label text not null default '████',
  created_at timestamptz not null default now()
);

create index redaction_rules_org_idx on redaction_rules(org_id);

-- ============================================================================
-- RLS policies
-- ============================================================================

alter table organizations      enable row level security;
alter table members            enable row level security;
alter table meetings           enable row level security;
alter table speaker_segments   enable row level security;
alter table transcript_segments enable row level security;
alter table topic_segments     enable row level security;
alter table action_items       enable row level security;
alter table decisions          enable row level security;
alter table open_questions     enable row level security;
alter table redaction_rules    enable row level security;

-- Helper: org membership of current auth user
create or replace function auth_user_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from members where user_id = auth.uid()
$$;

create or replace function auth_user_member_id(org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid() and org_id = org limit 1
$$;

-- organizations: visible if you're a member
create policy "org visible to its members"
  on organizations for select
  using (id in (select auth_user_org_ids()));

-- members: visible within same org
create policy "members visible within org"
  on members for select
  using (org_id in (select auth_user_org_ids()));

create policy "user can update own member row"
  on members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- meetings: visible to org members, but confidential only to creator
create policy "meetings visible to org unless confidential"
  on meetings for select
  using (
    org_id in (select auth_user_org_ids())
    and (
      is_confidential = false
      or created_by = auth.uid()
    )
  );

create policy "meetings insert by org members"
  on meetings for insert
  with check (org_id in (select auth_user_org_ids()) and created_by = auth.uid());

create policy "meetings update by creator"
  on meetings for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Generic helper policy creator for meeting-scoped tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'speaker_segments','transcript_segments','topic_segments',
    'decisions','open_questions'
  ]
  loop
    execute format($f$
      create policy "%1$s visible via meeting access"
        on %1$s for select
        using (
          meeting_id in (
            select id from meetings
            where org_id in (select auth_user_org_ids())
              and (is_confidential = false or created_by = auth.uid())
          )
        )
    $f$, t);
  end loop;
end$$;

-- action_items: owners see only what is assigned to them; others go through meeting access
create policy "action_items visible via meeting access or as owner"
  on action_items for select
  using (
    owner_member_id = (
      select id from members where user_id = auth.uid()
        and org_id = (select org_id from meetings where id = action_items.meeting_id)
      limit 1
    )
    or meeting_id in (
      select id from meetings
      where org_id in (select auth_user_org_ids())
        and (is_confidential = false or created_by = auth.uid())
    )
  );

-- redaction_rules: org-scoped
create policy "redaction_rules visible within org"
  on redaction_rules for select
  using (org_id in (select auth_user_org_ids()));

create policy "redaction_rules manage within org"
  on redaction_rules for all
  using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));

-- ============================================================================
-- Storage bucket: meeting-audio (run separately in Storage UI or via API)
-- ============================================================================
-- Service-role writes audio (worker side). Users read via signed URL only.
-- Bucket policies are managed in supabase/storage; the worker uses service-role
-- key to bypass storage RLS (see project memory: feedback_supabase_ssr_storage_rls).
