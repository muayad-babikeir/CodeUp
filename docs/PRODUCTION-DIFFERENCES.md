# Repository vs production

Method: read-only queries against the live Supabase project on 2026-10-10 (`list_tables`, migration history, `pg_*` catalogs, `cron.job` without command text, function logs). Nothing was changed. **Confirmed** = observed directly; **Inferred** = concluded from confirmed facts; **Not examined** = not looked at.

## 1. Migration history

| Fact | Level |
|---|---|
| The live project tracks 66 migrations with timestamp versions (for example `patch_6_leader_permissions` … `patch_66_telegram_ownership`). | Confirmed |
| Live history contains `patch_7` to `patch_21`, `patch_23` to `patch_26` that have **no file** in `database/`. | Confirmed |
| Live history contains migrations named `tech_week_*`, `marketplace_*`, `fix_membership_snapshot_course_name_column`, `restrict_get_membership_snapshot_to_service_role`, `restrict_profiles_email_column_access`, `patch_59_profile_fields_and_completed_courses`, `patch_60_restore_restricted_function_grants` that have no matching file. | Confirmed |
| Repo files `patch_28` to `patch_43`, `patch_45`, `patch_46`, `patch_48` do not appear in the live history under those numbers, yet their objects exist live (university tables, Tech Week tables, `archive_settings`, and so on). They were probably applied outside migration tracking or under other names (for example `tech_week_settings` ≈ patch 46, `restrict_profiles_email_column_access` ≈ patch 48). | Inferred |
| `patch_66_telegram_ownership` is applied live (`telegram_resource_owners` exists with rows; the three RPCs exist). The repo file header saying it is not yet applied is stale. | Confirmed |
| Repo `patch_59_revoke_unneeded_function_grants` re-granted `authenticated` on four internal functions (`log_activity`, `cleanup_old_messages`, `recalc_enrollment_gamification_backfill`, `get_membership_snapshot`); live `patch_60_restore_restricted_function_grants` (not in the repo) revoked them again. | Confirmed (SQL read from the live history) |
| **Live grant state checked 2026-10-10: correct and matching the intent.** The four functions are executable by no API role; no trigger function is executable by `anon`, `authenticated` or `PUBLIC`; `anon` can execute only the 11 RLS helper functions listed in patch 59 (`is_super_admin`, `is_course_admin`, `is_enrolled`, `is_leader_in_course`, `is_squad_leader_of`, `is_squad_member_of`, `can_view_submission`, `leader_has_permission`, `is_university_admin`, `is_tech_week_admin`, `tech_week_team_active_count`). **No missing or excess grants were found, so no production grant change is needed.** The only gap is that the repository lacks the restore migration; applying the repo's patch 59 to a fresh database without it would leave those four functions executable by `authenticated`. | Confirmed |
| Five of the small security-related live migrations are now recorded in `database/live-history/` (by hand, marked as records, not to be re-run). The rest of the missing history is still unrecovered. | Confirmed |
| Repo files `2026_patch_67_*`, `2026_patch_68_*` and `2026_patch_69_*` were written by this audit and are **applied nowhere**. | Confirmed |

## 2. Objects that exist live but have no `CREATE` in the repo
See [DATABASE](DATABASE.md). All 18 tables and all inspected RPCs exist. RLS is enabled on every public table listed.

## 3. Edge Functions
All nine are `ACTIVE`. `verify_jwt=false`: `archive-student-files`, `telegram-team-topic`, `telegram-resource-cleanup`, `telegram-import`; the other five verify the JWT. `archive-student-files` (live v17) was compared with the local file by reading and matches; this was **not a mechanical diff**. The other eight were **not compared** (the tools return source text to the assistant, not to a diff tool).

## 4. Scheduled jobs
Six active jobs. `daily-archive-student-files` (job 1) and `codeup-archive-student-files-daily` (job 3) have the same schedule (02:00 UTC) and URL, but different secrets (42 vs 32 characters). Job 3 shares its secret with the three other cron jobs. The function log for 2026-10-10 02:00 UTC shows one 200 and one 401 for the same moment, so job 1 is the failing duplicate and `CRON_SECRET` **is set** in production (otherwise both would have returned 200). `cleanup-old-messages` (03:00) has no `cron.schedule` in any repo SQL file (searched).

## 5. Safe recovery of missing definitions (not run)
1. Do **not** run `supabase db pull` against the repository working tree: it writes into `supabase/migrations/` and can rename or interleave files.
2. Instead dump into a separate folder: `supabase db dump --linked --schema public -f snapshots/2026-10-10-public-schema.sql` (schema only, no data). Commit it as a **snapshot**, labelled as such, not as a migration.
3. Review the snapshot against `database/`; add a single baseline migration only after the team agrees how history will be tracked going forward.
4. Never create files that pretend each missing historical patch was applied on a date.

## 6. Not examined
Bodies of most RLS policies outside those cited, all other function definitions, storage object contents, row data, and the deployed code of eight functions.
