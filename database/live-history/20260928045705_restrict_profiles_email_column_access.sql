-- RECORD of a migration that is already applied to the live project (not a new change).
-- Transcribed on 2026-10-10 from supabase_migrations.schema_migrations, version 20260928045705, name restrict_profiles_email_column_access.
-- It had no file in this repository and is the only definition of get_profile_emails(). Do NOT re-run blindly.
-- Transcription was done by hand (comments shortened); compare against the live record before relying on it.

-- C1 fix: any authenticated user could read any other user's email via select("*"),
-- because RLS filters rows only and the column grant was open by default.
-- Note: this column-level REVOKE alone had no effect; see 20260928045744_fix_profiles_email_column_grant_properly.sql.
revoke select (email) on profiles from authenticated;
revoke select (email) on profiles from anon;

create or replace function get_profile_emails(p_user_ids uuid[])
returns table(id uuid, email text)
language sql security definer set search_path = public as $$
  select p.id, p.email
  from profiles p
  where p.id = any(p_user_ids)
    and (
      auth.uid() = p.id
      or is_super_admin(auth.uid())
      or exists (
        select 1 from enrollments e
        join course_admins ca on ca.course_id = e.course_id
        where e.profile_id = p.id and ca.profile_id = auth.uid()
      )
      or exists (
        select 1 from enrollments e
        join squad_leaders sl on sl.squad_id = e.squad_id
        where e.profile_id = p.id and sl.profile_id = auth.uid()
      )
      or exists (
        select 1 from university_admins ua where ua.profile_id = auth.uid()
      )
      or exists (
        select 1 from tech_week_admins twa where twa.profile_id = auth.uid()
      )
    );
$$;

revoke execute on function get_profile_emails(uuid[]) from public;
revoke execute on function get_profile_emails(uuid[]) from anon;
grant execute on function get_profile_emails(uuid[]) to authenticated;
