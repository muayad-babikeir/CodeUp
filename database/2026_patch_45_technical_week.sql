-- 2026_patch_44_technical_week.sql
--
-- الأسبوع التقني — نظام مستقل بالكامل عن الكورسات والجامعة (بند 8-9 بمقترح
-- التعاون الجامعي). يُبنى الآن بالاعتماد على خطة الطلاب الحالية، بدون انتظار
-- رد الجامعة الرسمي على التفاصيل الإدارية — عشان كذا الصلاحيات هنا مصمَّمة
-- "مرنة" عمدًا (طبقة واحدة بسيطة: tech_week_admins يملك كل الصلاحيات على كل
-- المحتوى)، بدل تفصيل صلاحيات دقيقة (مثلًا: أدمن يدير الورش بس) قد تحتاج
-- تعديل لاحقًا حسب رد الجامعة. تضييق الصلاحيات مستقبلًا لا يحتاج كسر أي شي —
-- فقط تعديل الدالة is_tech_week_admin أو إضافة عمود صلاحيات على الجدول.
--
-- لا علاقة لهذا الباتش بجداول courses/universities/enrollments إطلاقًا.

-- ============================================================
-- 1) أدمن الأسبوع التقني — طبقة صلاحية واحدة بسيطة (owner/admin)، بدون
--    تخصيص لكل فعالية على حدة الآن (يمكن إضافته لاحقًا بدون كسر شيء)
-- ============================================================
create table if not exists tech_week_admins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner','admin')),
  created_at timestamptz not null default now()
);

alter table tech_week_admins enable row level security;

drop policy if exists "tech_week_admins: قراءة لسوبر أدمن ولنفس الشخص" on tech_week_admins;
create policy "tech_week_admins: قراءة لسوبر أدمن ولنفس الشخص" on tech_week_admins
  for select using (is_super_admin(auth.uid()) or profile_id = auth.uid());

drop policy if exists "tech_week_admins: سوبر أدمن يدير" on tech_week_admins;
create policy "tech_week_admins: سوبر أدمن يدير" on tech_week_admins
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

create or replace function is_tech_week_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_super_admin(uid) or exists (select 1 from tech_week_admins t where t.profile_id = uid);
$$;

-- ============================================================
-- 2) الفعاليات — جدول واحد موحّد لكل الأنواع (ورشة/دورة/مسابقة/جلسة نقاشية)
--    بدل 4 جداول منفصلة، لأنها كلها تشترك بنفس البيانات الأساسية عمليًا
-- ============================================================
create table if not exists tech_week_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('workshop','course','competition','talk')),
  title text not null,
  description text,
  speaker text,               -- اسم المتحدث/المدرّب (اختياري)
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity int,                -- فارغ = بدون حد أقصى للتسجيل
  registration_open boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table tech_week_events enable row level security;

drop policy if exists "tech_week_events: قراءة العام للمنشور، والكل للأدمن" on tech_week_events;
create policy "tech_week_events: قراءة العام للمنشور، والكل للأدمن" on tech_week_events
  for select using (status = 'published' or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_events: أدمن الأسبوع التقني يدير" on tech_week_events;
create policy "tech_week_events: أدمن الأسبوع التقني يدير" on tech_week_events
  for all using (is_tech_week_admin(auth.uid())) with check (is_tech_week_admin(auth.uid()));

create index if not exists idx_tech_week_events_status on tech_week_events(status);

-- ============================================================
-- 3) التسجيل بالفعاليات
-- ============================================================
create table if not exists tech_week_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references tech_week_events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered','cancelled','attended')),
  created_at timestamptz not null default now(),
  unique (event_id, profile_id)
);

alter table tech_week_registrations enable row level security;

drop policy if exists "tech_week_registrations: قراءة لنفس المستخدم أو الأدمن" on tech_week_registrations;
create policy "tech_week_registrations: قراءة لنفس المستخدم أو الأدمن" on tech_week_registrations
  for select using (profile_id = auth.uid() or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_registrations: تسجيل ذاتي" on tech_week_registrations;
create policy "tech_week_registrations: تسجيل ذاتي" on tech_week_registrations
  for insert with check (
    profile_id = auth.uid()
    and exists (select 1 from tech_week_events e where e.id = event_id and e.status = 'published' and e.registration_open)
  );

drop policy if exists "tech_week_registrations: إلغاء ذاتي أو من الأدمن" on tech_week_registrations;
create policy "tech_week_registrations: إلغاء ذاتي أو من الأدمن" on tech_week_registrations
  for update using (profile_id = auth.uid() or is_tech_week_admin(auth.uid()))
  with check (profile_id = auth.uid() or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_registrations: حذف من الأدمن فقط" on tech_week_registrations;
create policy "tech_week_registrations: حذف من الأدمن فقط" on tech_week_registrations
  for delete using (is_tech_week_admin(auth.uid()));

create index if not exists idx_tech_week_regs_event on tech_week_registrations(event_id);

-- ============================================================
-- 4) إعلانات الأسبوع التقني — جدول مستقل خفيف (مو مرتبط بجدول announcements
--    الحالي، لأن ذاك مرتبط ببنية RLS خاصة بالكورسات ولا داعي لتعقيده)
-- ============================================================
create table if not exists tech_week_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table tech_week_announcements enable row level security;

drop policy if exists "tech_week_announcements: قراءة لأي مستخدم مسجّل" on tech_week_announcements;
create policy "tech_week_announcements: قراءة لأي مستخدم مسجّل" on tech_week_announcements
  for select using (auth.uid() is not null);

drop policy if exists "tech_week_announcements: أدمن الأسبوع التقني يدير" on tech_week_announcements;
create policy "tech_week_announcements: أدمن الأسبوع التقني يدير" on tech_week_announcements
  for all using (is_tech_week_admin(auth.uid())) with check (is_tech_week_admin(auth.uid()));

-- ملاحظة مستقبلية: عمود "النتائج" (بند "النتائج مستقبلًا" بالمقترح) لم يُضَف
-- هنا عمدًا — لا بيانات حقيقية له بعد، ويُضاف لاحقًا بباتش منفصل وقت الحاجة الفعلية.
