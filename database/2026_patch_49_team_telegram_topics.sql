-- ============================================================
-- CodeUp — Patch #49: ربط فرق الأسبوع التقني بـ Topics تيليجرام (خيار A: مجتمع واحد)
-- ============================================================
-- آمن للتشغيل أكثر من مرة، ولا يحذف أي بيانات.
-- الأعمدة تُكتب من Edge Function (service role) فقط — مو من المتصفح.

alter table tech_week_teams
  add column if not exists telegram_chat_id bigint,
  add column if not exists telegram_thread_id bigint,
  add column if not exists telegram_topic_status text
    check (telegram_topic_status in ('creating','ready','failed','closed')),
  add column if not exists telegram_topic_closed_at timestamptz;

-- Topic واحد فقط لكل فريق، ولا يتكرر thread داخل نفس المجموعة
create unique index if not exists tech_week_teams_telegram_thread_uidx
  on tech_week_teams (telegram_chat_id, telegram_thread_id)
  where telegram_thread_id is not null;

-- حماية: سياسة التعديل الحالية تسمح للقائد بتعديل صف فريقه، فنمنعه من العبث بأعمدة تيليجرام.
-- service role (الـ Edge Function) عنده auth.uid() = null فيمرّ.
create or replace function tech_week_teams_protect_telegram_cols()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (
       new.telegram_chat_id        is distinct from old.telegram_chat_id
    or new.telegram_thread_id      is distinct from old.telegram_thread_id
    or new.telegram_topic_status   is distinct from old.telegram_topic_status
    or new.telegram_topic_closed_at is distinct from old.telegram_topic_closed_at
  ) then
    raise exception 'أعمدة تيليجرام تُدار من النظام فقط';
  end if;
  return new;
end $$;

drop trigger if exists tech_week_teams_protect_telegram on tech_week_teams;
create trigger tech_week_teams_protect_telegram
  before update on tech_week_teams
  for each row execute function tech_week_teams_protect_telegram_cols();
