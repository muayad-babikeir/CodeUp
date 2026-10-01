-- (طُبّق مسبقًا على قاعدة البيانات عبر Supabase MCP بتاريخ 2026-10-01 — الملف للأرشفة، وإعادة تشغيله آمنة)
-- 2026_patch_54_learning_path_and_resources.sql
-- طريقة التشغيل: Supabase ← SQL Editor ← New query ← الصق الملف كاملًا ← Run.
-- آمن للتكرار (if not exists)، ويضيف جداول جديدة فقط.
-- additive فقط، idempotent، بلا حذف أو تعديل لأي عمود/جدول/سياسة موجودة.
-- يعتمد على الدوال الموجودة: is_super_admin(uid), is_course_admin(uid,cid),
-- is_enrolled(uid,cid), is_leader_in_course(uid,cid), leader_has_permission(uid,cid,perm)

-- 1) المصادر (المورد نفسه، يُعاد استخدامه بين الدروس)
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('youtube_video','youtube_course','article','docs','pdf',
        'website','interactive','github','external_course')),
  title text not null,
  url text not null,
  description text,
  thumbnail_url text,
  publisher text,
  language text check (language in ('ar','en','other')),
  level text check (level in ('beginner','intermediate','advanced')),
  start_at int,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2) ربط المصدر بالدرس (الدور + الترتيب). التمارين تبقى في assignments.lesson_id
create table if not exists public.lesson_resources (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  role text not null default 'alternative'
       check (role in ('recommended','alternative','deep_dive')),
  order_index int not null default 0,
  created_at timestamptz not null default now(),
  unique (lesson_id, resource_id)
);
create unique index if not exists uq_lesson_one_recommended
  on public.lesson_resources(lesson_id) where role = 'recommended';
create index if not exists idx_lesson_resources_lesson on public.lesson_resources(lesson_id);

-- بلاغات "الرابط لا يعمل" (بلاغ واحد لكل طالب لكل مصدر)
create table if not exists public.resource_reports (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (resource_id, profile_id)
);

-- 3) المسارات والمراحل
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.track_courses (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  stage int not null default 1,
  stage_title text,
  order_index int not null default 0,
  is_optional boolean not null default false,
  prereq_note text,
  unique (track_id, course_id)
);
create index if not exists idx_track_courses_track on public.track_courses(track_id, stage, order_index);

-- RLS
alter table public.resources enable row level security;
alter table public.lesson_resources enable row level security;
alter table public.resource_reports enable row level security;
alter table public.tracks enable row level security;
alter table public.track_courses enable row level security;

-- resources: القراءة لكل مسجّل دخول، والكتابة لسوبر أدمن أو أدمن أي كورس
drop policy if exists "resources: قراءة للمسجّلين" on public.resources;
create policy "resources: قراءة للمسجّلين" on public.resources
  for select using (auth.role() = 'authenticated');

drop policy if exists "resources: كتابة من الأدمن" on public.resources;
create policy "resources: كتابة من الأدمن" on public.resources
  for all
  using (is_super_admin(auth.uid()) or exists (select 1 from public.course_admins ca where ca.profile_id = auth.uid()))
  with check (is_super_admin(auth.uid()) or exists (select 1 from public.course_admins ca where ca.profile_id = auth.uid()));

-- lesson_resources: نفس نمط lessons تمامًا
drop policy if exists "lesson_resources: قراءة" on public.lesson_resources;
create policy "lesson_resources: قراءة" on public.lesson_resources
  for select using (exists (
    select 1 from public.lessons l join public.units u on u.id = l.unit_id
    where l.id = lesson_resources.lesson_id
      and (is_course_admin(auth.uid(), u.course_id) or is_enrolled(auth.uid(), u.course_id)
           or is_leader_in_course(auth.uid(), u.course_id)
           or exists (select 1 from public.courses c where c.id = u.course_id and c.status = 'published'))));

drop policy if exists "lesson_resources: تعديل من أدمن الكورس" on public.lesson_resources;
create policy "lesson_resources: تعديل من أدمن الكورس" on public.lesson_resources
  for all
  using (exists (select 1 from public.lessons l join public.units u on u.id = l.unit_id
                 where l.id = lesson_resources.lesson_id and is_course_admin(auth.uid(), u.course_id)))
  with check (exists (select 1 from public.lessons l join public.units u on u.id = l.unit_id
                 where l.id = lesson_resources.lesson_id and is_course_admin(auth.uid(), u.course_id)));

drop policy if exists "lesson_resources: قائد يضيف حسب صلاحية المحتوى" on public.lesson_resources;
create policy "lesson_resources: قائد يضيف حسب صلاحية المحتوى" on public.lesson_resources
  for insert with check (exists (select 1 from public.lessons l join public.units u on u.id = l.unit_id
                 where l.id = lesson_resources.lesson_id
                   and leader_has_permission(auth.uid(), u.course_id, 'can_add_content')));

-- tracks / track_courses: القراءة لكل مسجّل دخول، والكتابة لسوبر أدمن فقط
drop policy if exists "tracks: قراءة" on public.tracks;
create policy "tracks: قراءة" on public.tracks for select using (auth.role() = 'authenticated');
drop policy if exists "tracks: سوبر أدمن يكتب" on public.tracks;
create policy "tracks: سوبر أدمن يكتب" on public.tracks for all
  using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

drop policy if exists "track_courses: قراءة" on public.track_courses;
create policy "track_courses: قراءة" on public.track_courses for select using (auth.role() = 'authenticated');
drop policy if exists "track_courses: سوبر أدمن يكتب" on public.track_courses;
create policy "track_courses: سوبر أدمن يكتب" on public.track_courses for all
  using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- resource_reports: الطالب يبلّغ باسمه فقط، والقراءة لصاحب البلاغ أو الأدمن
drop policy if exists "resource_reports: الطالب يبلّغ" on public.resource_reports;
create policy "resource_reports: الطالب يبلّغ" on public.resource_reports
  for insert with check (profile_id = auth.uid());
drop policy if exists "resource_reports: قراءة" on public.resource_reports;
create policy "resource_reports: قراءة" on public.resource_reports
  for select using (profile_id = auth.uid() or is_super_admin(auth.uid())
    or exists (select 1 from public.course_admins ca where ca.profile_id = auth.uid()));
