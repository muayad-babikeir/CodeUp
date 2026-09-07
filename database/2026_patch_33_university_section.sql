-- ============================================================
-- CodeUp — Patch #33: قسم "الجامعة" — منفصل تمامًا عن نظام الكورسات
-- ============================================================
-- 3 جداول جديدة، هرمية بسيطة:
--   university_semesters (فصل دراسي) → university_subjects (مادة) → university_materials (رابط/فيديو)
-- بدون أي علاقة بجداول courses/units/lessons الحالية — قسم مستقل
-- بالكامل زي ما طُلب. القراءة متاحة لأي مستخدم مسجّل دخول، والإدارة
-- (إضافة/تعديل/حذف) للسوبر أدمن فقط (نفس is_super_admin المستخدمة
-- بباقي المشروع).
-- ============================================================

create table if not exists university_semesters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists university_subjects (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references university_semesters(id) on delete cascade,
  title text not null,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists university_materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references university_subjects(id) on delete cascade,
  title text not null,
  url text not null,
  material_type text not null default 'link' check (material_type in ('video','link','telegram')),
  order_index int not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_university_subjects_semester on university_subjects(semester_id);
create index if not exists idx_university_materials_subject on university_materials(subject_id);

alter table university_semesters enable row level security;
alter table university_subjects  enable row level security;
alter table university_materials enable row level security;

-- قراءة: أي مستخدم مسجّل دخول (كل الطلاب يشوفون محتوى الجامعة، مو بس المسجّلين بكورس معيّن)
drop policy if exists "university_semesters: قراءة لأي مستخدم مسجّل" on university_semesters;
create policy "university_semesters: قراءة لأي مستخدم مسجّل" on university_semesters
  for select using (auth.uid() is not null);

drop policy if exists "university_subjects: قراءة لأي مستخدم مسجّل" on university_subjects;
create policy "university_subjects: قراءة لأي مستخدم مسجّل" on university_subjects
  for select using (auth.uid() is not null);

drop policy if exists "university_materials: قراءة لأي مستخدم مسجّل" on university_materials;
create policy "university_materials: قراءة لأي مستخدم مسجّل" on university_materials
  for select using (auth.uid() is not null);

-- إدارة كاملة (إضافة/تعديل/حذف): سوبر أدمن فقط
drop policy if exists "university_semesters: سوبر أدمن يدير" on university_semesters;
create policy "university_semesters: سوبر أدمن يدير" on university_semesters
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

drop policy if exists "university_subjects: سوبر أدمن يدير" on university_subjects;
create policy "university_subjects: سوبر أدمن يدير" on university_subjects
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

drop policy if exists "university_materials: سوبر أدمن يدير" on university_materials;
create policy "university_materials: سوبر أدمن يدير" on university_materials
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
