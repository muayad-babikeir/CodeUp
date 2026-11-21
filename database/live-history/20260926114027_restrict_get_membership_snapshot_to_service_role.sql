-- RECORD of a migration that is already applied to the live project (not a new change).
-- Transcribed on 2026-10-10 from supabase_migrations.schema_migrations, version 20260926114027, name restrict_get_membership_snapshot_to_service_role.
-- It had no file in this repository. Do NOT re-run blindly: check the live history first.
-- Transcription was done by hand (comments shortened); compare against the live record before relying on it.

revoke execute on function get_membership_snapshot(uuid) from public;
revoke execute on function get_membership_snapshot(uuid) from anon;
revoke execute on function get_membership_snapshot(uuid) from authenticated;
grant execute on function get_membership_snapshot(uuid) to service_role;
