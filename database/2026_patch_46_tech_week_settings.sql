-- 2026_patch_46_tech_week_settings.sql
-- الأسبوع التقني: إعدادات عامة للفعالية + الفرق الطلابية (قيادة/موافقة انضمام) + نشر
-- الإعلانات بالرئيسية العامة. نسخة نهائية موحّدة (بدل تراكم عدة تعديلات)، آمنة لإعادة
-- التشغيل من الصفر على أي قاعدة بيانات فيها جداول الأسبوع التقني الأساسية (patch_45).
--
-- ملاحظة مهمة: أسماء كل السياسات هنا قصيرة عمدًا (تحت 63 بايت) — بوستجرس يقصّ أي اسم
-- سياسة أطول من هذا الحد بصمت، فيسبب فشل "already exists" عند إعادة تشغيل نفس الملف
-- لاحقًا لأن أمر الحذف ما يطابق الاسم المقصوص فعليًا بقاعدة البيانات.

-- ============================================================
-- 1) إعدادات عامة للأسبوع التقني كفعالية (مو صفحة) — صف واحد ثابت (singleton)
-- ============================================================
create table if not exists tech_week_settings (
  id boolean primary key default true,
  is_enabled boolean not null default false,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  extra jsonb not null default '{}'::jsonb, -- إعدادات مستقبلية بدون migration جديد كل مرة
  updated_by uuid references profiles(id),
  updated_at timestamptz,
  constraint tech_week_settings_singleton check (id)
);
insert into tech_week_settings (id) values (true) on conflict (id) do nothing;

alter table tech_week_settings enable row level security;

drop policy if exists "tech_week_settings: قراءة" on tech_week_settings;
create policy "tech_week_settings: قراءة" on tech_week_settings
  for select using (is_enabled = true or is_tech_week_admin(auth.uid()));

drop policy if exists "tech_week_settings: تعديل" on tech_week_settings;
create policy "tech_week_settings: تعديل" on tech_week_settings
  for all using (is_tech_week_admin(auth.uid())) with check (is_tech_week_admin(auth.uid()));

-- ============================================================
-- 2) نشر إعلان الأسبوع التقني بتبويب الرئيسية العام (اختياري لكل إعلان، سوبر أدمن فقط)
-- ============================================================
alter table tech_week_announcements
  add column if not exists posted_to_home boolean not null default false;

-- ============================================================
-- 3) الفرق الطلابية — نمط تسجيل لكل فعالية: individual (فرد) أو team (فريق)
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
  leader_id uuid references profiles(id), -- قابل للتغيير (تسليم قيادة)، يبدأ = created_by
  join_policy text not null default 'open' check (join_policy in ('open','approval')),
  created_at timestamptz not null default now(),
  unique(event_id, name)
);

alter table tech_week_registrations
  add column if not exists team_id uuid references tech_week_teams(id) on delete cascade;

-- حالة "pending": طلب انضمام لفريق بموافقة، بانتظار قرار القائد
alter table tech_week_registrations drop constraint if exists tech_week_registrations_status_check;
alter table tech_week_registrations add constraint tech_week_registrations_status_check
  check (status = ANY (ARRAY['registered'::text,'cancelled'::text,'attended'::text,'pending'::text]));

-- دالة SECURITY DEFINER لعدّ الأعضاء الفعّالين بفريق، تتجاوز RLS عمدًا: تُستخدم داخل سياسة
-- INSERT على نفس جدول tech_week_registrations، واستعلام مباشر هناك يسبب
-- "infinite recursion detected in policy" لأن بوستجرس يطبّق RLS على الاستعلام الداخلي أيضًا.
create or replace function tech_week_team_active_count(p_team_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::int from tech_week_registrations where team_id = p_team_id and status <> 'cancelled';
$$;

alter table tech_week_teams enable row level security;

drop policy if exists "tech_week_teams: قراءة" on tech_week_teams;
create policy "tech_week_teams: قراءة" on tech_week_teams
  for select using (auth.uid() is not null);

drop policy if exists "tech_week_teams: إنشاء" on tech_week_teams;
create policy "tech_week_teams: إنشاء" on tech_week_teams
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from tech_week_events e
      where e.id = event_id and e.status = 'published' and e.registration_open and e.registration_mode = 'team'
    )
  );

-- تسليم القيادة وتغيير نمط الانضمام: القائد الحالي أو الأدمن فقط.
-- USING يتحقق إن المُعدِّل هو القائد الحالي (أو أدمن) على الصف القديم.
-- WITH CHECK يتحقق بس إن "القائد الجديد" المقترح بالصف الجديد عضو فعّال بنفس الفريق فعلًا
-- (تسليم قيادة، مو تعيين شخص غريب) — لاحظ إنه ما يشترط leader_id = auth.uid() بالصف الجديد،
-- لأن هذا بالضبط يمنع عملية التسليم (القائد الجديد شخص غير المُعدِّل نفسه).
drop policy if exists "tech_week_teams: تعديل" on tech_week_teams;
create policy "tech_week_teams: تعديل" on tech_week_teams
  for update using (leader_id = auth.uid() or is_tech_week_admin(auth.uid()))
  with check (
    is_tech_week_admin(auth.uid())
    or exists (
      select 1 from tech_week_registrations r
      where r.team_id = tech_week_teams.id and r.profile_id = tech_week_teams.leader_id and r.status <> 'cancelled'
    )
  );

drop policy if exists "tech_week_teams: حذف" on tech_week_teams;
create policy "tech_week_teams: حذف" on tech_week_teams
  for delete using (created_by = auth.uid() or is_tech_week_admin(auth.uid()));

-- تسجيل ذاتي: يفرّق بين انضمام مباشر (registered) وطلب معلّق (pending) حسب نمط الفريق
-- (open/approval)، ويستخدم tech_week_team_active_count() بدل استعلام مباشر على نفس الجدول.
drop policy if exists "tech_week_registrations: تسجيل" on tech_week_registrations;
create policy "tech_week_registrations: تسجيل" on tech_week_registrations
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from tech_week_events e
      where e.id = tech_week_registrations.event_id
        and e.status = 'published'
        and e.registration_open
        and (
          (e.registration_mode = 'individual' and tech_week_registrations.team_id is null and tech_week_registrations.status = 'registered')
          or (
            e.registration_mode = 'team'
            and tech_week_registrations.team_id is not null
            and exists (
              select 1 from tech_week_teams t
              where t.id = tech_week_registrations.team_id and t.event_id = e.id
              and (
                (tech_week_registrations.status = 'registered' and (t.join_policy = 'open' or t.leader_id = auth.uid()))
                or (tech_week_registrations.status = 'pending' and t.join_policy = 'approval' and t.leader_id <> auth.uid())
              )
            )
            and (e.team_max_size is null or tech_week_team_active_count(tech_week_registrations.team_id) < e.team_max_size)
          )
        )
    )
  );

-- قراءة: صاحب التسجيل نفسه أو الأدمن دائمًا، وأيضًا أي مستخدم مسجّل دخول لتسجيلات فعاليات
-- "الفرق" تحديدًا (عشان يتصفح الفرق الموجودة وأعضاءها قبل ينضم) — التسجيل الفردي يبقى خاص.
drop policy if exists "tech_week_registrations: قراءة" on tech_week_registrations;
create policy "tech_week_registrations: قراءة" on tech_week_registrations
  for select using (
    profile_id = auth.uid()
    or is_tech_week_admin(auth.uid())
    or exists (
      select 1 from tech_week_events e
      where e.id = tech_week_registrations.event_id and e.registration_mode = 'team'
    )
  );

-- تعديل: صاحب التسجيل (إلغاء بنفسه)، أو قائد الفريق (قبول/رفض طلبات أعضائه)، أو الأدمن.
drop policy if exists "tech_week_registrations: تعديل" on tech_week_registrations;
create policy "tech_week_registrations: تعديل" on tech_week_registrations
  for update using (
    profile_id = auth.uid()
    or is_tech_week_admin(auth.uid())
    or exists (select 1 from tech_week_teams t where t.id = tech_week_registrations.team_id and t.leader_id = auth.uid())
  )
  with check (
    profile_id = auth.uid()
    or is_tech_week_admin(auth.uid())
    or exists (select 1 from tech_week_teams t where t.id = tech_week_registrations.team_id and t.leader_id = auth.uid())
  );

drop policy if exists "tech_week_registrations: حذف" on tech_week_registrations;
create policy "tech_week_registrations: حذف" on tech_week_registrations
  for delete using (is_tech_week_admin(auth.uid()));

update tech_week_teams set leader_id = created_by where leader_id is null;

-- وصف مختصر اختياري للفريق (يظهر ببطاقة الفريق بواجهة الطالب)
alter table tech_week_teams add column if not exists description text;

-- القائد الحالي (مو بس منشئ الفريق الأصلي، ممكن يكون تغيّر بتسليم قيادة) يقدر يحذف الفريق نهائيًا
drop policy if exists "tech_week_teams: حذف" on tech_week_teams;
create policy "tech_week_teams: حذف" on tech_week_teams
  for delete using (
    leader_id = auth.uid() or created_by = auth.uid() or is_tech_week_admin(auth.uid())
  );
