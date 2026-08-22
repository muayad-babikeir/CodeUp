-- ============================================================
-- CodeUp — ملف قاعدة بيانات موحّد وكامل (Fresh Project)
-- تم دمجه من: CodeUp-schema.txt (الأساسي)
--            + 2026_codeup_platform_migration.sql
--            + fix_patch_1 (self enrollment)
--            + fix_patch_2 (notifications + rls)
--            + fix_patch_4 (gamification)
--            + fix_patch_5 (submissions insert/update rls)
--
-- طريقة الاستخدام:
-- 1) أنشئ مشروع Supabase جديد تمامًا (فاضي)
-- 2) SQL Editor -> New query -> الصق هذا الملف كاملًا -> Run
-- 3) بعد إنشاء أول حساب من صفحة تسجيل الدخول بالتطبيق، فعّل
--    السوبر أدمن يدويًا (السطر موجود في آخر الملف بعد التعليق)
-- ============================================================


-- ================================================================
-- PART 1/6 — القاعدة الأساسية (CodeUp-schema.txt)
-- ================================================================

-- ============================================================
-- CodeUp — منصة إدارة كورسات متعددة (Multi-course platform)
-- Schema كامل لـ Supabase (Postgres + RLS)
--
-- طريقة الاستخدام:
-- 1) افتح مشروعك في supabase.com/dashboard
-- 2) من القائمة الجانبية: SQL Editor -> New query
-- 3) الصق هذا الملف كاملًا واضغط Run
-- 4) شغّله مرة واحدة فقط على مشروع نظيف (فيه IF NOT EXISTS
--    للحماية لو احتجت تعيد التشغيل)
-- ============================================================

-- ------------------------------------------------------------
-- 0) Extensions
-- ------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) PROFILES — هوية واحدة لكل إنسان (طالب / قائد / أدمن)
--    مرتبطة تلقائيًا بـ auth.users عبر trigger
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  avatar_url text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- إنشاء profile تلقائيًا عند تسجيل مستخدم جديد في Supabase Auth
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ------------------------------------------------------------
-- 2) COURSES — كل كورس مستقل (C++, Web Dev, ...)
-- ------------------------------------------------------------
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3) COURSE_ADMINS — تفويض إدارة كورس معيّن لأدمن غير الـ Super Admin
--    role: 'owner' (كامل الصلاحيات على الكورس) أو 'admin' (شبه كامل)
-- ------------------------------------------------------------
create table if not exists course_admins (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner','admin')),
  created_at timestamptz not null default now(),
  unique (course_id, profile_id)
);

-- ------------------------------------------------------------
-- 4) SQUADS — مجموعات تتبع لكورس معيّن
-- ------------------------------------------------------------
create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  name text not null,
  emoji text default '🏆',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5) SQUAD_LEADERS — نفس القائد ممكن يشرف على أكثر من مجموعة/كورس
-- ------------------------------------------------------------
create table if not exists squad_leaders (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (squad_id, profile_id)
);

-- ------------------------------------------------------------
-- 6) ENROLLMENTS — صف واحد لكل (طالب + كورس): تقدمه، حالته، نقاطه
--    هنا يعيش كل شيء "خاص بهذا الكورس تحديدًا" للطالب
-- ------------------------------------------------------------
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  squad_id uuid references squads(id) on delete set null,
  status text not null default 'inactive' check (status in ('on_track','at_risk','behind','inactive')),
  progress int not null default 0 check (progress between 0 and 100),
  xp int not null default 0,
  streak int not null default 0,
  completed_count int not null default 0,
  late_assignments int not null default 0,
  last_activity_at timestamptz default now(),
  notes text default '',
  joined_at timestamptz not null default now(),
  unique (course_id, profile_id)
);

-- ------------------------------------------------------------
-- 7) المنهج: UNITS + LESSONS
-- ------------------------------------------------------------
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  order_index int not null default 0
);

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  title text not null,
  order_index int not null default 0,
  video_url text
);

-- ------------------------------------------------------------
-- 8) ASSIGNMENTS + SUBMISSIONS (فيها مسار الملف المرفوع في Storage)
-- ------------------------------------------------------------
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  lesson_id uuid references lessons(id) on delete set null,
  title text not null,
  description text,
  added_date date default current_date,
  deadline date,
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'missing' check (status in ('submitted','late','missing','reviewed')),
  file_path text,          -- مسار الملف داخل Supabase Storage
  grade numeric,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_notes text,
  unique (assignment_id, profile_id)
);

-- ------------------------------------------------------------
-- 9) CHALLENGES + CHALLENGE_PARTICIPANTS
-- ------------------------------------------------------------
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  type text not null default 'daily' check (type in ('daily','weekly')),
  title text not null,
  description text,
  difficulty text default 'متوسط',
  xp int not null default 15,
  deadline date,
  created_at timestamptz not null default now()
);

create table if not exists challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  is_correct boolean,
  submitted_at timestamptz default now(),
  unique (challenge_id, profile_id)
);

-- ------------------------------------------------------------
-- 10) REPORTS — تقارير القادة اليومية عن مجموعاتهم
-- ------------------------------------------------------------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  squad_id uuid not null references squads(id) on delete cascade,
  leader_id uuid references profiles(id),
  report_date date not null default current_date,
  present_count int default 0,
  completed_count int default 0,
  late_count int default 0,
  issue text,
  notes text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 11) ANNOUNCEMENTS
-- ------------------------------------------------------------
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  content text,
  type text default 'general' check (type in ('general','course','challenge','deadline','result')),
  target_squad_id uuid references squads(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 12) ACTIVITY LOG
-- ------------------------------------------------------------
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  actor_id uuid references profiles(id),
  action_text text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 13) POINTS RULES (قابلة للتعديل لكل كورس)
-- ------------------------------------------------------------
create table if not exists points_rules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  label text not null,
  value int not null default 0
);

-- ------------------------------------------------------------
-- 14) FILE UPLOADS metadata (صور/تقارير/مرفقات عامة غير التسليمات)
--     الملفات نفسها تُخزّن في Supabase Storage، وهذا الجدول
--     يربط أي ملف بسجل حقيقي في النظام
-- ------------------------------------------------------------
create table if not exists file_uploads (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  uploader_id uuid references profiles(id),
  related_type text,     -- 'submission' | 'report' | 'announcement' | 'profile' ...
  related_id uuid,
  storage_path text not null,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER لتفادي recursion في RLS)
-- ============================================================
create or replace function is_super_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select p.is_super_admin from profiles p where p.id = uid), false);
$$;

create or replace function is_course_admin(uid uuid, cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_super_admin(uid) or exists (
    select 1 from course_admins ca where ca.course_id = cid and ca.profile_id = uid
  );
$$;

create or replace function is_squad_leader_of(uid uuid, sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from squad_leaders sl where sl.squad_id = sid and sl.profile_id = uid
  );
$$;

-- القائد أدمن على أي كورس فيه أي مجموعة يقودها (صلاحيات محدودة تُطبَّق بالسياسات)
create or replace function is_leader_in_course(uid uuid, cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from squad_leaders sl
    join squads sq on sq.id = sl.squad_id
    where sq.course_id = cid and sl.profile_id = uid
  );
$$;

create or replace function is_enrolled(uid uuid, cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from enrollments e where e.course_id = cid and e.profile_id = uid
  );
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table courses enable row level security;
alter table course_admins enable row level security;
alter table squads enable row level security;
alter table squad_leaders enable row level security;
alter table enrollments enable row level security;
alter table units enable row level security;
alter table lessons enable row level security;
alter table assignments enable row level security;
alter table submissions enable row level security;
alter table challenges enable row level security;
alter table challenge_participants enable row level security;
alter table reports enable row level security;
alter table announcements enable row level security;
alter table activity_log enable row level security;
alter table points_rules enable row level security;
alter table file_uploads enable row level security;

-- ---------- PROFILES ----------
create policy "profiles: يشوف نفسه أو سوبر أدمن يشوف الكل" on profiles
  for select using (id = auth.uid() or is_super_admin(auth.uid()));
create policy "profiles: يعدّل بياناته فقط" on profiles
  for update using (id = auth.uid());

-- ---------- COURSES ----------
create policy "courses: أي مستخدم مسجّل يشوف الكورسات النشطة" on courses
  for select using (auth.role() = 'authenticated');
create policy "courses: سوبر أدمن ينشئ كورس" on courses
  for insert with check (is_super_admin(auth.uid()));
create policy "courses: سوبر أدمن أو owner يعدّل الكورس" on courses
  for update using (is_course_admin(auth.uid(), id));
create policy "courses: سوبر أدمن يحذف" on courses
  for delete using (is_super_admin(auth.uid()));

-- ---------- COURSE_ADMINS ----------
create policy "course_admins: القراءة لأدمن الكورس" on course_admins
  for select using (is_course_admin(auth.uid(), course_id));
create policy "course_admins: سوبر أدمن يعيّن أدمن" on course_admins
  for insert with check (is_super_admin(auth.uid()));
create policy "course_admins: سوبر أدمن يعدّل/يحذف" on course_admins
  for delete using (is_super_admin(auth.uid()));

-- ---------- SQUADS ----------
create policy "squads: يشوفها أدمن الكورس أو قائدها أو طالب مسجل فيه" on squads
  for select using (
    is_course_admin(auth.uid(), course_id)
    or is_leader_in_course(auth.uid(), course_id)
    or is_enrolled(auth.uid(), course_id)
  );
create policy "squads: أدمن الكورس ينشئ/يعدّل/يحذف" on squads
  for insert with check (is_course_admin(auth.uid(), course_id));
create policy "squads: تعديل من أدمن الكورس" on squads
  for update using (is_course_admin(auth.uid(), course_id));
create policy "squads: حذف من أدمن الكورس" on squads
  for delete using (is_course_admin(auth.uid(), course_id));

-- ---------- SQUAD_LEADERS ----------
create policy "squad_leaders: يشوفها أدمن الكورس أو القائد نفسه" on squad_leaders
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id))
  );
create policy "squad_leaders: تعيين من أدمن الكورس فقط" on squad_leaders
  for insert with check (exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id)));
create policy "squad_leaders: إزالة من أدمن الكورس فقط" on squad_leaders
  for delete using (exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id)));

-- ---------- ENROLLMENTS (الجدول الأهم للخصوصية) ----------
create policy "enrollments: الطالب يشوف صفه، القائد يشوف مجموعته، الأدمن يشوف الكل" on enrollments
  for select using (
    profile_id = auth.uid()
    or is_course_admin(auth.uid(), course_id)
    or (squad_id is not null and is_squad_leader_of(auth.uid(), squad_id))
  );
create policy "enrollments: أدمن الكورس يضيف طالب" on enrollments
  for insert with check (is_course_admin(auth.uid(), course_id));
create policy "enrollments: أدمن الكورس أو قائد المجموعة يعدّل (تقدم/حالة/ملاحظات)" on enrollments
  for update using (
    is_course_admin(auth.uid(), course_id)
    or (squad_id is not null and is_squad_leader_of(auth.uid(), squad_id))
  );
create policy "enrollments: أدمن الكورس يحذف" on enrollments
  for delete using (is_course_admin(auth.uid(), course_id));

-- ---------- UNITS / LESSONS (محتوى تعليمي، قراءة لأي مسجل بالكورس) ----------
create policy "units: قراءة لكل مسجل بالكورس أو أدمنه" on units
  for select using (is_course_admin(auth.uid(), course_id) or is_enrolled(auth.uid(), course_id) or is_leader_in_course(auth.uid(), course_id));
create policy "units: تعديل من أدمن الكورس" on units
  for all using (is_course_admin(auth.uid(), course_id)) with check (is_course_admin(auth.uid(), course_id));

create policy "lessons: قراءة لكل مسجل بالكورس" on lessons
  for select using (exists (select 1 from units u where u.id = unit_id and (is_course_admin(auth.uid(), u.course_id) or is_enrolled(auth.uid(), u.course_id) or is_leader_in_course(auth.uid(), u.course_id))));
create policy "lessons: تعديل من أدمن الكورس" on lessons
  for all using (exists (select 1 from units u where u.id = unit_id and is_course_admin(auth.uid(), u.course_id)))
  with check (exists (select 1 from units u where u.id = unit_id and is_course_admin(auth.uid(), u.course_id)));

-- ---------- ASSIGNMENTS ----------
create policy "assignments: قراءة لأي طرف بالكورس" on assignments
  for select using (is_course_admin(auth.uid(), course_id) or is_enrolled(auth.uid(), course_id) or is_leader_in_course(auth.uid(), course_id));
create policy "assignments: إدارة من أدمن الكورس" on assignments
  for all using (is_course_admin(auth.uid(), course_id)) with check (is_course_admin(auth.uid(), course_id));

-- ---------- SUBMISSIONS ----------
create policy "submissions: الطالب صاحب التسليم أو أدمن/قائد الكورس" on submissions
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from assignments a where a.id = assignment_id and (is_course_admin(auth.uid(), a.course_id) or is_leader_in_course(auth.uid(), a.course_id)))
  );
create policy "submissions: الطالب يرفع تسليمه" on submissions
  for insert with check (profile_id = auth.uid());
create policy "submissions: الطالب يعدّل تسليمه قبل المراجعة، أو الأدمن يراجع" on submissions
  for update using (
    profile_id = auth.uid()
    or exists (select 1 from assignments a where a.id = assignment_id and is_course_admin(auth.uid(), a.course_id))
  );

-- ---------- CHALLENGES ----------
create policy "challenges: قراءة لأي طرف بالكورس" on challenges
  for select using (is_course_admin(auth.uid(), course_id) or is_enrolled(auth.uid(), course_id) or is_leader_in_course(auth.uid(), course_id));
create policy "challenges: إدارة من أدمن الكورس" on challenges
  for all using (is_course_admin(auth.uid(), course_id)) with check (is_course_admin(auth.uid(), course_id));

create policy "challenge_participants: يشوف مشاركته أو أدمن الكورس" on challenge_participants
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from challenges c where c.id = challenge_id and is_course_admin(auth.uid(), c.course_id))
  );
create policy "challenge_participants: الطالب يسجل مشاركته" on challenge_participants
  for insert with check (profile_id = auth.uid());

-- ---------- REPORTS (خاصة بالقادة والأدمن فقط، مو الطلاب) ----------
create policy "reports: أدمن الكورس أو قائد المجموعة نفسها" on reports
  for select using (is_course_admin(auth.uid(), course_id) or is_squad_leader_of(auth.uid(), squad_id));
create policy "reports: القائد يضيف تقرير مجموعته" on reports
  for insert with check (is_squad_leader_of(auth.uid(), squad_id) or is_course_admin(auth.uid(), course_id));
create policy "reports: تعديل/حذف من صاحب التقرير أو أدمن الكورس" on reports
  for update using (leader_id = auth.uid() or is_course_admin(auth.uid(), course_id));
create policy "reports: حذف من أدمن الكورس" on reports
  for delete using (is_course_admin(auth.uid(), course_id));

-- ---------- ANNOUNCEMENTS ----------
create policy "announcements: قراءة لأي طرف بالكورس" on announcements
  for select using (is_course_admin(auth.uid(), course_id) or is_enrolled(auth.uid(), course_id) or is_leader_in_course(auth.uid(), course_id));
create policy "announcements: نشر/تعديل من أدمن الكورس" on announcements
  for all using (is_course_admin(auth.uid(), course_id)) with check (is_course_admin(auth.uid(), course_id));

-- ---------- ACTIVITY LOG ----------
create policy "activity_log: قراءة لأدمن الكورس فقط" on activity_log
  for select using (course_id is null and is_super_admin(auth.uid()) or is_course_admin(auth.uid(), course_id));
create policy "activity_log: أي طرف موثّق يسجل حدث" on activity_log
  for insert with check (auth.role() = 'authenticated');

-- ---------- POINTS RULES ----------
create policy "points_rules: قراءة لأي طرف بالكورس" on points_rules
  for select using (is_course_admin(auth.uid(), course_id) or is_enrolled(auth.uid(), course_id) or is_leader_in_course(auth.uid(), course_id));
create policy "points_rules: تعديل من أدمن الكورس" on points_rules
  for all using (is_course_admin(auth.uid(), course_id)) with check (is_course_admin(auth.uid(), course_id));

-- ---------- FILE UPLOADS metadata ----------
create policy "file_uploads: صاحب الملف أو أدمن/قائد الكورس" on file_uploads
  for select using (
    uploader_id = auth.uid()
    or (course_id is not null and (is_course_admin(auth.uid(), course_id) or is_leader_in_course(auth.uid(), course_id)))
  );
create policy "file_uploads: أي طرف موثّق يرفع ملف" on file_uploads
  for insert with check (uploader_id = auth.uid());

-- ============================================================
-- أول Super Admin يدويًا (نفّذ هذا بعد ما تسجّل حسابك الأول
-- عن طريق صفحة تسجيل الدخول في التطبيق، ثم استبدل البريد بالأسفل)
-- ============================================================
-- update profiles set is_super_admin = true where email = 'your-email@example.com';

-- ============================================================
-- Storage buckets (شغّلها من SQL Editor أيضًا)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('course-assets', 'course-assets', true)
on conflict (id) do nothing;

-- سياسات تخزين أساسية: كل مستخدم موثّق يرفع بمجلده الخاص (uid/...)
create policy "submissions bucket: رفع ملفاته فقط" on storage.objects
  for insert with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "submissions bucket: قراءة ملفه فقط" on storage.objects
  for select using (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars bucket: قراءة عامة" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars bucket: رفع صورته فقط" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "course-assets bucket: قراءة عامة" on storage.objects
  for select using (bucket_id = 'course-assets');

-- ============================================================
-- تمّ. الخطوة التالية: أنشئ حسابك الأول من صفحة التسجيل بالتطبيق،
-- ثم فعّل is_super_admin يدويًا بالأمر أعلاه.
-- ============================================================


-- ================================================================
-- PART 2/6 — Migration (Join Requests + Leader Apps + Timeline + ...)
-- ================================================================

-- ============================================================
-- CodeUp — MIGRATION: Join Requests + Leader Applications +
-- Squad-scoped Assignments + Timeline + Comments + Reactions +
-- Notifications + Atomic RPCs + RLS + Storage policies
--
-- هذا الملف Migration إضافي فوق codeup-schema.sql الحالي.
-- آمن لإعادة التشغيل (idempotent) — لا يحذف بيانات أو جداول.
--
-- طريقة الاستخدام:
-- 1) تأكد أنك شغّلت codeup-schema.sql الأصلي أولًا على المشروع.
-- 2) افتح SQL Editor في Supabase والصق هذا الملف كاملًا وشغّله.
-- 3) يمكن إعادة تشغيله بأمان لو احتجت (كل شيء IF NOT EXISTS /
--    CREATE OR REPLACE / DROP POLICY IF EXISTS ثم CREATE).
-- ============================================================

-- ------------------------------------------------------------
-- 0) ALTER: أعمدة جديدة على جداول موجودة
-- ------------------------------------------------------------

-- assignments: نوع (يومي/أسبوعي) + إمكانية استهداف Squad محددة
alter table assignments add column if not exists squad_id uuid references squads(id) on delete cascade;
alter table assignments add column if not exists type text not null default 'weekly' check (type in ('daily','weekly'));
alter table assignments add column if not exists created_by uuid references profiles(id);
alter table assignments add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_assignments_course on assignments(course_id);
create index if not exists idx_assignments_squad on assignments(squad_id);

-- submissions: نص/شرح + Visibility للـ Timeline + تتبع التحديث
alter table submissions add column if not exists content text;
alter table submissions add column if not exists visibility text not null default 'private' check (visibility in ('course','squad','private'));
alter table submissions add column if not exists created_at timestamptz not null default now();
alter table submissions add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_submissions_assignment on submissions(assignment_id);
create index if not exists idx_submissions_profile on submissions(profile_id);
create index if not exists idx_submissions_visibility on submissions(visibility, created_at desc);

-- squads: سعة + حالة (مطلوبة لمنع الانضمام لمجموعة ممتلئة/مؤرشفة)
alter table squads add column if not exists capacity int;
alter table squads add column if not exists description text;
alter table squads add column if not exists status text not null default 'active' check (status in ('active','archived'));

-- courses: حالة النشر (draft/published/archived) بدل is_active فقط — نحافظ على is_active كما هو
alter table courses add column if not exists status text not null default 'published' check (status in ('draft','published','archived'));

-- file_uploads: ربط اختياري مباشر بالتسليم لتسهيل الاستعلام (submission قد يملك عدة ملفات)
alter table file_uploads add column if not exists submission_id uuid references submissions(id) on delete cascade;
alter table file_uploads add column if not exists file_size bigint;
create index if not exists idx_file_uploads_submission on file_uploads(submission_id);

-- ------------------------------------------------------------
-- 1) SQUAD_JOIN_REQUESTS
-- ------------------------------------------------------------
create table if not exists squad_join_requests (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
-- لا يوجد أكثر من طلب pending واحد لنفس الطالب لنفس المجموعة
create unique index if not exists uq_join_request_pending
  on squad_join_requests(squad_id, user_id) where (status = 'pending');
create index if not exists idx_join_requests_squad on squad_join_requests(squad_id, status);
create index if not exists idx_join_requests_user on squad_join_requests(user_id);

-- ------------------------------------------------------------
-- 2) LEADER_APPLICATIONS
-- ------------------------------------------------------------
create table if not exists leader_applications (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  squad_id uuid references squads(id) on delete set null,
  message text,
  experience text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_leader_application_pending
  on leader_applications(course_id, user_id) where (status = 'pending');
create index if not exists idx_leader_apps_course on leader_applications(course_id, status);
create index if not exists idx_leader_apps_user on leader_applications(user_id);

-- ------------------------------------------------------------
-- 3) COMMENTS (+ Replies عبر parent_id) على SUBMISSIONS
-- ------------------------------------------------------------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  parent_id uuid references comments(id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_comments_submission on comments(submission_id, created_at);
create index if not exists idx_comments_parent on comments(parent_id);

-- ------------------------------------------------------------
-- 4) REACTIONS (على submissions أو comments)
-- ------------------------------------------------------------
create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('submission','comment')),
  target_id uuid not null,
  reaction_type text not null default 'like' check (reaction_type in ('like','helpful','great')),
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id, reaction_type)
);
create index if not exists idx_reactions_target on reactions(target_type, target_id);

-- ------------------------------------------------------------
-- 5) NOTIFICATIONS
-- ------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  related_type text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_profile on notifications(profile_id, is_read, created_at desc);

-- ============================================================
-- HELPER FUNCTIONS الإضافية
-- ============================================================

-- توافق تسمية مع المواصفة (is_platform_admin) فوق نفس عمود is_super_admin الحالي
-- لا ننشئ عمودًا جديدًا حتى لا نكسر البنية الحالية.
create or replace function is_platform_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_super_admin(uid);
$$;

create or replace function is_squad_member(uid uuid, sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from enrollments e where e.squad_id = sid and e.profile_id = uid);
$$;

-- هل يستطيع uid رؤية submission معيّن (صاحبه / أدمن الكورس / قائد مجموعة الطالب / منشور timeline مرئي له)
create or replace function can_view_submission(uid uuid, sub_id uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  s record;
  a record;
  e record;
begin
  select * into s from submissions where id = sub_id;
  if s is null then return false; end if;
  if s.profile_id = uid then return true; end if;

  select * into a from assignments where id = s.assignment_id;
  if a is null then return false; end if;

  if is_course_admin(uid, a.course_id) or is_leader_in_course(uid, a.course_id) then
    return true;
  end if;

  -- Timeline visibility
  select * into e from enrollments where course_id = a.course_id and profile_id = uid;
  if e is null then return false; end if;

  if s.visibility = 'course' then
    return true; -- e موجود يعني uid مسجّل في نفس الكورس
  elsif s.visibility = 'squad' then
    return e.squad_id is not null and e.squad_id = (
      select e2.squad_id from enrollments e2 where e2.profile_id = s.profile_id and e2.course_id = a.course_id
    );
  else
    return false; -- private
  end if;
end;
$$;

create or replace function log_activity(p_course_id uuid, p_actor_id uuid, p_action text)
returns void language sql security definer set search_path = public as $$
  insert into activity_log(course_id, actor_id, action_text) values (p_course_id, p_actor_id, p_action);
$$;

-- ============================================================
-- ATOMIC RPC FUNCTIONS (SECURITY DEFINER + تحقق صلاحيات داخلي)
-- ============================================================

-- ---------- Join Requests ----------
create or replace function request_join_squad(p_squad_id uuid, p_message text default null)
returns squad_join_requests
language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_capacity int;
  v_status text;
  v_current_count int;
  v_already_member boolean;
  v_row squad_join_requests;
begin
  select course_id, capacity, status into v_course_id, v_capacity, v_status
  from squads where id = p_squad_id;

  if v_course_id is null then
    raise exception 'المجموعة غير موجودة';
  end if;
  if v_status <> 'active' then
    raise exception 'المجموعة غير متاحة للانضمام حاليًا';
  end if;

  select exists(select 1 from enrollments where profile_id = auth.uid() and squad_id = p_squad_id)
    into v_already_member;
  if v_already_member then
    raise exception 'أنت عضو بالفعل في هذه المجموعة';
  end if;

  if exists (select 1 from squad_join_requests where squad_id = p_squad_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'لديك طلب انضمام قيد المراجعة بالفعل لهذه المجموعة';
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from enrollments where squad_id = p_squad_id;
    if v_current_count >= v_capacity then
      raise exception 'المجموعة ممتلئة حاليًا';
    end if;
  end if;

  insert into squad_join_requests(squad_id, user_id, message)
  values (p_squad_id, auth.uid(), p_message)
  returning * into v_row;

  perform log_activity(v_course_id, auth.uid(), 'user requested to join squad');
  return v_row;
end;
$$;

create or replace function cancel_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update squad_join_requests
  set status = 'cancelled'
  where id = p_request_id and user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'لا يمكن إلغاء هذا الطلب';
  end if;
end;
$$;

create or replace function approve_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r squad_join_requests;
  v_course_id uuid;
  v_capacity int;
  v_current_count int;
begin
  select * into r from squad_join_requests where id = p_request_id for update;
  if r is null then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  select course_id, capacity into v_course_id, v_capacity from squads where id = r.squad_id;

  if not (is_course_admin(auth.uid(), v_course_id) or is_squad_leader_of(auth.uid(), r.squad_id)) then
    raise exception 'لا تملك صلاحية مراجعة طلبات هذه المجموعة';
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from enrollments where squad_id = r.squad_id;
    if v_current_count >= v_capacity then
      raise exception 'المجموعة ممتلئة، لا يمكن القبول';
    end if;
  end if;

  insert into enrollments(course_id, profile_id, squad_id)
  values (v_course_id, r.user_id, r.squad_id)
  on conflict (course_id, profile_id) do update set squad_id = excluded.squad_id;

  update squad_join_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;

  perform log_activity(v_course_id, auth.uid(), 'join request approved');

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (r.user_id, 'تمت الموافقة على طلب الانضمام 🎉', 'تم قبولك في المجموعة.', 'squad_join_request', r.id);
end;
$$;

create or replace function reject_join_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r squad_join_requests;
  v_course_id uuid;
begin
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'سبب الرفض إلزامي';
  end if;

  select * into r from squad_join_requests where id = p_request_id for update;
  if r is null then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  select course_id into v_course_id from squads where id = r.squad_id;

  if not (is_course_admin(auth.uid(), v_course_id) or is_squad_leader_of(auth.uid(), r.squad_id)) then
    raise exception 'لا تملك صلاحية مراجعة طلبات هذه المجموعة';
  end if;

  update squad_join_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id;

  perform log_activity(v_course_id, auth.uid(), 'join request rejected');

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (r.user_id, 'تم رفض طلب الانضمام', p_reason, 'squad_join_request', r.id);
end;
$$;

-- ---------- Leader Applications ----------
create or replace function apply_for_leader(p_course_id uuid, p_squad_id uuid default null, p_message text default null, p_experience text default null)
returns leader_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row leader_applications;
begin
  if not is_enrolled(auth.uid(), p_course_id) then
    raise exception 'يجب أن تكون مسجلاً في الكورس للتقديم كقائد';
  end if;

  if exists (select 1 from leader_applications where course_id = p_course_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'لديك طلب قيادة قيد المراجعة بالفعل لهذا الكورس';
  end if;

  insert into leader_applications(course_id, user_id, squad_id, message, experience)
  values (p_course_id, auth.uid(), p_squad_id, p_message, p_experience)
  returning * into v_row;

  perform log_activity(p_course_id, auth.uid(), 'leader application submitted');
  return v_row;
end;
$$;

create or replace function approve_leader_application(p_application_id uuid, p_squad_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a leader_applications;
begin
  select * into a from leader_applications where id = p_application_id for update;
  if a is null then raise exception 'الطلب غير موجود'; end if;
  if a.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  if not is_course_admin(auth.uid(), a.course_id) then
    raise exception 'لا تملك صلاحية مراجعة طلبات القيادة لهذا الكورس';
  end if;

  if p_squad_id is null or not exists (select 1 from squads where id = p_squad_id and course_id = a.course_id) then
    raise exception 'يجب اختيار مجموعة صالحة تابعة لنفس الكورس';
  end if;

  insert into squad_leaders(squad_id, profile_id)
  values (p_squad_id, a.user_id)
  on conflict (squad_id, profile_id) do nothing;

  update leader_applications
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), squad_id = p_squad_id
  where id = p_application_id;

  perform log_activity(a.course_id, auth.uid(), 'leader application approved');

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (a.user_id, 'تمت الموافقة على طلب القيادة 👑', 'أصبحت قائد مجموعة.', 'leader_application', a.id);
end;
$$;

create or replace function reject_leader_application(p_application_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  a leader_applications;
begin
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'سبب الرفض إلزامي';
  end if;

  select * into a from leader_applications where id = p_application_id for update;
  if a is null then raise exception 'الطلب غير موجود'; end if;
  if a.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  if not is_course_admin(auth.uid(), a.course_id) then
    raise exception 'لا تملك صلاحية مراجعة طلبات القيادة لهذا الكورس';
  end if;

  update leader_applications
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_application_id;

  perform log_activity(a.course_id, auth.uid(), 'leader application rejected');

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (a.user_id, 'تم رفض طلب القيادة', p_reason, 'leader_application', a.id);
end;
$$;

-- ---------- Comments / Reactions ----------
create or replace function add_comment(p_submission_id uuid, p_content text, p_parent_id uuid default null)
returns comments
language plpgsql security definer set search_path = public as $$
declare
  v_row comments;
begin
  if not can_view_submission(auth.uid(), p_submission_id) then
    raise exception 'لا تملك صلاحية التعليق على هذا المنشور';
  end if;
  if p_content is null or char_length(trim(p_content)) = 0 then
    raise exception 'التعليق فارغ';
  end if;
  if p_parent_id is not null and not exists (select 1 from comments where id = p_parent_id and submission_id = p_submission_id) then
    raise exception 'الرد غير صالح';
  end if;

  insert into comments(submission_id, user_id, parent_id, content)
  values (p_submission_id, auth.uid(), p_parent_id, p_content)
  returning * into v_row;

  perform log_activity(null, auth.uid(), 'comment created');
  return v_row;
end;
$$;

create or replace function toggle_reaction(p_target_type text, p_target_id uuid, p_reaction_type text default 'like')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
begin
  if p_target_type not in ('submission','comment') then
    raise exception 'نوع هدف غير صالح';
  end if;

  if p_target_type = 'submission' then
    if not can_view_submission(auth.uid(), p_target_id) then
      raise exception 'لا تملك صلاحية التفاعل مع هذا المنشور';
    end if;
  end if;

  select exists(
    select 1 from reactions
    where user_id = auth.uid() and target_type = p_target_type and target_id = p_target_id and reaction_type = p_reaction_type
  ) into v_exists;

  if v_exists then
    delete from reactions
    where user_id = auth.uid() and target_type = p_target_type and target_id = p_target_id and reaction_type = p_reaction_type;
    return false; -- تمت إزالة التفاعل
  else
    insert into reactions(user_id, target_type, target_id, reaction_type)
    values (auth.uid(), p_target_type, p_target_id, p_reaction_type);
    return true; -- تمت إضافة التفاعل
  end if;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY على الجداول الجديدة
-- ============================================================
alter table squad_join_requests enable row level security;
alter table leader_applications enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table notifications enable row level security;

-- ---------- SQUAD_JOIN_REQUESTS ----------
drop policy if exists "join_requests: صاحب الطلب أو أدمن/قائد المجموعة" on squad_join_requests;
create policy "join_requests: صاحب الطلب أو أدمن/قائد المجموعة" on squad_join_requests
  for select using (
    user_id = auth.uid()
    or is_squad_leader_of(auth.uid(), squad_id)
    or exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id))
  );
-- الإدراج/التحديث فقط عبر RPC (SECURITY DEFINER) — لا سياسة insert/update مباشرة للعميل
drop policy if exists "join_requests: لا تعديل مباشر" on squad_join_requests;

-- ---------- LEADER_APPLICATIONS ----------
drop policy if exists "leader_apps: صاحب الطلب أو أدمن الكورس" on leader_applications;
create policy "leader_apps: صاحب الطلب أو أدمن الكورس" on leader_applications
  for select using (
    user_id = auth.uid()
    or is_course_admin(auth.uid(), course_id)
  );

-- ---------- COMMENTS ----------
drop policy if exists "comments: قراءة لمن يرى التسليم" on comments;
create policy "comments: قراءة لمن يرى التسليم" on comments
  for select using (can_view_submission(auth.uid(), submission_id));

drop policy if exists "comments: صاحب التعليق يعدّل" on comments;
create policy "comments: صاحب التعليق يعدّل" on comments
  for update using (user_id = auth.uid());

drop policy if exists "comments: صاحبه أو أدمن/قائد الكورس يحذف" on comments;
create policy "comments: صاحبه أو أدمن/قائد الكورس يحذف" on comments
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from submissions s join assignments a on a.id = s.assignment_id
      where s.id = submission_id and (is_course_admin(auth.uid(), a.course_id) or is_leader_in_course(auth.uid(), a.course_id))
    )
  );
-- الإدراج فقط عبر add_comment() RPC لضمان التحقق من الصلاحية والمحتوى

-- ---------- REACTIONS ----------
drop policy if exists "reactions: قراءة عامة لمن يرى الهدف" on reactions;
create policy "reactions: قراءة عامة لمن يرى الهدف" on reactions
  for select using (
    (target_type = 'submission' and can_view_submission(auth.uid(), target_id))
    or (target_type = 'comment' and exists (
      select 1 from comments c where c.id = target_id and can_view_submission(auth.uid(), c.submission_id)
    ))
  );
-- الإدراج/الحذف فقط عبر toggle_reaction() RPC

-- ---------- NOTIFICATIONS ----------
drop policy if exists "notifications: صاحبها فقط" on notifications;
create policy "notifications: صاحبها فقط" on notifications
  for select using (profile_id = auth.uid());
drop policy if exists "notifications: صاحبها يعلّم كمقروء" on notifications;
create policy "notifications: صاحبها يعلّم كمقروء" on notifications
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============================================================
-- تحديث سياسة SUBMISSIONS لدعم Timeline (SELECT عبر can_view_submission)
-- ============================================================
drop policy if exists "submissions: الطالب صاحب التسليم أو أدمن/قائد الكورس" on submissions;
create policy "submissions: قراءة لمن يملك صلاحية العرض" on submissions
  for select using (can_view_submission(auth.uid(), id));

-- ============================================================
-- منع التصعيد الذاتي: لا يمكن لأي مستخدم تعديل عمود is_super_admin
-- الخاص به عبر RLS "profiles: يعدّل بياناته فقط" — نضيّق ذلك بصلاحيات
-- عمودية عبر REVOKE بدل توسيع RLS الحالية (تبقى القيمة قابلة للتغيير
-- فقط عبر Service Role / SQL Editor يدويًا).
-- ============================================================
create or replace function prevent_self_admin_escalation()
returns trigger language plpgsql as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin and auth.uid() = old.id then
    raise exception 'لا يمكنك تغيير صلاحية الإدارة الخاصة بك';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_admin_escalation on profiles;
create trigger trg_prevent_self_admin_escalation
  before update on profiles
  for each row execute procedure prevent_self_admin_escalation();

-- ============================================================
-- STORAGE: السماح لأدمن/قائد الكورس بقراءة ملفات تسليمات طلابهم
-- (بالإضافة إلى سياسة "صاحب الملف يقرأ ملفه" الموجودة أصلًا)
-- ============================================================
drop policy if exists "submissions bucket: أدمن/قائد الكورس يقرأ ملفات طلابه" on storage.objects;
create policy "submissions bucket: أدمن/قائد الكورس يقرأ ملفات طلابه" on storage.objects
  for select using (
    bucket_id = 'submissions'
    and exists (
      select 1 from file_uploads f
      where f.storage_path = storage.objects.name
        and f.course_id is not null
        and (is_course_admin(auth.uid(), f.course_id) or is_leader_in_course(auth.uid(), f.course_id))
    )
  );

-- ============================================================
-- تمّ. راجع التقرير المرفق لقائمة كل ما تم إنشاؤه/تعديله.
-- ============================================================

-- ================================================================
-- PART 3/6 — Fix Patch 1: Self Enrollment
-- ================================================================

-- ============================================================
-- CodeUp — FIX PATCH #1
-- يضيف دالة تسجيل ذاتي في الكورس (enroll_in_course) كانت ناقصة.
-- بدونها: أي طالب يفتح كورس لأول مرة يبقى "غير مسجل" فعليًا في
-- enrollments (لأن سياسة RLS الأصلية تسمح فقط للأدمن بالإضافة)،
-- فيفشل طلب القيادة وأي عملية تتحقق من is_enrolled().
--
-- آمن للتشغيل فوق أي حالة حالية — لا يحذف ولا يعدّل بيانات.
-- شغّله في SQL Editor بعد الملفين السابقين.
-- ============================================================

create or replace function enroll_in_course(p_course_id uuid)
returns enrollments
language plpgsql security definer set search_path = public as $$
declare
  v_row enrollments;
  v_status text;
begin
  select status into v_status from courses where id = p_course_id;
  if v_status is null then
    raise exception 'الكورس غير موجود';
  end if;
  if v_status <> 'published' then
    raise exception 'هذا الكورس غير متاح للتسجيل حاليًا';
  end if;

  insert into enrollments(course_id, profile_id)
  values (p_course_id, auth.uid())
  on conflict (course_id, profile_id) do nothing
  returning * into v_row;

  if v_row is null then
    select * into v_row from enrollments where course_id = p_course_id and profile_id = auth.uid();
  end if;

  perform log_activity(p_course_id, auth.uid(), 'student enrolled in course');
  return v_row;
end;
$$;

-- ============================================================
-- تمّ. لا حاجة لأي تعديل إضافي على RLS — الدالة SECURITY DEFINER
-- تتجاوز قيود enrollments insert المخصصة للأدمن فقط، بنفس طريقة
-- بقية دوال RPC الموجودة أصلًا (approve_join_request وغيرها).
-- ============================================================

-- ================================================================
-- PART 4/6 — Fix Patch 2: Notifications + RLS
-- ================================================================

-- ============================================================
-- CodeUp — FIX PATCH #2
-- يعالج: إشعارات عند إنشاء الطلبات (مو بس عند المراجعة)، مراجعة
-- الواجبات والإعلانات عبر RPC محمي بدل كتابة مباشرة، حماية تسليمات
-- الطلاب من تعديل حقول المراجعة على أنفسهم، وإصلاح صلاحية تعديل
-- is_super_admin لمستخدم آخر (كانت تفشل بصمت بسبب RLS ناقصة).
--
-- آمن للتشغيل فوق أي حالة حالية — لا يحذف بيانات. شغّله بعد
-- الملفين السابقين (migration + fix_patch_1).
-- ============================================================

-- ------------------------------------------------------------
-- 1) إشعار أدمن الكورس (وقائد المجموعة عند الانضمام) فور تسجيل الطلب
-- ------------------------------------------------------------
create or replace function request_join_squad(p_squad_id uuid, p_message text default null)
returns squad_join_requests
language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_capacity int;
  v_status text;
  v_current_count int;
  v_already_member boolean;
  v_row squad_join_requests;
begin
  select course_id, capacity, status into v_course_id, v_capacity, v_status
  from squads where id = p_squad_id;

  if v_course_id is null then
    raise exception 'المجموعة غير موجودة';
  end if;
  if v_status <> 'active' then
    raise exception 'المجموعة غير متاحة للانضمام حاليًا';
  end if;

  select exists(select 1 from enrollments where profile_id = auth.uid() and squad_id = p_squad_id)
    into v_already_member;
  if v_already_member then
    raise exception 'أنت عضو بالفعل في هذه المجموعة';
  end if;

  if exists (select 1 from squad_join_requests where squad_id = p_squad_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'لديك طلب انضمام قيد المراجعة بالفعل لهذه المجموعة';
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from enrollments where squad_id = p_squad_id;
    if v_current_count >= v_capacity then
      raise exception 'المجموعة ممتلئة حاليًا';
    end if;
  end if;

  insert into squad_join_requests(squad_id, user_id, message)
  values (p_squad_id, auth.uid(), p_message)
  returning * into v_row;

  -- إشعار أدمن الكورس + قادة نفس المجموعة (فور التقديم، مو فقط عند المراجعة)
  insert into notifications(profile_id, title, body, related_type, related_id)
  select ca.profile_id, 'طلب انضمام جديد', 'يوجد طلب انضمام جديد بانتظار المراجعة', 'squad_join_request', v_row.id
  from course_admins ca where ca.course_id = v_course_id
  union
  select sl.profile_id, 'طلب انضمام جديد', 'يوجد طلب انضمام جديد لمجموعتك بانتظار المراجعة', 'squad_join_request', v_row.id
  from squad_leaders sl where sl.squad_id = p_squad_id;

  perform log_activity(v_course_id, auth.uid(), 'user requested to join squad');
  return v_row;
end;
$$;

create or replace function apply_for_leader(p_course_id uuid, p_squad_id uuid default null, p_message text default null, p_experience text default null)
returns leader_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row leader_applications;
begin
  if not is_enrolled(auth.uid(), p_course_id) then
    raise exception 'يجب أن تكون مسجلاً في الكورس للتقديم كقائد';
  end if;

  if exists (select 1 from leader_applications where course_id = p_course_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'لديك طلب قيادة قيد المراجعة بالفعل لهذا الكورس';
  end if;

  insert into leader_applications(course_id, user_id, squad_id, message, experience)
  values (p_course_id, auth.uid(), p_squad_id, p_message, p_experience)
  returning * into v_row;

  -- إشعار أدمن الكورس فور التقديم
  insert into notifications(profile_id, title, body, related_type, related_id)
  select ca.profile_id, 'طلب قيادة جديد', 'يوجد طلب قيادة جديد لهذا الكورس بانتظار المراجعة', 'leader_application', v_row.id
  from course_admins ca where ca.course_id = p_course_id;

  perform log_activity(p_course_id, auth.uid(), 'leader application submitted');
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 2) مراجعة تسليم واجب: RPC محمي بدل كتابة مباشرة من العميل
--    (يمنع أي احتمال لتلاعب الطالب بدرجته، ويرسل إشعارًا تلقائيًا)
-- ------------------------------------------------------------
create or replace function review_submission(p_submission_id uuid, p_grade numeric, p_notes text)
returns submissions
language plpgsql security definer set search_path = public as $$
declare
  v_row submissions;
  v_course_id uuid;
begin
  select a.course_id into v_course_id from submissions s join assignments a on a.id = s.assignment_id where s.id = p_submission_id;
  if v_course_id is null then
    raise exception 'التسليم غير موجود';
  end if;
  if not (is_course_admin(auth.uid(), v_course_id) or is_leader_in_course(auth.uid(), v_course_id)) then
    raise exception 'لا تملك صلاحية مراجعة هذا التسليم';
  end if;

  update submissions
  set grade = p_grade, reviewer_notes = p_notes, status = 'reviewed', reviewed_at = now()
  where id = p_submission_id
  returning * into v_row;

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (v_row.profile_id, 'تمت مراجعة تسليمك',
          case when p_grade is not null then 'الدرجة: ' || p_grade::text else 'تمت مراجعة تسليمك' end,
          'submission', v_row.id);

  perform log_activity(v_course_id, auth.uid(), 'submission reviewed');
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 3) نشر إعلان: RPC محمي (بدل insert مباشر) لأنه يحتاج يفنّش
--    إشعارات لكل الطلاب المسجلين، والعميل ما يقدر يكتب بجدول
--    notifications مباشرة (RLS تمنعه أصلًا لغير الـRPC).
-- ------------------------------------------------------------
create or replace function create_announcement(p_course_id uuid, p_title text, p_content text)
returns announcements
language plpgsql security definer set search_path = public as $$
declare
  v_row announcements;
begin
  if not is_course_admin(auth.uid(), p_course_id) then
    raise exception 'لا تملك صلاحية نشر إعلان لهذا الكورس';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'العنوان إلزامي';
  end if;

  insert into announcements(course_id, title, content, type, created_by)
  values (p_course_id, p_title, p_content, 'general', auth.uid())
  returning * into v_row;

  insert into notifications(profile_id, title, body, related_type, related_id)
  select e.profile_id, 'إعلان جديد', p_title, 'announcement', v_row.id
  from enrollments e where e.course_id = p_course_id;

  perform log_activity(p_course_id, auth.uid(), 'announcement published');
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 4) حماية تسليمات الطلاب من تعديل حقول المراجعة على أنفسهم
--    (RLS الأصلية تسمح للطالب يعدّل صف تسليمه، لكن كصفوف كاملة —
--    بدون تقييد أعمدة. من دون هذا الـtrigger، طالب يقدر تقنيًا
--    يستدعي update/insert مباشر من supabase-js ويحط لنفسه درجة
--    أو يعلّم تسليمه reviewed بنفسه.)
-- ------------------------------------------------------------
create or replace function prevent_self_review_tampering()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_is_privileged boolean;
  v_old_grade numeric;
  v_old_notes text;
  v_old_reviewed_at timestamptz;
begin
  select a.course_id into v_course_id from assignments a where a.id = new.assignment_id;
  v_is_privileged := is_course_admin(auth.uid(), v_course_id) or is_leader_in_course(auth.uid(), v_course_id);

  if v_is_privileged or new.profile_id <> auth.uid() then
    return new; -- الأدمن/القائد يراجعون بحرية عبر review_submission
  end if;

  if TG_OP = 'INSERT' then
    v_old_grade := null; v_old_notes := null; v_old_reviewed_at := null;
  else
    v_old_grade := old.grade; v_old_notes := old.reviewer_notes; v_old_reviewed_at := old.reviewed_at;
  end if;

  if new.grade is distinct from v_old_grade
     or new.reviewer_notes is distinct from v_old_notes
     or new.reviewed_at is distinct from v_old_reviewed_at
     or new.status = 'reviewed' then
    raise exception 'لا يمكنك تعديل حقول المراجعة (الدرجة/الحالة/الملاحظات) لتسليمك — هذا للمراجع فقط';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_self_review_tampering on submissions;
create trigger trg_prevent_self_review_tampering
  before insert or update on submissions
  for each row execute procedure prevent_self_review_tampering();

-- ------------------------------------------------------------
-- 5) إصلاح: سوبر أدمن ما كان يقدر يعدّل is_super_admin لمستخدم
--    آخر عبر لوحة الإدارة — RLS الأصلية لجدول profiles تسمح فقط
--    بتعديل صفّك أنت (id = auth.uid()), فكانت عملية "ترقية مستخدم"
--    من admin/js/people.js تفشل بصمت (0 rows updated) لأي حساب
--    غير حساب السوبر أدمن نفسه. هذا يضيف صلاحية صريحة لذلك، مع
--    بقاء trigger منع التصعيد الذاتي (من fix_patch الأول) فعّالًا.
-- ------------------------------------------------------------
drop policy if exists "profiles: سوبر أدمن يعدّل أي حساب" on profiles;
create policy "profiles: سوبر أدمن يعدّل أي حساب" on profiles
  for update using (is_super_admin(auth.uid()));

-- ============================================================
-- تمّ.
-- ============================================================

-- ================================================================
-- PART 5/6 — Fix Patch 4: Gamification (XP/Streak/Progress/Late)
-- ================================================================

-- ============================================================
-- CodeUp — FIX PATCH #4 — XP / Streak / Progress + حالة "متأخر"
-- ============================================================
-- يعالج مشكلتين حقيقيتين موجودتين بالواجهة لكن بدون أي تنفيذ
-- فعلي بقاعدة البيانات:
--
-- 1) أعمدة enrollments.xp / progress / streak / completed_count
--    تُقرأ بكل مكان (لوحة التقدم، المتصدرون، لوحة الأدمن) لكن
--    ما فيه ولا trigger يحدّثها عند تسليم واجب أو مراجعته، فتبقى
--    عالقيمة الافتراضية للأبد.
--
-- 2) حالة "متأخر" (late) بجدول submissions موجودة بالـ enum
--    وبفلتر الأدمن، لكن الكود بـ index.html يكتب دايمًا
--    status:'submitted' بغض النظر عن الموعد النهائي، فما توجد
--    ولا حالة "late" فعليًا.
--
-- آمن للتشغيل فوق أي حالة حالية. شغّله بعد fix_patch_1/2/3.
-- ============================================================

-- ---------- عمود مساعد لحساب الـ streak (آخر يوم فيه نشاط تسليم) ----------
alter table enrollments add column if not exists last_activity_date date;

-- ------------------------------------------------------------
-- 1) قبل إدراج/تعديل submission: تحديد status تلقائيًا
--    (submitted/late) حسب مقارنة submitted_at بموعد الواجب.
--    ما يلمس الحالات الثانية (missing تُحسب بالعميل من غياب صف،
--    reviewed تُحدّد فقط عبر review_submission RPC).
-- ------------------------------------------------------------
create or replace function set_submission_late_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deadline date;
begin
  if new.status = 'submitted' then
    select deadline into v_deadline from assignments where id = new.assignment_id;
    if v_deadline is not null and new.submitted_at is not null
       and new.submitted_at::date > v_deadline then
      new.status := 'late';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_submission_late_status on submissions;
create trigger trg_set_submission_late_status
  before insert or update on submissions
  for each row execute procedure set_submission_late_status();

-- ------------------------------------------------------------
-- 2) بعد إدراج/تحديث submission: إعادة حساب XP/التقدم/الـ streak
--    لصاحب التسليم بذلك الكورس. يُعاد الحساب من الصفر في كل
--    مرة (بدل increment) لتفادي أي تكرار عد أو تعارض سباق.
-- ------------------------------------------------------------
create or replace function recalc_enrollment_gamification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_total_assignments int;
  v_completed int;
  v_bonus_xp numeric;
  v_progress int;
  v_last_date date;
  v_streak int;
  v_today date := current_date;
begin
  select a.course_id into v_course_id from assignments a where a.id = new.assignment_id;
  if v_course_id is null then return new; end if;

  select count(*) into v_total_assignments from assignments where course_id = v_course_id;

  select count(distinct s.assignment_id) into v_completed
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = new.profile_id and a.course_id = v_course_id
    and s.status in ('submitted','late','reviewed');

  select coalesce(sum(s.grade),0) into v_bonus_xp
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = new.profile_id and a.course_id = v_course_id and s.status = 'reviewed';

  v_progress := case when v_total_assignments > 0
    then round((v_completed::numeric / v_total_assignments) * 100) else 0 end;

  select last_activity_date into v_last_date
  from enrollments where profile_id = new.profile_id and course_id = v_course_id;

  select streak into v_streak
  from enrollments where profile_id = new.profile_id and course_id = v_course_id;
  v_streak := coalesce(v_streak, 0);

  if TG_OP = 'INSERT' then
    if v_last_date is null or v_last_date < v_today - 1 then
      v_streak := 1;
    elsif v_last_date = v_today - 1 then
      v_streak := v_streak + 1;
    end if; -- v_last_date = v_today: بدون تغيير (نفس اليوم)
    v_last_date := v_today;
  end if;

  update enrollments
  set xp = (v_completed * 10) + v_bonus_xp,
      progress = v_progress,
      completed_count = v_completed,
      streak = v_streak,
      last_activity_date = v_last_date,
      status = case
        when v_progress >= 70 then 'on_track'
        when v_progress >= 30 then 'at_risk'
        else 'behind'
      end
  where profile_id = new.profile_id and course_id = v_course_id;

  return new;
end;
$$;

drop trigger if exists trg_recalc_gamification_ins on submissions;
create trigger trg_recalc_gamification_ins
  after insert on submissions
  for each row execute procedure recalc_enrollment_gamification();

drop trigger if exists trg_recalc_gamification_upd on submissions;
create trigger trg_recalc_gamification_upd
  after update of status, grade on submissions
  for each row execute procedure recalc_enrollment_gamification();

-- ------------------------------------------------------------
-- 3) Backfill: احسب القيم الصحيحة لكل enrollment موجود حاليًا
--    (بدل ما تضل 0 لحد أول تسليم جديد). دالة مساعدة أولًا،
--    ثم تُشغَّل مرة وحدة على كل enrollment موجود.
-- ------------------------------------------------------------
create or replace function recalc_enrollment_gamification_backfill(p_profile_id uuid, p_course_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total_assignments int;
  v_completed int;
  v_bonus_xp numeric;
  v_progress int;
begin
  select count(*) into v_total_assignments from assignments where course_id = p_course_id;

  select count(distinct s.assignment_id) into v_completed
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = p_profile_id and a.course_id = p_course_id
    and s.status in ('submitted','late','reviewed');

  select coalesce(sum(s.grade),0) into v_bonus_xp
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = p_profile_id and a.course_id = p_course_id and s.status = 'reviewed';

  v_progress := case when v_total_assignments > 0
    then round((v_completed::numeric / v_total_assignments) * 100) else 0 end;

  update enrollments
  set xp = (v_completed * 10) + v_bonus_xp,
      progress = v_progress,
      completed_count = v_completed,
      status = case
        when v_progress >= 70 then 'on_track'
        when v_progress >= 30 then 'at_risk'
        else 'behind'
      end
  where profile_id = p_profile_id and course_id = p_course_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in select distinct profile_id, course_id from enrollments loop
    perform recalc_enrollment_gamification_backfill(r.profile_id, r.course_id);
  end loop;
end $$;

-- ============================================================
-- تمّ. من الآن: كل تسليم جديد يحدّث XP/التقدم/الحالة فورًا،
-- وأي تسليم بعد الموعد النهائي يُعلَّم "متأخر" تلقائيًا.
-- ملاحظة: streak محسوب فقط للأمام (من تاريخ تشغيل هذا الملف)،
-- لأن معرفة الأيام المتتالية الفعلية تاريخيًا تحتاج بيانات لا
-- نملكها بدقة (تاريخ كل submitted_at بالتقويم اليومي الفعلي).
-- ============================================================

-- ================================================================
-- PART 6/6 — Fix Patch 5: Submissions INSERT/UPDATE RLS
-- ================================================================

-- ============================================================
-- Patch 5: إصلاح خطأ "new row violates row-level security policy
--          for table submissions" عند تسليم الطالب لواجب.
--
-- السبب: في 2026_codeup_platform_migration.sql تم حذف السياسة
-- القديمة "submissions: الطالب صاحب التسليم أو أدمن/قائد الكورس"
-- (التي كانت على الأرجح FOR ALL وتغطي select/insert/update)
-- واستبدالها بسياسة SELECT فقط (قراءة لمن يملك صلاحية العرض عبر
-- can_view_submission). لم يتم إضافة سياسة INSERT/UPDATE بديلة،
-- ونتيجة لذلك RLS يرفض أي إدراج افتراضيًا — حتى تسليم الطالب
-- لواجبه الخاص. هذا الباتش يعيد صلاحية الإدراج/التعديل لصاحب
-- التسليم فقط (بشرط أنه مسجّل في كورس الواجب)، مع بقاء حماية
-- حقول المراجعة (grade/status/reviewer_notes) عبر trigger
-- prevent_self_review_tampering الموجود مسبقًا في patch_2.
-- ============================================================

-- INSERT: الطالب يقدر يُنشئ تسليمًا لنفسه فقط، ولواجب في كورس هو مسجّل فيه
drop policy if exists "submissions: الطالب يُنشئ تسليمه الخاص" on submissions;
create policy "submissions: الطالب يُنشئ تسليمه الخاص" on submissions
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from assignments a
      where a.id = assignment_id
        and is_enrolled(auth.uid(), a.course_id)
    )
  );

-- UPDATE: صاحب التسليم يقدر يعدّل تسليمه (المحتوى/الملف/المشاركة)
-- ملاحظة: trigger prevent_self_review_tampering (patch_2) يمنعه من
-- تعديل grade/status/reviewer_notes/reviewed_at بنفسه، لذا لا حاجة
-- لتكرار ذلك المنطق هنا.
drop policy if exists "submissions: صاحب التسليم يعدّل تسليمه" on submissions;
create policy "submissions: صاحب التسليم يعدّل تسليمه" on submissions
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ============================================================
-- تمّ. طبّق هذا الملف في Supabase SQL Editor بعد الباتشات السابقة.
-- ============================================================


-- ================================================================
-- تمّ الدمج. بعد تشغيل هذا الملف كاملًا على مشروع جديد فاضي:
--
-- 1) اذهب لصفحة تسجيل الدخول في الموقع وأنشئ أول حساب لك.
-- 2) ارجع لـ SQL Editor وشغّل السطر التالي (بعد استبدال بريدك):
--
--    update profiles set is_super_admin = true
--    where email = 'your-email@example.com';
--
-- 3) حدّث بيانات الاتصال (SUPABASE_URL / SUPABASE_ANON_KEY) في
--    js/supabase.js لتشير للمشروع الجديد.
-- ================================================================
