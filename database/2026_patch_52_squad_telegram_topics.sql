-- Patch #52 — (مطبَّق على القاعدة الحية بالفعل) أعمدة تيليجرام لمجموعات الكورس + حماية من تعديلها من المتصفح
alter table squads
  add column if not exists telegram_chat_id bigint,
  add column if not exists telegram_thread_id bigint,
  add column if not exists telegram_topic_status text check (telegram_topic_status in ('creating','ready','failed','closed')),
  add column if not exists telegram_topic_closed_at timestamptz;
create unique index if not exists squads_telegram_thread_uidx on squads (telegram_chat_id, telegram_thread_id) where telegram_thread_id is not null;
create or replace function squads_protect_telegram_cols() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (
       new.telegram_chat_id is distinct from old.telegram_chat_id
    or new.telegram_thread_id is distinct from old.telegram_thread_id
    or new.telegram_topic_status is distinct from old.telegram_topic_status
    or new.telegram_topic_closed_at is distinct from old.telegram_topic_closed_at) then
    raise exception 'أعمدة تيليجرام تُدار من النظام فقط';
  end if;
  return new;
end $$;
drop trigger if exists squads_protect_telegram on squads;
create trigger squads_protect_telegram before update on squads for each row execute function squads_protect_telegram_cols();
