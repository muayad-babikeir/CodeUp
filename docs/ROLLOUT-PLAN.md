# Rollout plan and decisions

**Nothing in this plan has been applied.** All production access so far was `SELECT` or catalog reads, function logs and setting lookups. No user data was modified.

## Blocker: no real database test has been possible
The audit environment has no PostgreSQL, Docker, Supabase CLI or network access, so patches 67 and 68 and their SQL tests (`database/2026_patch_6[78]_tests_in_transaction.sql`) have **never been run or even parsed by Postgres**. Mock tests and static checks are not a substitute. One of these is needed (your choice):

| Option | Cost / risk | Notes |
|---|---|---|
| A. Supabase development branch | Listed price 0.01344 USD per hour (about 0.32 USD per day) | A branch is built by replaying the tracked migration history. Objects created outside tracking (for example tables made from the dashboard) may be missing, so check the branch schema first. Delete the branch afterwards. I will not create it without your approval. |
| B. Local Supabase on your machine (Docker and the Supabase CLI) | Free | Load a schema-only dump of the live project, apply the patches, run the test files. Commands are in section "Running the SQL tests". |
| C. Run the tests inside a rolled-back transaction on production | **Not recommended** | DDL on production, even rolled back, takes locks and breaks your "no production DDL" rule. |

## What is ready
| Item | State |
|---|---|
| `archive-student-files` fix (+12 tests) | Done locally; 12/12 pass (4 fail on the original); **not deployed** |
| Patch 67 Tech Week limits | Written; static checks pass; **database tests not run** |
| Patch 68 posts guard with moderation lock | Written; static checks pass; **database tests not run** |
| Live-only migrations recorded in `database/live-history/` | Done (5 files, hand-transcribed) |
| Function grants | Checked live: **no change needed** |
| Duplicate cron job | Correct job identified; **removal awaits your approval** |

## Duplicate archive job: decision
Keep `codeup-archive-student-files-daily` (job 3). Evidence: same schedule and URL as job 1; job 3 carries the same 32-character secret as the three Telegram jobs (same fingerprint), which return 200 every run; the 02:00 UTC log of 2026-10-10 showed one 200 and one 401 for the archive function, and job 1 is the one with a different (42-character) secret. Job 1 (`daily-archive-student-files`) only produces a daily 401. Nothing is removed until the fixed function is deployed and one run of job 3 returns 200.

## Apply order (each step after your explicit approval)
| # | Step | Files | Verify afterwards | Rollback |
|---|---|---|---|---|
| 0 | Run the SQL tests on branch A or local B; fix any failure and re-run | patch 67, 68 and their `tests_in_transaction` files | all NOTICE lines appear, no exception; the two-session concurrency check at the end of the patch 67 test file | n/a (throwaway database) |
| 1 | Back up: note current function versions (archive-student-files is v17) and keep `docs/rollback/archive-student-files.before-audit.ts` | none | `list_edge_functions` | n/a |
| 2 | Apply patch 67 to production as migration `patch_67_tech_week_limits_enforcement` | `database/2026_patch_67_tech_week_limits_enforcement.sql` | `pg_trigger` shows `trg_tech_week_enforce_limits`; constraints `tech_week_events_capacity_positive`, `tech_week_events_team_sizes_valid` exist; the existing event still reads and registers normally | `drop trigger trg_tech_week_enforce_limits on tech_week_registrations; drop function tech_week_enforce_limits(); alter table tech_week_events drop constraint tech_week_events_capacity_positive, drop constraint tech_week_events_team_sizes_valid; drop index idx_tech_week_regs_team, idx_tech_week_regs_event_status;` |
| 3 | Apply patch 68 as `patch_68_posts_privileged_fields_guard` | `database/2026_patch_68_posts_privileged_fields_guard.sql` | trigger `trg_posts_guard_privileged` exists; with a normal test account a post insert works and a pinned insert fails with `posts_pin_forbidden`; a super admin can still pin with the admin panel | `drop trigger trg_posts_guard_privileged on posts; drop function posts_guard_privileged_fields();` |
| 4 | Deploy the function: `supabase functions deploy archive-student-files --no-verify-jwt` | `supabase/functions/archive-student-files/index.ts` | trigger one scheduled run (or wait for 02:00 UTC); function log shows 200 for the call from job 3 | redeploy `docs/rollback/archive-student-files.before-audit.ts` with the same command |
| 5 | Unschedule the duplicate after step 4 succeeded | none (SQL only): `select cron.unschedule('daily-archive-student-files');` | `cron.job` lists five jobs; next 02:00 run shows exactly one request and a 200 | not needed (the job already fails); if wanted, recreate it like job 3 using the current secret |
| 6 | Fix the stale header of patch 66 in the repo; commit `database/live-history/` and docs | repo only | link check of the docs | git revert |

Before step 4 confirm `CRON_SECRET` is set in the project's function secrets (the log evidence says it is). After step 4 a missing secret would make the function return 503 instead of running.

## Running the SQL tests (not executed here)
```bash
# on a machine with Docker and the Supabase CLI, in a throwaway local project
supabase start
# load a schema-only dump of the live project into the local database (dump with: supabase db dump --linked -f /tmp/live-schema.sql)
psql "$LOCAL_DB_URL" -f /tmp/live-schema.sql
# insert 5 or more rows into public.profiles (the tests use existing profiles; one should be a super admin)
psql "$LOCAL_DB_URL" -f database/2026_patch_67_tech_week_limits_enforcement.sql
psql "$LOCAL_DB_URL" -f database/2026_patch_68_posts_privileged_fields_guard.sql
psql "$LOCAL_DB_URL" -f database/2026_patch_67_tests_in_transaction.sql
psql "$LOCAL_DB_URL" -f database/2026_patch_68_tests_in_transaction.sql
```
Never point these at the production connection string.

## Risk to current CodeUp data
- Verified read-only on 2026-10-10: `tech_week_events` 1 row (team mode, capacity NULL, team size 4 to 5), `tech_week_registrations` 0, `tech_week_teams` 0, `posts` 0 (none pinned, none of a privileged type).
- Patch 67 adds two CHECK constraints (the one existing row satisfies them) and a trigger that only acts on future inserts or updates. Patch 68 only acts on future inserts or updates. Neither deletes or rewrites rows.
- The function change touches no data. The cron change removes one scheduled call that already fails.
- The remaining risk is behavioural, not data loss: a registration or post that previously succeeded would now be rejected when it exceeds a limit or tries to pin or use a privileged type. Both are the intended rules.

## Decisions still open
1. Option A, B or C for the database tests (above).
2. Approve steps 2 to 5 individually.
3. Meaning of `capacity` for team events (patch 67 enforces it only for individual events) and what to do with `team_min_size`.
4. Optional hardening: revoke TRUNCATE, TRIGGER and REFERENCES from `anon` and `authenticated` (not a confirmed vulnerability).
5. Whether `get_profile_emails()` should be scoped for university and Tech Week admins.
6. Whether to build an admin action for hiding posts (none exists today).
