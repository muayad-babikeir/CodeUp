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
