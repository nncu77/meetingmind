-- Cost tracking + per-plan quota inputs
-- Append-only migration on top of 20260514000000_init.sql

alter table meetings add column cost_estimate_cents int;
alter table meetings add column llm_input_tokens int;
alter table meetings add column llm_output_tokens int;
alter table meetings add column stt_backend text check (stt_backend in ('groq','local'));
alter table meetings add column gpu_tier text check (gpu_tier in ('a10g','l4','cpu'));

-- Per-org daily counter materialised as a view so the upload route can
-- compute "today's meeting count" in one indexed lookup.
create or replace view meetings_daily_usage as
select
  org_id,
  created_by,
  date_trunc('day', created_at at time zone 'utc')::date as day_utc,
  count(*) as meeting_count,
  coalesce(sum(duration_seconds), 0) as total_audio_seconds,
  coalesce(sum(cost_estimate_cents), 0) as total_cost_cents
from meetings
group by org_id, created_by, day_utc;
