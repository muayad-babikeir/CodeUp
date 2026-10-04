-- (طُبّق مسبقًا على القاعدة الحية عبر Supabase MCP بتاريخ 2026-10-04 — للأرشفة؛ إعادة التشغيل آمنة)
-- Patch #61 — بنية University الديناميكية:
--   الجامعة → البرنامج (university_programs) → السنة (university_years) → السمستر (2 تلقائيًا لكل سنة)
--   → المادة → المصادر.  مجموعة تيليجرام لكل سنة (archive_destinations.year_id)،
--   وموضوع Forum تلقائي لكل مادة داخل مجموعة سنتها (archive_topics.subject_id).
-- كل شيء إضافي: الجداول والأعمدة الحالية تبقى، و university_semesters.university_id يبقى كما هو (تعتمد عليه الصلاحيات).

-- 1) البرامج
create table if not exists public.university_programs (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null,
  slug text,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists university_programs_univ_idx on public.university_programs(university_id, order_index);

-- 2) السنوات
create table if not exists public.university_years (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.university_programs(id) on delete cascade,
  year_number int not null check (year_number >= 1),
  title text,
  created_at timestamptz not null default now(),
  unique (program_id, year_number)
);

-- 3) السمسترات تُربط بسنة (النظام ثابت: سمستران لكل سنة، رقمهما تراكمي: سنة 1 → 1،2 / سنة 2 → 3،4 …)
alter table public.university_semesters add column if not exists year_id uuid references public.university_years(id) on delete cascade;
alter table public.university_semesters add column if not exists semester_number int;
create unique index if not exists university_semesters_year_num_key on public.university_semesters(year_id, semester_number) where year_id is not null;

create or replace function public.trg_year_create_semesters()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.university_semesters (university_id, year_id, semester_number, title, order_index)
  select p.university_id, new.id, n, 'Semester ' || n, n
  from public.university_programs p,
       unnest(array[(new.year_number - 1) * 2 + 1, (new.year_number - 1) * 2 + 2]) as n
  where p.id = new.program_id;
  return new;
end $$;
revoke execute on function public.trg_year_create_semesters() from public, anon, authenticated;
drop trigger if exists university_years_create_semesters on public.university_years;
create trigger university_years_create_semesters after insert on public.university_years
  for each row execute function public.trg_year_create_semesters();

-- حذف السمسترات التجريبية القديمة الفارغة (بلا سنة ولا مواد) بطلب المالك
delete from public.university_semesters s
 where s.year_id is null and not exists (select 1 from public.university_subjects x where x.semester_id = s.id);

-- 4) الصلاحيات: قراءة لأي مستخدم مسجّل، والإدارة لأدمن الجامعة (يشمل السوبر أدمن عبر is_university_admin)
alter table public.university_programs enable row level security;
alter table public.university_years enable row level security;
drop policy if exists "university_programs: قراءة لأي مستخدم مسجّل" on public.university_programs;
create policy "university_programs: قراءة لأي مستخدم مسجّل" on public.university_programs for select using (auth.uid() is not null);
drop policy if exists "university_programs: أدمن الجامعة يدير" on public.university_programs;
create policy "university_programs: أدمن الجامعة يدير" on public.university_programs for all
  using (public.is_university_admin(auth.uid(), university_id)) with check (public.is_university_admin(auth.uid(), university_id));
drop policy if exists "university_years: قراءة لأي مستخدم مسجّل" on public.university_years;
create policy "university_years: قراءة لأي مستخدم مسجّل" on public.university_years for select using (auth.uid() is not null);
drop policy if exists "university_years: أدمن الجامعة يدير" on public.university_years;
create policy "university_years: أدمن الجامعة يدير" on public.university_years for all
  using (exists (select 1 from public.university_programs p where p.id = program_id and public.is_university_admin(auth.uid(), p.university_id)))
  with check (exists (select 1 from public.university_programs p where p.id = program_id and public.is_university_admin(auth.uid(), p.university_id)));

-- 5) تيليجرام: مجموعة لكل سنة + كود تعريف (serial_code)، وموضوع لكل مادة
alter table public.archive_destinations add column if not exists year_id uuid references public.university_years(id) on delete set null;
alter table public.archive_destinations add column if not exists serial_code text;
create unique index if not exists archive_destinations_year_active_key on public.archive_destinations(year_id) where year_id is not null and is_active;
create unique index if not exists archive_destinations_serial_key on public.archive_destinations(lower(serial_code)) where serial_code is not null;

alter table public.archive_topics add column if not exists subject_id uuid references public.university_subjects(id) on delete cascade;
alter table public.archive_topics drop constraint if exists archive_topics_topic_key_check;
alter table public.archive_topics add constraint archive_topics_topic_key_check
  check (topic_key in ('index','submissions','projects','materials','community','store','university') or topic_key like 'subject:%');
create unique index if not exists archive_topics_subject_dest_key on public.archive_topics(destination_id, subject_id) where subject_id is not null;

-- 6) حذف مادة يحذف موضوعها من تيليجرام (عبر قائمة الانتظار نفسها؛ message_id فارغ + thread_id = حذف موضوع)
alter table public.telegram_message_cleanup alter column message_id drop not null;
alter table public.telegram_message_cleanup add column if not exists thread_id bigint;
alter table public.telegram_message_cleanup drop constraint if exists telegram_cleanup_target_check;
alter table public.telegram_message_cleanup add constraint telegram_cleanup_target_check check (message_id is not null or thread_id is not null);

create or replace function public.trg_subject_enqueue_topic_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.telegram_message_cleanup (chat_id, thread_id)
  select d.telegram_chat_id::bigint, t.telegram_thread_id
  from public.archive_topics t join public.archive_destinations d on d.id = t.destination_id
  where t.subject_id = old.id and d.telegram_chat_id ~ '^-?[0-9]+$';
  return old;
end $$;
revoke execute on function public.trg_subject_enqueue_topic_cleanup() from public, anon, authenticated;
drop trigger if exists university_subjects_topic_cleanup on public.university_subjects;
create trigger university_subjects_topic_cleanup before delete on public.university_subjects
  for each row execute function public.trg_subject_enqueue_topic_cleanup();
