-- (طُبّق مسبقًا على القاعدة الحية عبر Supabase MCP بتاريخ 2026-10-04 — للأرشفة؛ إعادة التشغيل آمنة)
-- Patch #63 — الاستيراد من مجموعة تيليجرام مصدر إلى أرشيف المادة (copyMessage من الخادم، بلا تنزيل/رفع).
-- عملية (job) لكل استيراد + عنصر (item) لكل رسالة. المؤشر (cursor_message_id) هو نقطة التوقف للاستكمال بدون تخطّي.
-- الكتابة عبر service role فقط (دالة telegram-import)؛ القراءة لأدمن الجامعة لعرض التقدّم.

create table if not exists public.telegram_import_jobs (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.university_subjects(id) on delete cascade,
  created_by uuid not null,
  source_chat_id bigint not null,
  source_title text,
  from_message_id bigint not null,
  to_message_id bigint not null,
  section text not null,
  role text not null default 'alternative' check (role in ('alternative','deep_dive','study')),
  language text check (language is null or language in ('ar','en','other')),
  publisher text,
  force_reimport boolean not null default false,
  status text not null default 'pending' check (status in ('pending','running','paused','done','cancelled')),
  cursor_message_id bigint not null,
  copied int not null default 0,
  skipped int not null default 0,
  last_error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_message_id >= from_message_id)
);
create index if not exists telegram_import_jobs_subject_idx on public.telegram_import_jobs(subject_id, status);
create index if not exists telegram_import_jobs_status_idx on public.telegram_import_jobs(status, created_at);

create table if not exists public.telegram_import_items (
  id bigserial primary key,
  job_id uuid not null references public.telegram_import_jobs(id) on delete cascade,
  subject_id uuid not null references public.university_subjects(id) on delete cascade,
  source_chat_id bigint not null,
  source_message_id bigint not null,
  status text not null check (status in ('copied','skipped')),
  reason text,
  dest_chat_id bigint,
  dest_thread_id bigint,
  dest_message_id bigint,
  url text,
  episode int,
  sort_order int,
  created_at timestamptz not null default now(),
  unique (job_id, source_message_id)
);
create index if not exists telegram_import_items_dedupe_idx on public.telegram_import_items(source_chat_id, source_message_id, subject_id) where status = 'copied';

alter table public.telegram_import_jobs enable row level security;
alter table public.telegram_import_items enable row level security;
drop policy if exists "import_jobs: أدمن الجامعة يقرأ" on public.telegram_import_jobs;
create policy "import_jobs: أدمن الجامعة يقرأ" on public.telegram_import_jobs for select using (
  exists (select 1 from public.university_subjects s join public.university_semesters sm on sm.id = s.semester_id
          where s.id = subject_id and public.is_university_admin(auth.uid(), sm.university_id))
);
drop policy if exists "import_items: أدمن الجامعة يقرأ" on public.telegram_import_items;
create policy "import_items: أدمن الجامعة يقرأ" on public.telegram_import_items for select using (
  exists (select 1 from public.university_subjects s join public.university_semesters sm on sm.id = s.semester_id
          where s.id = subject_id and public.is_university_admin(auth.uid(), sm.university_id))
);

-- حجز العملية ذريًا (عامل واحد فقط) + اختيار عملية للـ cron
create or replace function public.claim_import_job(p_job uuid, p_lock_seconds int default 150)
returns setof public.telegram_import_jobs language sql security definer set search_path = public as $$
  update public.telegram_import_jobs
     set status = 'running', locked_until = now() + make_interval(secs => p_lock_seconds), updated_at = now()
   where id = p_job and (status = 'pending' or (status = 'running' and (locked_until is null or locked_until < now())))
  returning *;
$$;
create or replace function public.pick_import_job()
returns uuid language sql security definer set search_path = public as $$
  select id from public.telegram_import_jobs
   where status = 'pending' or (status = 'running' and (locked_until is null or locked_until < now()))
   order by created_at limit 1;
$$;
revoke execute on function public.claim_import_job(uuid, int) from public, anon, authenticated;
revoke execute on function public.pick_import_job() from public, anon, authenticated;

-- كل دقيقة: يستكمل أي عملية معلّقة/منتهية القفل (شبكة أمان إن أُغلقت الصفحة)
do $$
declare s text;
begin
  select substring(command from $re$'x-cron-secret',\s*'([^']+)'$re$) into s from cron.job where jobname = 'codeup-archive-student-files-daily';
  if s is null then raise exception 'x-cron-secret not found in existing cron job'; end if;
  perform cron.unschedule('codeup-telegram-import') where exists (select 1 from cron.job where jobname = 'codeup-telegram-import');
  perform cron.schedule('codeup-telegram-import', '* * * * *', format($cmd$
    select net.http_post(url := 'https://hodjfdhapxnygrnzoggr.supabase.co/functions/v1/telegram-import',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := '{"action":"cron"}'::jsonb) as request_id;
  $cmd$, s));
end $$;
