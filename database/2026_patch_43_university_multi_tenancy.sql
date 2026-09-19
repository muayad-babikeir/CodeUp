-- 2026_patch_43_university_multi_tenancy.sql
--
-- تحويل قسم "الجامعة" (patch_33) من جامعة واحدة ضمنية إلى بنية تعدد-جامعات حقيقية.
-- المرحلة الأولى من مقترح التعاون الجامعي — الأساس اللي يُبنى فوقه كل شي (اليوم
-- التقني، خارطة الكورسات...) لاحقًا، بمراحل منفصلة تمامًا.
--
-- ⚠️ قبل التشغيل على قاعدة بيانات حية: خذ نسخة احتياطية (Backup) من الجداول
-- الثلاثة university_semesters / university_subjects / university_materials.
-- السكربت مصمّم ليكون آمنًا 100% على البيانات الموجودة (لا حذف، لا Overwrite)،
-- لكن الاحتياط دائمًا أسلم قبل أي Migration على جدول فيه بيانات حقيقية.
--
-- ما الذي يتغيّر:
--   1) جدول جديد universities (بدون أي بيانات وهمية — صف واحد فقط يمثّل المحتوى
--      الحالي، بعنوان مؤقت يقدر الأدمن يغيّره من لوحة التحكم فور تشغيل الباتش)
--   2) عمود جديد university_id على university_semesters (nullable أولًا، يُملأ
--      تلقائيًا بالجامعة الافتراضية، ثم NOT NULL بأمان بعد التأكد من عدم وجود صفوف فاضية)
--   3) جدول جديد university_admins — نفس بنية course_admins بالحرف (owner/admin)
--   4) دالة is_university_admin(uid, univ_id) — نفس نمط is_course_admin بالحرف
--   5) تحديث سياسات RLS للإدارة (INSERT/UPDATE/DELETE) لتصبح مقصورة على أدمن تلك
--      الجامعة تحديدًا بدل سوبر أدمن فقط — سياسات القراءة (SELECT) ما تغيّرت إطلاقًا:
--      تبقى متاحة لأي مستخدم مسجّل دخول، لكل الجامعات، بالضبط زي ما كانت
--
-- ما الذي لا يتغيّر: لا حذف لأي صف موجود، لا تغيير على جداول courses/units/lessons،
-- لا تغيير على صلاحيات is_super_admin (يبقى فوق الكل دائمًا كما في is_course_admin تمامًا)

-- ============================================================
-- 1) جدول الجامعات
-- ============================================================
create table if not exists universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

alter table universities enable row level security;

drop policy if exists "universities: قراءة لأي مستخدم مسجّل" on universities;
create policy "universities: قراءة لأي مستخدم مسجّل" on universities
  for select using (auth.uid() is not null);

drop policy if exists "universities: سوبر أدمن يضيف/يحذف" on universities;
create policy "universities: سوبر أدمن يضيف/يحذف" on universities
  for insert with check (is_super_admin(auth.uid()));
drop policy if exists "universities: سوبر أدمن يحذف" on universities;
create policy "universities: سوبر أدمن يحذف" on universities
  for delete using (is_super_admin(auth.uid()));

-- إنشاء جامعات جديدة يبقى مقصورًا على سوبر أدمن (قرار إداري)، لكن تعديل بيانات
-- جامعة موجودة (الاسم مثلًا) متاح لأدمن تلك الجامعة كمان، بعد إنشاء الدالة أدناه
-- (السياسة الفعلية للـ update تُضاف بعد تعريف is_university_admin بالأسفل)

-- ============================================================
-- 2) ربط السمسترات الحالية بجامعة افتراضية (بدون فقدان أي بيانات)
-- ============================================================
insert into universities (name, slug, order_index)
select 'الجامعة الرئيسية', 'main', 0
where not exists (select 1 from universities);

alter table university_semesters add column if not exists university_id uuid references universities(id) on delete cascade;

update university_semesters
set university_id = (select id from universities order by created_at limit 1)
where university_id is null;

do $$
begin
  if not exists (select 1 from university_semesters where university_id is null) then
    alter table university_semesters alter column university_id set not null;
  end if;
end $$;

create index if not exists idx_university_semesters_university on university_semesters(university_id);

-- ============================================================
-- 3) أدمن الجامعة — نفس بنية course_admins بالحرف
-- ============================================================
create table if not exists university_admins (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner','admin')),
  created_at timestamptz not null default now(),
  unique (university_id, profile_id)
);

alter table university_admins enable row level security;

drop policy if exists "university_admins: قراءة لسوبر أدمن ولنفس أدمن الجامعة" on university_admins;
create policy "university_admins: قراءة لسوبر أدمن ولنفس أدمن الجامعة" on university_admins
  for select using (is_super_admin(auth.uid()) or profile_id = auth.uid());

drop policy if exists "university_admins: سوبر أدمن يدير" on university_admins;
create policy "university_admins: سوبر أدمن يدير" on university_admins
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- ============================================================
-- 4) الدالة — نفس نمط is_course_admin بالحرف
-- ============================================================
create or replace function is_university_admin(uid uuid, univ_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_super_admin(uid) or exists (
    select 1 from university_admins ua where ua.university_id = univ_id and ua.profile_id = uid
  );
$$;

-- الآن نضيف سياسة تعديل الجامعة نفسها (الاسم مثلًا) لأدمن تلك الجامعة، بعد تعريف الدالة
drop policy if exists "universities: أدمن الجامعة يعدّل بياناتها" on universities;
create policy "universities: أدمن الجامعة يعدّل بياناتها" on universities
  for update using (is_university_admin(auth.uid(), id)) with check (is_university_admin(auth.uid(), id));

-- ============================================================
-- 5) تحديث سياسات الإدارة على الجداول الثلاثة — من سوبر أدمن فقط
--    إلى أدمن الجامعة المعنية (والسوبر أدمن يبقى فوق الكل تلقائيًا داخل الدالة)
-- ============================================================
drop policy if exists "university_semesters: سوبر أدمن يدير" on university_semesters;
create policy "university_semesters: أدمن الجامعة يدير" on university_semesters
  for all using (is_university_admin(auth.uid(), university_id)) with check (is_university_admin(auth.uid(), university_id));

drop policy if exists "university_subjects: سوبر أدمن يدير" on university_subjects;
create policy "university_subjects: أدمن الجامعة يدير" on university_subjects
  for all using (exists (select 1 from university_semesters s where s.id = semester_id and is_university_admin(auth.uid(), s.university_id)))
  with check (exists (select 1 from university_semesters s where s.id = semester_id and is_university_admin(auth.uid(), s.university_id)));

drop policy if exists "university_materials: سوبر أدمن يدير" on university_materials;
create policy "university_materials: أدمن الجامعة يدير" on university_materials
  for all using (exists (
    select 1 from university_subjects sub join university_semesters s on s.id = sub.semester_id
    where sub.id = subject_id and is_university_admin(auth.uid(), s.university_id)
  ))
  with check (exists (
    select 1 from university_subjects sub join university_semesters s on s.id = sub.semester_id
    where sub.id = subject_id and is_university_admin(auth.uid(), s.university_id)
  ));

-- ملاحظة: سياسات القراءة (SELECT) الثلاثة من patch_33 لم تُمس إطلاقًا —
-- تبقى متاحة لأي مستخدم مسجّل دخول لكل الجامعات، بلا تغيير.
