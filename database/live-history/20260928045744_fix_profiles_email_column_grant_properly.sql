-- RECORD of a migration that is already applied to the live project (not a new change).
-- Transcribed on 2026-10-10 from supabase_migrations.schema_migrations, version 20260928045744, name fix_profiles_email_column_grant_properly.
-- It had no file in this repository. Do NOT re-run blindly: check the live history first.
-- Transcription was done by hand (comments shortened); compare against the live record before relying on it.

-- The previous migration's column-level REVOKE had no effect because a
-- broader table-level GRANT SELECT already covered every column. Fix
-- properly: revoke the table-level grant, then re-grant SELECT on only
-- the safe columns.
revoke select on profiles from authenticated;
revoke select on profiles from anon;

grant select (id, full_name, avatar_url, is_super_admin, created_at) on profiles to authenticated;
-- anon has no legitimate use case here, so it gets nothing.
