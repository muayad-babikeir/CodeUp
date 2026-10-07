-- Patch #66 — ملكية صريحة بين مصادر CodeUp ورسائل Telegram (chat_id + message_id) + حذف/تعديل آمن (لم يُطبَّق بعد على القاعدة الحية)
-- additive فقط، آمن للتكرار، بلا DROP لأعمدة/جداول. كل الدوال الجديدة مقفلة عن anon/authenticated.
--
-- المبدأ (يستبدل «ابحث عن رابط Telegram ثم احذف»):
--   resource.id → telegram_resource_owners(owner) → (chat_id, message_id) → لا يوجد مالك آخر؟ → cleanup واحد → telegram-resource-cleanup
--   • رابط المصدر (resource.url) ≠ هوية رسالة Telegram (chat_id+message_id) ≠ رابط t.me الناتج (للعرض فقط).
--   • kind صريح: file (رفعه CodeUp) | link (رسالة رابط أنشأها CodeUp) | imported (نسخها CodeUp). رابط t.me يدوي = مصدر خارجي فقط، بلا ملكية ولا حذف.
--   • تغيّر نص الرابط وحده لا يحذف شيئًا. الحذف فقط عند: حذف المصدر، أو استبدال رسالته برسالة أخرى، أو (للملف/المستورد) تغيّر الرابط إلى رسالة/رابط آخر فعليًا.
--   • لا triggers جديدة: نفس triggers الموجودة (resources / university_materials / lessons) بمنطق ملكية بدل مطابقة النص.

-- ============ 1) التتبع: أعمدة إضافية + هوية فريدة للرسالة ============
alter table public.telegram_resource_files add column if not exists kind text;
alter table public.telegram_resource_files add column if not exists display_title text;
alter table public.telegram_resource_files add column if not exists claim_deadline timestamptz;  -- رفع جديد ينتظر حفظ مصدره؛ يُنظَّف إن لم يُحفظ
alter table public.telegram_resource_files drop constraint if exists telegram_resource_files_kind_check;
alter table public.telegram_resource_files add constraint telegram_resource_files_kind_check check (kind is null or kind in ('file','link','imported'));
create unique index if not exists telegram_resource_files_msg_uidx on public.telegram_resource_files(chat_id, message_id);

-- ============ 2) المالكون: كل مصدر يملك رسالة واحدة لكل حقل؛ ويجوز لعدة مصادر امتلاك رسالة (لا تُحذف إلا بآخر مالك) ============
create table if not exists public.telegram_resource_owners (
  owner_type  text not null check (owner_type in ('resource','university_material','lesson_field')),
  owner_id    uuid not null,
  owner_field text not null default '',
  chat_id     bigint not null,
  message_id  bigint not null,
  kind        text not null check (kind in ('file','link','imported')),
  created_at  timestamptz not null default now(),
  primary key (owner_type, owner_id, owner_field),
  foreign key (chat_id, message_id) references public.telegram_resource_files(chat_id, message_id) on delete cascade
);
create index if not exists telegram_resource_owners_msg_idx on public.telegram_resource_owners(chat_id, message_id);
alter table public.telegram_resource_owners enable row level security;   -- بلا سياسات: service role فقط
revoke all on public.telegram_resource_owners from anon, authenticated;

-- ============ 3) قائمة التنظيف: لا تكرار للمهام المعلّقة ============
create unique index if not exists telegram_cleanup_pending_msg_uidx   on public.telegram_message_cleanup(chat_id, message_id) where processed_at is null and message_id is not null;
create unique index if not exists telegram_cleanup_pending_topic_uidx on public.telegram_message_cleanup(chat_id, thread_id)  where processed_at is null and message_id is null;

-- ============ 4) الدوال ============
-- هوية الرسالة من رابط t.me/c/<chat>/<msg> أو t.me/c/<chat>/<topic>/<msg> (يتجاهل ?query و#fragment) — للمقارنة فقط، لا للحذف
create or replace function public.telegram_url_identity(p_url text)
returns bigint[] language sql immutable set search_path = public as $$
  select case when m is null then null else array[('-100' || m[1])::bigint, coalesce(m[3], m[2])::bigint] end
  from (select regexp_match(coalesce(p_url, ''), '^https?://t\.me/c/([0-9]+)/([0-9]+)(?:/([0-9]+))?(?:[/?#].*)?$') as m) x;
$$;

-- يضع الرسالة في قائمة الحذف فقط إذا كانت متتبَّعة وبلا أي مالك. idempotent: لا مهمة مكررة، ولا تمسّ غير المتتبَّع.
create or replace function public.telegram_enqueue_if_orphan(p_chat bigint, p_msg bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files; m bigint;
begin
  select * into t from public.telegram_resource_files where chat_id = p_chat and message_id = p_msg for update;
  if not found then return false; end if;
  if exists (select 1 from public.telegram_resource_owners o where o.chat_id = p_chat and o.message_id = p_msg) then return false; end if;
  delete from public.telegram_resource_files where url = t.url;
  insert into public.telegram_message_cleanup (chat_id, message_id, rebuild_topic_id) values (t.chat_id, t.message_id, t.topic_id) on conflict do nothing;
  foreach m in array coalesce(t.aux_message_ids, '{}'::bigint[]) loop
    insert into public.telegram_message_cleanup (chat_id, message_id) values (t.chat_id, m) on conflict do nothing;
  end loop;
  return true;
end $$;

-- يفكّ مالكًا (حذف المصدر) ثم يضع رسائله اليتيمة فقط في القائمة
create or replace function public.telegram_release_owner(p_type text, p_id uuid, p_field text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; r record; n int := 0;
begin
  with d as (
    delete from public.telegram_resource_owners
     where owner_type = p_type and owner_id = p_id and (p_field is null or owner_field = p_field)
    returning chat_id, message_id)
  select coalesce(jsonb_agg(jsonb_build_object('c', chat_id, 'm', message_id)), '[]'::jsonb) into v from d;
  for r in select (e ->> 'c')::bigint as c, (e ->> 'm')::bigint as m from jsonb_array_elements(v) e loop
    if public.telegram_enqueue_if_orphan(r.c, r.m) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- يجعل المصدر مالكًا لرسالة متتبَّعة (يستبدل مالكه السابق لنفس الحقل، فتُحذف رسالته القديمة إن صارت يتيمة)
create or replace function public.telegram_set_owner(p_type text, p_id uuid, p_field text, p_url text, p_kind text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files; o public.telegram_resource_owners; v_kind text;
begin
  select * into t from public.telegram_resource_files where url = p_url for update;
  if not found then return false; end if;
  v_kind := coalesce(p_kind, t.kind, 'file');
  select * into o from public.telegram_resource_owners where owner_type = p_type and owner_id = p_id and owner_field = coalesce(p_field, '') for update;
  if found and o.chat_id = t.chat_id and o.message_id = t.message_id then
    update public.telegram_resource_files set claim_deadline = null where url = p_url and claim_deadline is not null;
    return true;
  end if;
  insert into public.telegram_resource_owners (owner_type, owner_id, owner_field, chat_id, message_id, kind)
  values (p_type, p_id, coalesce(p_field, ''), t.chat_id, t.message_id, v_kind)
  on conflict (owner_type, owner_id, owner_field)
  do update set chat_id = excluded.chat_id, message_id = excluded.message_id, kind = excluded.kind, created_at = now();
  update public.telegram_resource_files set claim_deadline = null, kind = coalesce(kind, v_kind) where url = p_url;
  if o.owner_id is not null then perform public.telegram_enqueue_if_orphan(o.chat_id, o.message_id); end if;
  return true;
end $$;

-- يربط مالكًا موجودًا فعلًا (يقفل صفّه ضد الحذف المتزامن) — تستدعيه Edge Functions (service role)
create or replace function public.telegram_attach_owner(p_url text, p_type text, p_id uuid, p_field text default '', p_kind text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_type = 'resource' then perform 1 from public.resources where id = p_id for key share;
  elsif p_type = 'university_material' then perform 1 from public.university_materials where id = p_id for key share;
  elsif p_type = 'lesson_field' then perform 1 from public.lessons where id = p_id for key share;
  else return false; end if;
  if not found then return false; end if;
  return public.telegram_set_owner(p_type, p_id, p_field, p_url, p_kind);
end $$;

-- يسجّل رسالة جديدة أنشأها CodeUp (تتبّع + مالك) في خطوة واحدة؛ يرجع false بلا أي أثر إن اختفى المصدر (فتحذف الدالة الرسالة فورًا)
create or replace function public.telegram_register_message(
  p_url text, p_chat bigint, p_thread bigint, p_msg bigint, p_topic uuid, p_kind text, p_title text, p_created_by uuid,
  p_type text, p_id uuid, p_field text default '')
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('file','link','imported') then return false; end if;
  if p_type = 'resource' then perform 1 from public.resources where id = p_id for key share;
  elsif p_type = 'university_material' then perform 1 from public.university_materials where id = p_id for key share;
  elsif p_type = 'lesson_field' then perform 1 from public.lessons where id = p_id for key share;
  else return false; end if;
  if not found then return false; end if;
  insert into public.telegram_resource_files (url, chat_id, thread_id, message_id, created_by, topic_id, kind, display_title)
  values (p_url, p_chat, p_thread, p_msg, p_created_by, p_topic, p_kind, p_title)
  on conflict (url) do update set kind = excluded.kind, display_title = excluded.display_title;
  return public.telegram_set_owner(p_type, p_id, p_field, p_url, p_kind);
end $$;

-- رسالة أنشأها CodeUp ولم يُحفظ لها مصدر (فشل تسجيل): تُنظَّف إن لم يملكها أحد
create or replace function public.telegram_discard_message(p_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files;
begin
  select * into t from public.telegram_resource_files where url = p_url;
  if not found then return false; end if;
  return public.telegram_enqueue_if_orphan(t.chat_id, t.message_id);
end $$;

-- رفع جديد انتهت مهلة ربطه بمصدر (أُرسل ولم يُحفظ المصدر) => رسالة يتيمة أنشأها CodeUp فتُنظَّف. لا يمسّ أي سجل بلا claim_deadline (القديم).
create or replace function public.telegram_sweep_unclaimed()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select chat_id, message_id from public.telegram_resource_files
            where claim_deadline is not null and claim_deadline < now()
              and not exists (select 1 from public.telegram_resource_owners o where o.chat_id = telegram_resource_files.chat_id and o.message_id = telegram_resource_files.message_id)
  loop
    if public.telegram_enqueue_if_orphan(r.chat_id, r.message_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- منطق الـtriggers: (1) رفع جديد لنفس المستخدم يُربط بالمصدر المحفوظ (claim) (2) ملف/مستورد تغيّر رابطه إلى رسالة أخرى فعليًا => فكّ الملكية.
-- رسالة kind=link لا تتأثر بتغيّر الرابط أبدًا (تُعدَّل في مكانها من Edge Function).
create or replace function public.telegram_sync_owner_with_url(p_type text, p_id uuid, p_field text, p_new_url text, p_allow_claim boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); o public.telegram_resource_owners; v_ident bigint[];
begin
  if p_allow_claim and p_new_url is not null and v_uid is not null then
    perform 1 from public.telegram_resource_files t
      where t.url = p_new_url and t.claim_deadline is not null and t.kind = 'file' and t.created_by = v_uid;
    if found then perform public.telegram_set_owner(p_type, p_id, p_field, p_new_url, 'file'); return; end if;
  end if;
  select * into o from public.telegram_resource_owners where owner_type = p_type and owner_id = p_id and owner_field = coalesce(p_field, '');
  if not found or o.kind = 'link' then return; end if;
  v_ident := public.telegram_url_identity(p_new_url);
  if v_ident is null or v_ident[1] is distinct from o.chat_id or v_ident[2] is distinct from o.message_id then
    perform public.telegram_release_owner(p_type, p_id, p_field);
  end if;
end $$;

-- ============ 5) الـtriggers (نفس الأسماء، منطق جديد؛ لا triggers جديدة) ============
create or replace function public.trg_resource_url_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text := case tg_table_name when 'resources' then 'resource' else 'university_material' end;
begin
  if tg_op = 'DELETE' then
    perform public.telegram_release_owner(v_type, old.id);
    return old;
  end if;
  perform public.telegram_sync_owner_with_url(v_type, new.id, '', new.url, true);
  return new;
end $$;

create or replace function public.trg_lesson_url_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.telegram_release_owner('lesson_field', old.id);
    return old;
  end if;
  if old.anki_ar_url is distinct from new.anki_ar_url then perform public.telegram_sync_owner_with_url('lesson_field', new.id, 'anki_ar_url', new.anki_ar_url, false); end if;
  if old.anki_en_url is distinct from new.anki_en_url then perform public.telegram_sync_owner_with_url('lesson_field', new.id, 'anki_en_url', new.anki_en_url, false); end if;
  if old.pdf_url     is distinct from new.pdf_url     then perform public.telegram_sync_owner_with_url('lesson_field', new.id, 'pdf_url',     new.pdf_url,     false); end if;
  if old.video_url   is distinct from new.video_url   then perform public.telegram_sync_owner_with_url('lesson_field', new.id, 'video_url',   new.video_url,   false); end if;
  return new;
end $$;

drop trigger if exists resources_tg_cleanup on public.resources;
create trigger resources_tg_cleanup after insert or delete or update of url on public.resources
  for each row execute function public.trg_resource_url_cleanup();
drop trigger if exists university_materials_tg_cleanup on public.university_materials;
create trigger university_materials_tg_cleanup after insert or delete or update of url on public.university_materials
  for each row execute function public.trg_resource_url_cleanup();
-- lessons_tg_cleanup (after delete or update of anki_ar_url, anki_en_url, pdf_url, video_url) يبقى كما هو ويستدعي الدالة المحدَّثة أعلاه.

-- الدالة القديمة بالنص (تُستدعى من ملفات patches 60/62/65 القديمة): صارت آمنة — لا تحذف رسالة لها مالك
create or replace function public.enqueue_telegram_resource_cleanup(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files;
begin
  select * into t from public.telegram_resource_files where url = p_url;
  if found then perform public.telegram_enqueue_if_orphan(t.chat_id, t.message_id); end if;
end $$;

-- حذف موضوع المادة/الكورس: نفس المنطق + لا تكرار للمهمة (الفهرس الفريد أعلاه)
create or replace function public.trg_subject_enqueue_topic_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.telegram_message_cleanup (chat_id, thread_id)
  select d.telegram_chat_id::bigint, t.telegram_thread_id
  from public.archive_topics t join public.archive_destinations d on d.id = t.destination_id
  where t.subject_id = old.id and d.telegram_chat_id ~ '^-?[0-9]+$'
  on conflict do nothing;
  return old;
end $$;
create or replace function public.trg_course_enqueue_topic_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.telegram_message_cleanup (chat_id, thread_id)
  select d.telegram_chat_id::bigint, t.telegram_thread_id
  from public.archive_topics t join public.archive_destinations d on d.id = t.destination_id
  where t.course_id = old.id and d.telegram_chat_id ~ '^-?[0-9]+$'
  on conflict do nothing;
  return old;
end $$;

-- ============ 6) تقرير Audit (قراءة فقط) ============
create or replace function public.telegram_archive_audit()
returns table(issue text, ref_type text, ref_id text, detail text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with refs as (
    select 'resource'::text ot, r.id oid, ''::text fld, r.url from public.resources r where r.url is not null
    union all select 'university_material', m.id, '', m.url from public.university_materials m where m.url is not null
    union all select 'lesson_field', l.id, 'anki_ar_url', l.anki_ar_url from public.lessons l where l.anki_ar_url is not null
    union all select 'lesson_field', l.id, 'anki_en_url', l.anki_en_url from public.lessons l where l.anki_en_url is not null
    union all select 'lesson_field', l.id, 'pdf_url', l.pdf_url from public.lessons l where l.pdf_url is not null
    union all select 'lesson_field', l.id, 'video_url', l.video_url from public.lessons l where l.video_url is not null
  )
  select 'UNTRACKED_TELEGRAM_MESSAGE', x.ot, x.oid::text, x.url
    from refs x where public.telegram_url_identity(x.url) is not null
     and not exists (select 1 from public.telegram_resource_files t where t.chat_id = (public.telegram_url_identity(x.url))[1] and t.message_id = (public.telegram_url_identity(x.url))[2])
  union all
  select 'TRACKING_WITHOUT_OWNER', 'tracking', t.url, 'kind=' || coalesce(t.kind, '?') || ' created=' || t.created_at::date
    from public.telegram_resource_files t where t.claim_deadline is null
     and not exists (select 1 from public.telegram_resource_owners o where o.chat_id = t.chat_id and o.message_id = t.message_id)
  union all
  select case when t.claim_deadline < now() then 'PENDING_CLAIM_EXPIRED' else 'PENDING_CLAIM' end, 'tracking', t.url, 'deadline=' || t.claim_deadline
    from public.telegram_resource_files t where t.claim_deadline is not null
  union all
  select 'OWNER_WITHOUT_SOURCE', o.owner_type, o.owner_id::text, o.owner_field
    from public.telegram_resource_owners o
   where not exists (select 1 from refs x where x.ot = o.owner_type and x.oid = o.owner_id)
     and not (o.owner_type = 'resource' and exists (select 1 from public.resources r where r.id = o.owner_id))
     and not (o.owner_type = 'university_material' and exists (select 1 from public.university_materials m where m.id = o.owner_id))
     and not (o.owner_type = 'lesson_field' and exists (select 1 from public.lessons l where l.id = o.owner_id))
  union all
  select 'OWNER_URL_MISMATCH', o.owner_type, o.owner_id::text, o.owner_field || ' kind=' || o.kind
    from public.telegram_resource_owners o
    left join refs x on x.ot = o.owner_type and x.oid = o.owner_id and x.fld = o.owner_field
   where o.kind in ('file','imported')
     and (x.url is null or (public.telegram_url_identity(x.url))[1] is distinct from o.chat_id or (public.telegram_url_identity(x.url))[2] is distinct from o.message_id)
     and exists (select 1 from refs y where y.ot = o.owner_type and y.oid = o.owner_id and y.fld = o.owner_field)
  union all
  select 'MULTI_OWNER_MESSAGE', 'message', o.chat_id || ':' || o.message_id, count(*)::text || ' owners'
    from public.telegram_resource_owners o group by o.chat_id, o.message_id having count(*) > 1
  union all
  select 'CLEANUP_STUCK', 'cleanup', c.id::text, c.chat_id || ':' || coalesce(c.message_id::text, 'topic ' || c.thread_id) || ' ' || coalesce(left(c.last_error, 80), '')
    from public.telegram_message_cleanup c where c.processed_at is null and c.attempts >= 5
  union all
  select 'CLEANUP_PENDING', 'summary', count(*)::text, 'attempts<5' from public.telegram_message_cleanup c where c.processed_at is null and c.attempts < 5
  union all
  select 'CLEANUP_ALREADY_DELETED_ON_TELEGRAM', 'summary', count(*)::text, 'processed with not-found (harmless)' from public.telegram_message_cleanup c where c.processed_at is not null and c.last_error ilike '%not found%'
  union all
  select 'OWNED_OK_' || o.kind, 'summary', count(*)::text, '' from public.telegram_resource_owners o group by o.kind;
end $$;

-- ============ 7) Backfill آمن: يربط كل رسالة متتبَّعة بمصدرها فقط عندما يطابقها مصدر واحد بالضبط (غير ذلك يبقى بلا مالك ويظهر في الـaudit ولا يُحذف) ============
update public.telegram_resource_files t set kind = 'imported'
 where t.kind is null and exists (select 1 from public.telegram_import_items i where i.url = t.url);
update public.telegram_resource_files set kind = 'file' where kind is null;

with refs as (
  select 'resource'::text ot, id oid, ''::text fld, url from public.resources where url is not null
  union all select 'university_material', id, '', url from public.university_materials where url is not null
  union all select 'lesson_field', id, 'anki_ar_url', anki_ar_url from public.lessons where anki_ar_url is not null
  union all select 'lesson_field', id, 'anki_en_url', anki_en_url from public.lessons where anki_en_url is not null
  union all select 'lesson_field', id, 'pdf_url', pdf_url from public.lessons where pdf_url is not null
  union all select 'lesson_field', id, 'video_url', video_url from public.lessons where video_url is not null
), m as (
  select r.ot, r.oid, r.fld, t.chat_id, t.message_id, t.kind, count(*) over (partition by r.url) cnt
    from refs r join public.telegram_resource_files t on t.url = r.url
)
insert into public.telegram_resource_owners (owner_type, owner_id, owner_field, chat_id, message_id, kind)
select ot, oid, fld, chat_id, message_id, kind from m where cnt = 1
on conflict do nothing;

-- ============ 8) الصلاحيات: كل الدوال للـservice role/postgres فقط ============
revoke execute on function public.telegram_url_identity(text) from public, anon, authenticated;
revoke execute on function public.telegram_enqueue_if_orphan(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.telegram_release_owner(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.telegram_set_owner(text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.telegram_attach_owner(text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.telegram_register_message(text, bigint, bigint, bigint, uuid, text, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.telegram_discard_message(text) from public, anon, authenticated;
revoke execute on function public.telegram_sweep_unclaimed() from public, anon, authenticated;
revoke execute on function public.telegram_sync_owner_with_url(text, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.telegram_archive_audit() from public, anon, authenticated;
revoke execute on function public.trg_resource_url_cleanup() from public, anon, authenticated;
revoke execute on function public.trg_lesson_url_cleanup() from public, anon, authenticated;
revoke execute on function public.enqueue_telegram_resource_cleanup(text) from public, anon, authenticated;
revoke execute on function public.trg_subject_enqueue_topic_cleanup() from public, anon, authenticated;
revoke execute on function public.trg_course_enqueue_topic_cleanup() from public, anon, authenticated;
