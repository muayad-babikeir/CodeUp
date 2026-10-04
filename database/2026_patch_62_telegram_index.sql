-- (طُبّق مسبقًا على القاعدة الحية عبر Supabase MCP بتاريخ 2026-10-04 — للأرشفة؛ إعادة التشغيل آمنة)
-- Patch #62 — الفهرس المثبّت الديناميكي داخل موضوع كل مادة + ترتيب الرسائل (فاصل / "القسم | رقم" / الملف).
-- بلا جداول جديدة: أعمدة إضافية على archive_topics و telegram_resource_files و telegram_message_cleanup.

-- archive_topics: رسالة الفهرس + عدّاد الحلقات لكل قسم (تصاعدي دائمًا، لا يُعاد استخدام رقم محذوف ولا تتغيّر أرقام الحلقات القديمة)
alter table public.archive_topics add column if not exists index_message_id bigint;
alter table public.archive_topics add column if not exists episode_counters jsonb not null default '{}'::jsonb;

-- telegram_resource_files: الموضوع + القسم + رقم الحلقة + رسالتا الفاصل والعنوان (تُحذفان مع الملف)
alter table public.telegram_resource_files add column if not exists topic_id uuid references public.archive_topics(id) on delete set null;
alter table public.telegram_resource_files add column if not exists section text;
alter table public.telegram_resource_files add column if not exists episode int;
alter table public.telegram_resource_files add column if not exists episode_code text;
alter table public.telegram_resource_files add column if not exists aux_message_ids bigint[] not null default '{}';
create index if not exists telegram_resource_files_topic_idx on public.telegram_resource_files(topic_id, created_at);

-- قائمة الحذف: بعد حذف رسالة ملف يُعاد بناء فهرس موضوعها
alter table public.telegram_message_cleanup add column if not exists rebuild_topic_id uuid;

create or replace function public.next_episode(p_topic uuid, p_section text)
returns int language sql security definer set search_path = public as $$
  update public.archive_topics
     set episode_counters = jsonb_set(episode_counters, array[p_section], to_jsonb(coalesce((episode_counters ->> p_section)::int, 0) + 1), true)
   where id = p_topic
  returning (episode_counters ->> p_section)::int;
$$;
create or replace function public.release_episode(p_topic uuid, p_section text, p_n int)
returns void language sql security definer set search_path = public as $$
  update public.archive_topics
     set episode_counters = jsonb_set(episode_counters, array[p_section], to_jsonb(p_n - 1), true)
   where id = p_topic and (episode_counters ->> p_section)::int = p_n;
$$;
revoke execute on function public.next_episode(uuid, text) from public, anon, authenticated;
revoke execute on function public.release_episode(uuid, text, int) from public, anon, authenticated;

-- حذف مصدر يحذف رسائله الثلاث (الملف + الفاصل + العنوان) ويطلب إعادة بناء الفهرس
create or replace function public.enqueue_telegram_resource_cleanup(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files; m bigint;
begin
  delete from public.telegram_resource_files where url = p_url returning * into t;
  if t.url is not null then
    insert into public.telegram_message_cleanup (chat_id, message_id, rebuild_topic_id) values (t.chat_id, t.message_id, t.topic_id);
    foreach m in array t.aux_message_ids loop
      insert into public.telegram_message_cleanup (chat_id, message_id) values (t.chat_id, m);
    end loop;
  end if;
end $$;
revoke execute on function public.enqueue_telegram_resource_cleanup(text) from public, anon, authenticated;
