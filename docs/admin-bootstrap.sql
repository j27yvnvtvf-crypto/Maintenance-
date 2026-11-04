-- ============================================================================
-- ADMIN BOOTSTRAP — Maintenance app (access model v2)
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Grants the administrator flag (members.is_admin = true) to exactly ONE
--   account: the app owner. This is the only supported way to create the
--   first administrator. The application code never sets is_admin, and no
--   migration sets it either.
--
-- CONFIRMED ADMIN ACCOUNT
--   Jose Suarez confirmed on November 3, 2026 that the administrator
--   account is:
--
--       joselorenzo.suarez@icloud.com
--
--   It is the account he registered himself in the app and that was
--   verified in Supabase that same night as the only member
--   (approval_status = 'approved', active = true). The script below
--   resolves the user_id from that verified email — never from a name, a
--   free-text job title, an editable profile field, or a "first user"
--   rule.
--
-- HOW TO RUN (Jose, manually, when approving the access-model release)
--   1. Make sure migration 20261103213000_access_model_v2.sql has been
--      applied to the Supabase project first.
--   2. Open the Supabase dashboard -> SQL Editor for the project.
--   3. Paste this whole file and run it ONCE.
--   4. It aborts with an error if the email does not match exactly one
--      auth user with a linked member row, so a typo cannot grant admin
--      to the wrong account.
--   5. The grant is recorded in public.admin_audit_log with action
--      'bootstrap_admin'.
--
--   Nothing in this file runs automatically. Do NOT move it into
--   supabase/migrations/.
-- ============================================================================

do $$
declare
  admin_email constant text := 'joselorenzo.suarez@icloud.com'; -- confirmed by Jose Suarez, 2026-11-03
  target_user_id uuid;
  target_member_id bigint;
  match_count integer;
begin
  select count(*) into match_count
  from auth.users
  where lower(email) = lower(admin_email);

  if match_count <> 1 then
    raise exception 'Bootstrap aborted: expected exactly 1 auth user for %, found %', admin_email, match_count;
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(admin_email);

  select id into target_member_id
  from public.members
  where user_id = target_user_id;

  if target_member_id is null then
    raise exception 'Bootstrap aborted: no member row is linked to the auth user for %. Sign in to the app once so the member row exists, then re-run.', admin_email;
  end if;

  update public.members
  set is_admin = true,
      approval_status = 'approved',
      active = true
  where id = target_member_id;

  insert into public.admin_audit_log (
    actor_user_id, actor_member_id, actor_email, action,
    target_member_id, target_email, detail
  ) values (
    target_user_id, target_member_id, admin_email, 'bootstrap_admin',
    target_member_id, admin_email,
    jsonb_build_object(
      'method', 'manual_sql_bootstrap',
      'confirmed_by', 'Jose Suarez',
      'confirmed_on', '2026-11-03'
    )
  );

  raise notice 'Administrator granted to % (member id %)', admin_email, target_member_id;
end $$;

-- Verification (optional): should return exactly one row, is_admin = true.
-- select id, email, job_title, is_admin, approval_status, active
-- from public.members
-- where is_admin;
