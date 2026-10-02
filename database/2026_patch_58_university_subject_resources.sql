-- 2026_patch_58_university_subject_resources.sql
-- (طُبّق مسبقًا على قاعدة البيانات بتاريخ 2026-10-02 — الملف للأرشفة، وإعادة تشغيله آمنة)
-- University: مواد الجامعة بنفس أقسام الدروس (المصدر الأساسي / بدائل / تعمّق / للمذاكرة) بدون جداول جديدة.
alter table public.university_materials add column if not exists role text not null default 'alternative';
alter table public.university_materials add column if not exists publisher text;
alter table public.university_materials add column if not exists language text;
alter table public.university_materials add column if not exists duration_minutes int;

alter table public.university_materials drop constraint if exists university_materials_role_check;
alter table public.university_materials add constraint university_materials_role_check
  check (role in ('recommended','alternative','deep_dive','study'));
alter table public.university_materials drop constraint if exists university_materials_language_check;
alter table public.university_materials add constraint university_materials_language_check
  check (language is null or language in ('ar','en','other'));
alter table public.university_materials drop constraint if exists university_materials_duration_check;
alter table public.university_materials add constraint university_materials_duration_check
  check (duration_minutes is null or duration_minutes between 1 and 1000);

-- توسيع أنواع الرابط (القديمة video/link/telegram تبقى صالحة)
alter table public.university_materials drop constraint if exists university_materials_material_type_check;
alter table public.university_materials add constraint university_materials_material_type_check
  check (material_type in ('video','link','telegram','article','docs','pdf','github'));

-- مصدر أساسي واحد فقط لكل مادة
create unique index if not exists uq_subject_one_recommended
  on public.university_materials(subject_id) where role = 'recommended';

-- حقول المذاكرة على المادة، مثل lessons: شرح مكتوب + PDF + بطاقات Anki
alter table public.university_subjects add column if not exists text_content text;
alter table public.university_subjects add column if not exists pdf_url text;
alter table public.university_subjects add column if not exists anki_ar_url text;
alter table public.university_subjects add column if not exists anki_en_url text;
