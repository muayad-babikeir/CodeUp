-- ============================================================
-- Patch 69 — إزالة مهمة الأرشفة اليومية المكررة
-- STATUS: NOT APPLIED to any database. Apply only after archive-student-files has been
-- redeployed and one run of the kept job returned 200 (see docs/ROLLOUT-PLAN.md).
--
-- Verified read-only on the live project (2026-10-10):
--   job 1  daily-archive-student-files            0 2 * * *  same function URL, 42-character secret
--   job 3  codeup-archive-student-files-daily     0 2 * * *  same function URL, 32-character secret
--          (the same secret as the other three cron jobs, which return 200)
--   function log 2026-10-10 02:00 UTC: one 200 and one 401 for the same run.
-- => job 3 is the working job; job 1 only produces a daily 401.
--
-- Safety: the block removes the duplicate ONLY if the job to keep exists, is active, has the
-- same schedule, and both jobs target archive-student-files. Otherwise it changes nothing and
-- reports why. It never prints a job command (commands contain the cron secret).
-- Idempotent: a second run finds no duplicate and does nothing.
-- Rollback: not needed (the job already fails). To recreate it, schedule it like job 3 with
-- the CURRENT secret; do not reuse the old 42-character secret.
-- ============================================================

begin;

do $$
declare
  v_keep     constant text := 'codeup-archive-student-files-daily';
  v_dup      constant text := 'daily-archive-student-files';
  k_id       bigint;  k_schedule text;  k_command text;  k_active boolean;
  d_id       bigint;  d_schedule text;  d_command text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed; nothing to do';
    return;
  end if;

  select jobid, schedule, command, active into k_id, k_schedule, k_command, k_active
  from cron.job where jobname = v_keep;
  select jobid, schedule, command into d_id, d_schedule, d_command
  from cron.job where jobname = v_dup;

  if d_id is null then
    raise notice 'duplicate job % is not present; nothing to do', v_dup;
    return;
  end if;
  if k_id is null or not k_active then
    raise notice 'job to keep (%) is missing or inactive; refusing to remove %', v_keep, v_dup;
    return;
  end if;
  if k_schedule <> d_schedule
     or position('archive-student-files' in k_command) = 0
     or position('archive-student-files' in d_command) = 0 then
    raise notice 'jobs differ in schedule or target; leaving both for manual review';
    return;
  end if;

  perform cron.unschedule(d_id);
  raise notice 'unscheduled duplicate job % (id %)', v_dup, d_id;
end $$;

commit;
