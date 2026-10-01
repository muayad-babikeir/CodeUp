-- 2026_patch_55_security_hardening_internal_functions.sql
-- (طُبّق مسبقًا على قاعدة البيانات بتاريخ 2026-10-01 — الملف للأرشفة، وإعادة تشغيله آمنة)
-- 1) دوال داخلية تُستدعى من cron أو من دوال SECURITY DEFINER فقط، ولا يستدعيها الكلاينت
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('log_activity','cleanup_old_messages','recalc_enrollment_gamification_backfill')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 2) تثبيت search_path للدوال التي تفتقده (كلها invoker ولا تستخدم extensions)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('generate_member_id','posts_set_updated_at','prevent_self_admin_escalation',
                               'squads_protect_telegram_cols','tech_week_create_team','tech_week_join_team',
                               'tech_week_teams_protect_telegram_cols')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
