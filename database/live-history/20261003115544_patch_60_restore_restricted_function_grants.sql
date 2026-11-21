-- RECORD of a migration that is already applied to the live project (not a new change).
-- Transcribed on 2026-10-10 from supabase_migrations.schema_migrations, version 20261003115544, name patch_60_restore_restricted_function_grants.
-- It had no file in this repository. Do NOT re-run blindly: check the live history first.
-- Transcription was done by hand (comments shortened); compare against the live record before relying on it.

-- patch_59 re-granted authenticated on four internal functions that were restricted
-- earlier (patch_55 and before). This restores the restriction.
revoke execute on function public.log_activity(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.cleanup_old_messages() from public, anon, authenticated;
revoke execute on function public.recalc_enrollment_gamification_backfill(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_membership_snapshot(uuid) from public, anon, authenticated;
