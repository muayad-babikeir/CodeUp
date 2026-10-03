-- 2026_patch_59_revoke_unneeded_function_grants.sql
-- (طُبّق مسبقًا على قاعدة البيانات بتاريخ 2026-10-03 عبر migrationين: patch_59 ثم patch_60 التصحيحي.
--  هذا الملف يجمعهما في صيغة واحدة تعطي الحالة النهائية الصحيحة؛ للأرشفة، وإعادة تشغيله آمنة)
--
-- الهدف: تقليل الدوال المكشوفة للزوّار (anon) دون كسر التطبيق أو سياسات RLS.
--  * دوال الـtriggers لا تُستدعى كـRPC، والـtrigger لا يحتاج EXECUTE وقت التشغيل ← تُسحب من الجميع.
--  * دوال مساعدة السياسات (is_super_admin ...) تبقى متاحة للزائر لأن معظم السياسات "TO public" فتُقيَّم له أيضًا.
--  * باقي الدوال (RPCs التي يستدعيها التطبيق بعد الدخول) ← تُسحب من الزائر وتبقى للمستخدم المسجّل.
--  * أربع دوال داخلية (cron / دوال داخلية) ← تبقى للـservice_role فقط.

-- 1) دوال الـtriggers
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 2) RPCs التطبيق: سحب الزائر فقط (مع استثناء دوال السياسات والدوال الداخلية الأربع)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.prorettype <> 'trigger'::regtype
             and p.proname not in ('can_view_submission','is_course_admin','is_enrolled','is_leader_in_course',
                                   'is_squad_leader_of','is_squad_member_of','is_super_admin','is_tech_week_admin',
                                   'is_university_admin','leader_has_permission','tech_week_team_active_count',
                                   'log_activity','cleanup_old_messages','recalc_enrollment_gamification_backfill',
                                   'get_membership_snapshot')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- 3) الدوال الداخلية: service_role فقط
revoke execute on function public.log_activity(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.cleanup_old_messages() from public, anon, authenticated;
revoke execute on function public.recalc_enrollment_gamification_backfill(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_membership_snapshot(uuid) from public, anon, authenticated;
