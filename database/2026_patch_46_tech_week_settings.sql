-- 2026_patch_46_tech_week_settings.sql
-- إعدادات عامة للأسبوع التقني كفعالية (مو صفحة) — صف واحد ثابت (singleton)
-- عمود extra (jsonb) يسمح بإضافة إعدادات مستقبلية بدون migration جديد كل مرة.
create table if not exists tech_week_settings (
  id boolean primary key default true,
  is_enabled boolean not null default false,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  extra jsonb not null default '{}'::jsonb,
  updated_by uuid references profiles(id),
  updated_at timestamptz,
  constraint tech_week_settings_singleton check (id)
);

insert into tech_week_settings (id) values (true) on conflict (id) do nothing;

alter table tech_week_settings enable row level security;

drop policy if exists "tech_week_settings: قراءة عامة للمفعّل، والكل للأدمن" on tech_week_settings;
create policy "tech_week_settings: قراءة عامة للمفعّل، والكل للأدمن" on tech_week_settings
  for select using (is_enabled = true or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_settings: أدمن الأسبوع التقني يعدّل" on tech_week_settings;
create policy "tech_week_settings: أدمن الأسبوع التقني يعدّل" on tech_week_settings
  for all using (is_tech_week_admin(auth.uid())) with check (is_tech_week_admin(auth.uid()));

-- عمود يوثّق هل الإعلان انتشر أيضًا بتبويب الرئيسية العام للمنصة (جدول announcements
-- بـ course_id فاضي) — النشر هناك يتطلب صلاحية سوبر أدمن (نفس شرط create_announcement
-- الحالي)، هذا العمود بس للعرض/التوثيق بلوحة الإدارة.
alter table tech_week_announcements
  add column if not exists posted_to_home boolean not null default false;

-- ============================================================
-- الفرق الطلابية بالأسبوع التقني (للمسابقات) — نمط تسجيل لكل فعالية:
-- individual (الوضع الافتراضي، فرد لكل تسجيل) أو team (فريق يسجّل له عدة أعضاء).
-- ============================================================
alter table tech_week_events
  add column if not exists registration_mode text not null default 'individual'
    check (registration_mode in ('individual','team')),
  add column if not exists team_min_size int,
  add column if not exists team_max_size int;

create table if not exists tech_week_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references tech_week_events(id) on delete cascade,
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique(event_id, name)
);

alter table tech_week_registrations
  add column if not exists team_id uuid references tech_week_teams(id) on delete cascade;

alter table tech_week_teams enable row level security;

drop policy if exists "tech_week_teams: قراءة عامة للمسجلين" on tech_week_teams;
create policy "tech_week_teams: قراءة عامة للمسجلين" on tech_week_teams
  for select using (auth.uid() is not null);

drop policy if exists "tech_week_teams: الطالب ينشئ فريقه" on tech_week_teams;
create policy "tech_week_teams: الطالب ينشئ فريقه" on tech_week_teams
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from tech_week_events e
      where e.id = event_id and e.status = 'published' and e.registration_open and e.registration_mode = 'team'
    )
  );

drop policy if exists "tech_week_teams: تعديل من المنشئ أو الأدمن" on tech_week_teams;
create policy "tech_week_teams: تعديل من المنشئ أو الأدمن" on tech_week_teams
  for update using (created_by = auth.uid() or is_tech_week_admin(auth.uid()))
  with check (created_by = auth.uid() or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_teams: حذف من المنشئ أو الأدمن" on tech_week_teams;
create policy "tech_week_teams: حذف من المنشئ أو الأدمن" on tech_week_teams
  for delete using (created_by = auth.uid() or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_registrations: تسجيل ذاتي" on tech_week_registrations;
create policy "tech_week_registrations: تسجيل ذاتي" on tech_week_registrations
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from tech_week_events e
      where e.id = tech_week_registrations.event_id
        and e.status = 'published'
        and e.registration_open
        and (
          (e.registration_mode = 'individual' and tech_week_registrations.team_id is null)
          or (
            e.registration_mode = 'team'
            and tech_week_registrations.team_id is not null
            and exists (select 1 from tech_week_teams t where t.id = tech_week_registrations.team_id and t.event_id = e.id)
            and (
              e.team_max_size is null
              or (select count(*) from tech_week_registrations r2 where r2.team_id = tech_week_registrations.team_id and r2.status <> 'cancelled') < e.team_max_size
            )
          )
        )
    )
  );

-- الطلاب يحتاجون يشوفون أعضاء فرق الفعاليات (حتى فرق غيرهم) عشان يقدروا يتصفحوا وينضموا،
-- بينما التسجيل الفردي يضل خاص لصاحبه فقط + الأدمن.
drop policy if exists "tech_week_registrations: قراءة لنفس المستخدم " on tech_week_registrations;
create policy "tech_week_registrations: قراءة لنفس المستخدم أو فرق عامة" on tech_week_registrations
  for select using (
    profile_id = auth.uid()
    or is_tech_week_admin(auth.uid())
    or exists (
      select 1 from tech_week_events e
      where e.id = tech_week_registrations.event_id and e.registration_mode = 'team'
    )
  );
