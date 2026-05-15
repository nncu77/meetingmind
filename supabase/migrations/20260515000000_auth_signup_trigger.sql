-- On every new auth.users insert, auto-create an organization + member row.
-- This makes signup a single step: user enters email/password → ready to use.
--
-- Org name defaults to the email local-part ("alice@example.com" → "alice's org").
-- Plan defaults to 'free'. Users can rename / upgrade later via /settings.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_local text;
begin
  v_local := split_part(coalesce(new.email, 'user'), '@', 1);

  insert into public.organizations (name, plan)
  values (v_local || '''s org', 'free')
  returning id into v_org_id;

  insert into public.members (org_id, user_id, name, email, role)
  values (
    v_org_id,
    new.id,
    coalesce(new.raw_user_meta_data->>'name', v_local),
    new.email,
    'owner'
  );

  return new;
end;
$$;

-- Idempotent: drop existing trigger before recreating
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
