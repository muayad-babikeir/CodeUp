-- Patch #53 — (مطبَّق على القاعدة الحية بالفعل) حذف Topic تيليجرام تلقائيًا عند حذف فريق/مجموعة
-- المبدأ: trigger قبل الحذف يسجّل (chat_id, thread_id) في قائمة انتظار، وpg_cron كل 5 دقائق
-- يستدعي telegram-team-topic (action process_cleanup) ليحذف الـ Topic. يعمل مع الحذف المتسلسل (حذف فعالية/كورس).
create table if not exists telegram_topic_cleanup (
  id bigserial primary key,
  source text not null check (source in ('tech_week_team','squad')),
  chat_id bigint not null,
  thread_id bigint not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
alter table telegram_topic_cleanup enable row level security; -- بلا سياسات: service role فقط

create or replace function enqueue_telegram_topic_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.telegram_thread_id is not null and old.telegram_chat_id is not null then
    insert into telegram_topic_cleanup (source, chat_id, thread_id)
    values (case tg_table_name when 'squads' then 'squad' else 'tech_week_team' end, old.telegram_chat_id, old.telegram_thread_id);
  end if;
  return old;
end $$;

drop trigger if exists tech_week_teams_enqueue_topic_cleanup on tech_week_teams;
create trigger tech_week_teams_enqueue_topic_cleanup before delete on tech_week_teams for each row execute function enqueue_telegram_topic_cleanup();
drop trigger if exists squads_enqueue_topic_cleanup on squads;
create trigger squads_enqueue_topic_cleanup before delete on squads for each row execute function enqueue_telegram_topic_cleanup();

-- الجدولة: تستعمل نفس x-cron-secret الموجود في مهمة الأرشفة الحالية (لا يُكتب السر هنا)
do $$
declare s text;
begin
  select substring(command from $re$'x-cron-secret',\s*'([^']+)'$re$) into s from cron.job where jobname = 'codeup-archive-student-files-daily';
  if s is null then raise exception 'x-cron-secret not found in existing cron job'; end if;
  perform cron.unschedule('codeup-topic-cleanup') where exists (select 1 from cron.job where jobname = 'codeup-topic-cleanup');
  perform cron.schedule('codeup-topic-cleanup', '*/5 * * * *', format($cmd$
    select net.http_post(url := 'https://hodjfdhapxnygrnzoggr.supabase.co/functions/v1/telegram-team-topic',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := '{"action":"process_cleanup"}'::jsonb) as request_id;
  $cmd$, s));
end $$;
