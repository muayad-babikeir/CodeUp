-- 2026_patch_57_resources_duration_and_study_role.sql
-- (طُبّق مسبقًا على قاعدة البيانات بتاريخ 2026-10-01 — الملف للأرشفة، وإعادة تشغيله آمنة)
-- مدة المصدر بالدقائق (تظهر مثل "12 د")، وبند "للمذاكرة" لمصادر المراجعة الخارجية.
alter table public.resources
  add column if not exists duration_minutes int;
alter table public.resources drop constraint if exists resources_duration_minutes_check;
alter table public.resources
  add constraint resources_duration_minutes_check check (duration_minutes is null or duration_minutes between 1 and 1000);

alter table public.lesson_resources drop constraint if exists lesson_resources_role_check;
alter table public.lesson_resources
  add constraint lesson_resources_role_check check (role in ('recommended','alternative','deep_dive','study'));
