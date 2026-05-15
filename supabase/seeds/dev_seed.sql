-- Dev seed: creates one organization + member row for an existing auth user.
-- Run AFTER creating yourself in Supabase Auth (dashboard → Authentication → Users
-- → Add user → Create new user with email j123258456@gmail.com + a password).
--
-- Without these rows, RLS will block every query you make as that user.

do $$
declare
  v_email   text := 'j123258456@gmail.com';
  v_user_id uuid;
  v_org_id  uuid;
  v_member_count int;
begin
  select id into v_user_id from auth.users where email = v_email limit 1;
  if v_user_id is null then
    raise exception 'No auth user with email %. Create one in Authentication → Users first.', v_email;
  end if;

  select count(*) into v_member_count from members where user_id = v_user_id;
  if v_member_count > 0 then
    raise notice 'User % already has % member row(s) — skipping seed.', v_email, v_member_count;
    return;
  end if;

  insert into organizations (name, plan) values ('MeetingMind Dev', 'team')
  returning id into v_org_id;

  insert into members (org_id, user_id, name, email, role)
  values (v_org_id, v_user_id, 'Dev User', v_email, 'owner');

  raise notice 'Seeded: user_id=%  org_id=%', v_user_id, v_org_id;
end $$;
