-- (طُبّق مسبقًا على القاعدة الحية عبر Supabase MCP بتاريخ 2026-10-04 — الملف للأرشفة، وإعادة تشغيله آمنة)
-- Patch #60 — (أ) موضوع UNIVERSITY لملفات مواد الجامعة  (ب) حذف رسالة تيليجرام تلقائيًا عند حذف المصدر من الموقع.
-- المبدأ: دالة الرفع تسجّل كل ملف أرسلته في telegram_resource_files (url → chat/message). عند حذف صف المصدر
-- (أو تغيير رابطه، أو حذفه تبعًا لحذف درس/وحدة/مادة/فصل/كورس) يسجّل trigger الرسالة في قائمة انتظار،
-- ودالة telegram-resource-cleanup (فورًا من لوحة الإدارة + pg_cron كل 5 دقائق) تحذفها من تيليجرام.
-- لا يُحذف إلا ما رفعته الدالة نفسها: الروابط التي لصقتها يدويًا لرسائل تيليجرام لا تُمسّ.

-- 1) موضوع UNIVERSITY
alter table public.archive_topics drop constraint if exists archive_topics_topic_key_check;
alter table public.archive_topics add constraint archive_topics_topic_key_check
  check (topic_key in ('index','submissions','projects','materials','community','store','university'));
insert into public.archive_topics (destination_id, topic_key, telegram_thread_id, title)
  select id, 'university', 103, 'UNIVERSITY' from public.archive_destinations where telegram_chat_id = '-1004337039125'
  on conflict (destination_id, topic_key) do update set telegram_thread_id = excluded.telegram_thread_id, title = excluded.title;

-- 2) تتبّع ما رفعته الدالة + قائمة انتظار الحذف (service role فقط، بلا سياسات)
create table if not exists public.telegram_resource_files (
  url text primary key,
  chat_id bigint not null,
  thread_id bigint,
  message_id bigint not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.telegram_resource_files enable row level security;

create table if not exists public.telegram_message_cleanup (
  id bigserial primary key,
  chat_id bigint not null,
  message_id bigint not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
alter table public.telegram_message_cleanup enable row level security;

-- 3) تسجيل الرسالة للحذف (تُستدعى من الـ triggers فقط)
create or replace function public.enqueue_telegram_resource_cleanup(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files;
begin
  delete from public.telegram_resource_files where url = p_url returning * into t;
  if t.url is not null then
    insert into public.telegram_message_cleanup (chat_id, message_id) values (t.chat_id, t.message_id);
  end if;
end $$;
revoke execute on function public.enqueue_telegram_resource_cleanup(text) from public, anon, authenticated;

create or replace function public.trg_resource_url_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_telegram_resource_cleanup(old.url);
    return old;
  end if;
  if old.url is distinct from new.url then
    perform public.enqueue_telegram_resource_cleanup(old.url);
  end if;
  return new;
end $$;
revoke execute on function public.trg_resource_url_cleanup() from public, anon, authenticated;

drop trigger if exists resources_tg_cleanup on public.resources;
create trigger resources_tg_cleanup after delete or update of url on public.resources
  for each row execute function public.trg_resource_url_cleanup();
drop trigger if exists university_materials_tg_cleanup on public.university_materials;
create trigger university_materials_tg_cleanup after delete or update of url on public.university_materials
  for each row execute function public.trg_resource_url_cleanup();

-- 4) إزالة المصدر من آخر درس يستخدمه تحذف صف المصدر نفسه (كان يبقى يتيمًا)، فيُحذف معه ملف تيليجرام
create or replace function public.trg_lesson_resource_orphan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.lesson_resources where resource_id = old.resource_id) then
    delete from public.resources where id = old.resource_id;
  end if;
  return old;
end $$;
revoke execute on function public.trg_lesson_resource_orphan() from public, anon, authenticated;
drop trigger if exists lesson_resources_orphan_cleanup on public.lesson_resources;
create trigger lesson_resources_orphan_cleanup after delete on public.lesson_resources
  for each row execute function public.trg_lesson_resource_orphan();

-- 5) الجدولة كل 5 دقائق (نفس x-cron-secret الموجود بمهمة الأرشفة؛ لا يُكتب السر هنا)
do $$
declare s text;
begin
  select substring(command from $re$'x-cron-secret',\s*'([^']+)'$re$) into s from cron.job where jobname = 'codeup-archive-student-files-daily';
  if s is null then raise exception 'x-cron-secret not found in existing cron job'; end if;
  perform cron.unschedule('codeup-resource-cleanup') where exists (select 1 from cron.job where jobname = 'codeup-resource-cleanup');
  perform cron.schedule('codeup-resource-cleanup', '*/5 * * * *', format($cmd$
    select net.http_post(url := 'https://hodjfdhapxnygrnzoggr.supabase.co/functions/v1/telegram-resource-cleanup',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := '{}'::jsonb) as request_id;
  $cmd$, s));
end $$;
