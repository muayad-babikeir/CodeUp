-- Patch #66 — اختبارات داخل معاملة تُلغى دائمًا (لا تترك أي أثر). تُشغَّل على قاعدة لم يُطبَّق عليها migration 66:
-- الكتلة تطبّق الـmigration ثم الاختبارات ثم ترمي استثناءً متعمّدًا PATCH66_TEST_REPORT فيتراجع كل شيء. النتيجة داخل رسالة الخطأ. لا تُطبَّق كـmigration.
DO $test$
declare
  v_rep text; v_fail int; b boolean; n int; n2 int; v_audit text;
  v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid();
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_m1 uuid; v_m2 uuid; v_m3 uuid;
  v_course uuid; v_unit uuid; v_lesson uuid; v_lesson2 uuid; v_subj uuid; v_sem uuid; v_dest uuid;
  v_g_auth0 int; v_g_auth1 int; v_g_anon0 int; v_g_anon1 int; v_pol0 int; v_pol1 int; v_trg0 int; v_trg1 int; v_pend0 int; v_src0 int;
begin
  create temp table t_res (label text, ok boolean);
  create function pg_temp.chk(l text, ok boolean) returns void language sql as $f$ insert into pg_temp.t_res values (l, coalesce(ok, false)) $f$;
  create function pg_temp.pend(m bigint[]) returns int language sql as $f$ select count(*)::int from public.telegram_message_cleanup where chat_id = -1009990000001 and processed_at is null and message_id = any(m) $f$;
  create function pg_temp.trk(m bigint) returns int language sql as $f$ select count(*)::int from public.telegram_resource_files where chat_id = -1009990000001 and message_id = m $f$;
  create function pg_temp.own(m bigint) returns int language sql as $f$ select count(*)::int from public.telegram_resource_owners where chat_id = -1009990000001 and message_id = m $f$;
  create function pg_temp.u(m bigint, th int default 5) returns text language sql as $f$ select 'https://t.me/c/9990000001/' || th || '/' || m $f$;
  create function pg_temp.mk(m bigint, k text, uid uuid, pending boolean default true, aux bigint[] default '{}') returns void language sql as $f$
    insert into public.telegram_resource_files (url, chat_id, thread_id, message_id, created_by, kind, claim_deadline, aux_message_ids)
    values (pg_temp.u(m), -1009990000001, 5, m, uid, k, case when pending then now() + interval '1 hour' end, aux) $f$;
  create function pg_temp.as_user(uid uuid) returns void language sql as $f$
    select set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true), set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true) $f$;
  select count(*) into v_g_auth0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into v_g_anon0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  select count(*) into v_pol0 from pg_policies where schemaname = 'public';
  select count(*) into v_trg0 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal;
  select count(*) into v_pend0 from public.telegram_message_cleanup where processed_at is null;
  select count(*) into v_src0 from (select 1 from public.resources union all select 1 from public.university_materials) s;
alter table public.telegram_resource_files add column if not exists kind text;
alter table public.telegram_resource_files add column if not exists display_title text;
alter table public.telegram_resource_files add column if not exists claim_deadline timestamptz;
alter table public.telegram_resource_files drop constraint if exists telegram_resource_files_kind_check;
alter table public.telegram_resource_files add constraint telegram_resource_files_kind_check check (kind is null or kind in ('file','link','imported'));
create unique index if not exists telegram_resource_files_msg_uidx on public.telegram_resource_files(chat_id, message_id);
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
alter table public.telegram_resource_owners enable row level security;
revoke all on public.telegram_resource_owners from anon, authenticated;
create unique index if not exists telegram_cleanup_pending_msg_uidx   on public.telegram_message_cleanup(chat_id, message_id) where processed_at is null and message_id is not null;
create unique index if not exists telegram_cleanup_pending_topic_uidx on public.telegram_message_cleanup(chat_id, thread_id)  where processed_at is null and message_id is null;
create or replace function public.telegram_url_identity(p_url text)
returns bigint[] language sql immutable set search_path = public as $$
  select case when m is null then null else array[('-100' || m[1])::bigint, coalesce(m[3], m[2])::bigint] end
  from (select regexp_match(coalesce(p_url, ''), '^https?://t\.me/c/([0-9]+)/([0-9]+)(?:/([0-9]+))?(?:[/?#].*)?$') as m) x;
$$;
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
create or replace function public.telegram_discard_message(p_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files;
begin
  select * into t from public.telegram_resource_files where url = p_url;
  if not found then return false; end if;
  return public.telegram_enqueue_if_orphan(t.chat_id, t.message_id);
end $$;
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
create or replace function public.enqueue_telegram_resource_cleanup(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.telegram_resource_files;
begin
  select * into t from public.telegram_resource_files where url = p_url;
  if found then perform public.telegram_enqueue_if_orphan(t.chat_id, t.message_id); end if;
end $$;
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
  select count(*) into n from public.telegram_resource_owners;
  perform pg_temp.chk('T0.1 backfill owners = 159 (got ' || n || ')', n = 159);
  perform pg_temp.chk('T0.2 no tracking row without owner', (select count(*) from public.telegram_resource_files t where not exists (select 1 from public.telegram_resource_owners o where o.chat_id = t.chat_id and o.message_id = t.message_id)) = 0);
  perform pg_temp.chk('T0.3 kind filled on all tracking rows', (select count(*) from public.telegram_resource_files where kind is null) = 0);
  perform pg_temp.chk('T0.4 audit: exactly 1 UNTRACKED_TELEGRAM_MESSAGE and it is /7/102', (select count(*) from public.telegram_archive_audit() a where a.issue = 'UNTRACKED_TELEGRAM_MESSAGE') = 1 and exists (select 1 from public.telegram_archive_audit() a where a.issue = 'UNTRACKED_TELEGRAM_MESSAGE' and a.detail like '%/7/102'));
  perform pg_temp.chk('T0.5 backfill enqueued nothing', (select count(*) from public.telegram_message_cleanup where processed_at is null) = v_pend0);
  perform pg_temp.chk('T0.6 audit: 0 TRACKING_WITHOUT_OWNER/OWNER_WITHOUT_SOURCE/MULTI_OWNER/OWNER_URL_MISMATCH/STUCK', (select count(*) from public.telegram_archive_audit() a where a.issue in ('TRACKING_WITHOUT_OWNER','OWNER_WITHOUT_SOURCE','MULTI_OWNER_MESSAGE','OWNER_URL_MISMATCH','CLEANUP_STUCK')) = 0);
  insert into public.courses (name, slug) values ('T66 course', 't66-' || substr(gen_random_uuid()::text, 1, 8)) returning id into v_course;
  insert into public.units (course_id, title) values (v_course, 'T66 unit') returning id into v_unit;
  insert into public.lessons (unit_id, title) values (v_unit, 'T66 lesson A') returning id into v_lesson;
  insert into public.lessons (unit_id, title) values (v_unit, 'T66 lesson B') returning id into v_lesson2;
  select id into v_sem from public.university_semesters limit 1;
  select id into v_dest from public.archive_destinations where telegram_chat_id ~ '^-?[0-9]+$' limit 1;
  perform pg_temp.as_user(v_u1);
  perform pg_temp.mk(101, 'file', v_u1, true, '{99,100}');
  insert into public.resources (type, title, url) values ('pdf', 'T1 file', pg_temp.u(101)) returning id into v_r1;
  perform pg_temp.chk('T1.1 saving the resource claims the upload (owner kind=file, claim cleared)', (select count(*) from public.telegram_resource_owners where owner_type = 'resource' and owner_id = v_r1 and message_id = 101 and kind = 'file') = 1 and (select claim_deadline from public.telegram_resource_files where message_id = 101 and chat_id = -1009990000001) is null);
  delete from public.resources where id = v_r1;
  perform pg_temp.chk('T1.2 delete -> 3 cleanup rows (file + 2 aux), tracking+owner gone', pg_temp.pend(array[99,100,101]) = 3 and pg_temp.trk(101) = 0 and pg_temp.own(101) = 0);
  perform pg_temp.mk(111, 'file', v_u1);
  insert into public.resources (type, title, url) values ('pdf', 'T1b shared', pg_temp.u(111)) returning id into v_r1;
  insert into public.lesson_resources (lesson_id, resource_id) values (v_lesson, v_r1), (v_lesson2, v_r1);
  delete from public.lesson_resources where lesson_id = v_lesson and resource_id = v_r1;
  perform pg_temp.chk('T1b.1 removing 1 of 2 lesson links keeps resource and message', exists (select 1 from public.resources where id = v_r1) and pg_temp.pend(array[111]) = 0 and pg_temp.own(111) = 1);
  delete from public.lesson_resources where lesson_id = v_lesson2 and resource_id = v_r1;
  perform pg_temp.chk('T1b.2 removing the last link -> orphan trigger deletes resource -> exactly 1 cleanup', not exists (select 1 from public.resources where id = v_r1) and pg_temp.pend(array[111]) = 1 and pg_temp.own(111) = 0);
  insert into public.resources (type, title, url) values ('website', 'T1b direct', 'https://example.com/x') returning id into v_r2;
  insert into public.lesson_resources (lesson_id, resource_id) values (v_lesson, v_r2);
  delete from public.resources where id = v_r2;
  perform pg_temp.chk('T1b.3 deleting resource directly (cascade -> orphan trigger -> no-op) no error/loop', not exists (select 1 from public.lesson_resources where resource_id = v_r2));
  insert into public.resources (type, title, url) values ('website', 'T2 link', 'https://youtube.com/watch?v=1') returning id into v_r2;
  b := public.telegram_register_message(pg_temp.u(201, 7), -1009990000001, 7, 201, null, 'link', 'T2 title', v_u1, 'resource', v_r2, '');
  perform pg_temp.chk('T2.1 register link message: owner kind=link, display_title stored', b and (select count(*) from public.telegram_resource_owners where owner_type = 'resource' and owner_id = v_r2 and message_id = 201 and kind = 'link') = 1 and (select display_title from public.telegram_resource_files where chat_id = -1009990000001 and message_id = 201) = 'T2 title');
  update public.resources set url = 'https://youtube.com/watch?v=2' where id = v_r2;
  update public.resources set title = 'T2 renamed' where id = v_r2;
  perform pg_temp.chk('T2.2 changing link URL/title keeps owner+tracking, no cleanup', pg_temp.own(201) = 1 and pg_temp.trk(201) = 1 and pg_temp.pend(array[201]) = 0);
  b := public.telegram_register_message(pg_temp.u(202, 7), -1009990000001, 7, 202, null, 'link', 'T2 title', v_u1, 'resource', v_r2, '');
  perform pg_temp.chk('T2.3 replacing link message (edit impossible -> new): new owned, old cleaned exactly once', b and pg_temp.own(202) = 1 and pg_temp.own(201) = 0 and pg_temp.pend(array[201]) = 1 and pg_temp.trk(201) = 0);
  delete from public.resources where id = v_r2;
  perform pg_temp.chk('T2.4 delete link resource -> its message queued once', pg_temp.pend(array[202]) = 1 and pg_temp.trk(202) = 0 and pg_temp.own(202) = 0);
  b := public.telegram_register_message(pg_temp.u(299, 7), -1009990000001, 7, 299, null, 'link', 'x', v_u1, 'resource', gen_random_uuid(), '');
  perform pg_temp.chk('T2.5 register for a vanished source returns false and leaves no tracking', (not b) and pg_temp.trk(299) = 0);
  insert into public.telegram_message_cleanup (chat_id, message_id, processed_at, last_error) values (-1009990000001, 301, now(), 'Bad Request: message to delete not found');
  insert into public.resources (type, title, url) values ('website', 'T3', 'https://example.com/t3') returning id into v_r3;
  b := public.telegram_register_message(pg_temp.u(301, 7), -1009990000001, 7, 301, null, 'link', 'T3', v_u1, 'resource', v_r3, '');
  delete from public.resources where id = v_r3;
  perform pg_temp.chk('T3.1 source whose message was deleted earlier: no error, 1 pending job, old processed row intact', pg_temp.pend(array[301]) = 1 and (select count(*) from public.telegram_message_cleanup where chat_id = -1009990000001 and message_id = 301 and processed_at is not null) = 1);
  perform pg_temp.mk(401, 'file', v_u1);
  insert into public.resources (type, title, url) values ('pdf', 'T4 file', pg_temp.u(401)) returning id into v_r4;
  update public.resources set url = pg_temp.u(401) || '?single' where id = v_r4;
  perform pg_temp.chk('T4.1 URL changed cosmetically (same message) -> no delete, still owned', pg_temp.pend(array[401]) = 0 and pg_temp.own(401) = 1);
  update public.resources set url = pg_temp.u(402) where id = v_r4;
  perform pg_temp.chk('T4.2 file source repointed to ANOTHER message: old cleaned once, new (manual) url not owned/tracked', pg_temp.pend(array[401]) = 1 and pg_temp.own(401) = 0 and pg_temp.own(402) = 0 and pg_temp.trk(402) = 0);
  delete from public.resources where id = v_r4;
  perform pg_temp.mk(410, 'file', v_u1);
  insert into public.resources (type, title, url) values ('pdf', 'T4b', pg_temp.u(410)) returning id into v_r4;
  perform pg_temp.mk(411, 'file', v_u1);
  update public.resources set url = pg_temp.u(411) where id = v_r4;
  perform pg_temp.chk('T4.3 replacing the file (new upload claimed): new owned, old cleaned once', pg_temp.own(411) = 1 and pg_temp.own(410) = 0 and pg_temp.pend(array[410]) = 1 and pg_temp.pend(array[411]) = 0);
  delete from public.resources where id = v_r4;
  insert into public.university_subjects (semester_id, title) values (v_sem, 'T66 subject') returning id into v_subj;
  insert into public.archive_topics (destination_id, topic_key, telegram_thread_id, title, subject_id) values (v_dest, 'subject:' || v_subj, 777001, 'T66', v_subj);
  perform pg_temp.mk(501, 'imported', v_u1, false);
  insert into public.university_materials (subject_id, title, url) values (v_subj, 'm1', pg_temp.u(501)) returning id into v_m1;
  b := public.telegram_attach_owner(pg_temp.u(501), 'university_material', v_m1, '', 'imported');
  perform pg_temp.as_user(v_u1);
  perform pg_temp.mk(502, 'file', v_u1);
  insert into public.university_materials (subject_id, title, url) values (v_subj, 'm2', pg_temp.u(502)) returning id into v_m2;
  insert into public.university_materials (subject_id, title, url) values (v_subj, 'm3 manual link', pg_temp.u(503)) returning id into v_m3;
  perform pg_temp.chk('T5.1 setup: m1 imported owned, m2 file claimed, m3 manual t.me url neither owned nor tracked', pg_temp.own(501) = 1 and pg_temp.own(502) = 1 and pg_temp.own(503) = 0 and pg_temp.trk(503) = 0);
  delete from public.university_subjects where id = v_subj;
  perform pg_temp.chk('T5.2 subject delete: its 2 owned messages queued once each; owners/tracking gone', pg_temp.pend(array[501,502]) = 2 and pg_temp.own(501) + pg_temp.own(502) = 0 and pg_temp.trk(501) + pg_temp.trk(502) = 0);
  perform pg_temp.chk('T5.3 subject delete: topic job once; manual link message 503 untouched', (select count(*) from public.telegram_message_cleanup where thread_id = 777001 and message_id is null and processed_at is null) = 1 and pg_temp.pend(array[503]) = 0);
  insert into public.archive_topics (destination_id, topic_key, telegram_thread_id, title, course_id) values (v_dest, 'course:' || v_course, 777002, 'T66 c', v_course);
  perform pg_temp.mk(601, 'imported', v_u1, false);
  update public.lessons set anki_ar_url = pg_temp.u(601) where id = v_lesson;
  b := public.telegram_attach_owner(pg_temp.u(601), 'lesson_field', v_lesson, 'anki_ar_url', 'imported');
  perform pg_temp.mk(602, 'file', v_u1);
  insert into public.resources (type, title, url) values ('pdf', 'T5b file', pg_temp.u(602)) returning id into v_r1;
  insert into public.lesson_resources (lesson_id, resource_id) values (v_lesson, v_r1);
  insert into public.resources (type, title, url) values ('website', 'T5b link', 'https://example.com/shared') returning id into v_r2;
  b := public.telegram_register_message(pg_temp.u(603, 7), -1009990000001, 7, 603, null, 'link', 'shared', v_u1, 'resource', v_r2, '');
  insert into public.lesson_resources (lesson_id, resource_id) values (v_lesson, v_r2), (v_lesson2, v_r2);
  delete from public.courses where id = v_course;
  perform pg_temp.chk('T5b.1 course delete: lesson-field msg, file msg, shared link msg each queued exactly once, owners gone', pg_temp.pend(array[601]) = 1 and pg_temp.pend(array[602]) = 1 and pg_temp.pend(array[603]) = 1 and pg_temp.own(601) + pg_temp.own(602) + pg_temp.own(603) = 0);
  perform pg_temp.chk('T5b.2 course delete: resources deleted; topic job once', not exists (select 1 from public.resources where id in (v_r1, v_r2)) and (select count(*) from public.telegram_message_cleanup where thread_id = 777002 and message_id is null and processed_at is null) = 1);
  n := (select count(*) from public.telegram_message_cleanup where processed_at is null);
  b := public.telegram_enqueue_if_orphan(-1009990000001, 601); b := public.telegram_enqueue_if_orphan(-1009990000001, 602);
  n2 := public.telegram_release_owner('resource', gen_random_uuid());
  perform public.telegram_sweep_unclaimed(); perform public.telegram_sweep_unclaimed();
  perform pg_temp.chk('T6.1 re-running enqueue/release/sweep adds no jobs', (select count(*) from public.telegram_message_cleanup where processed_at is null) = n and n2 = 0);
  insert into public.telegram_message_cleanup (chat_id, thread_id) select chat_id, thread_id from public.telegram_message_cleanup where thread_id = 777002 and message_id is null and processed_at is null on conflict do nothing;
  perform pg_temp.chk('T6.2 topic job inserted twice (trigger re-run) stays 1', (select count(*) from public.telegram_message_cleanup where thread_id = 777002 and message_id is null and processed_at is null) = 1);
  b := false;
  begin insert into public.telegram_message_cleanup (chat_id, message_id) values (-1009990000001, 601); exception when unique_violation then b := true; end;
  perform pg_temp.chk('T6.3 the database itself rejects a duplicate pending cleanup job', b);
  insert into public.resources (type, title, url) values ('telegram', 'T7 legacy', pg_temp.u(777)) returning id into v_r3;
  delete from public.resources where id = v_r3;
  perform pg_temp.chk('T7.1 untracked t.me source: nothing guessed or deleted', pg_temp.pend(array[777]) = 0);
  perform pg_temp.mk(801, 'imported', v_u1, false);
  insert into public.resources (type, title, url) values ('telegram', 'T8a', pg_temp.u(801)) returning id into v_r1;
  insert into public.resources (type, title, url) values ('telegram', 'T8b', pg_temp.u(801)) returning id into v_r2;
  b := public.telegram_attach_owner(pg_temp.u(801), 'resource', v_r1, '', 'imported'); b := public.telegram_attach_owner(pg_temp.u(801), 'resource', v_r2, '', 'imported');
  delete from public.resources where id = v_r1;
  perform pg_temp.chk('T8.1 deleting 1 of 2 owners does NOT delete the message', pg_temp.pend(array[801]) = 0 and pg_temp.trk(801) = 1 and pg_temp.own(801) = 1);
  delete from public.resources where id = v_r2;
  perform pg_temp.chk('T8.2 deleting the last owner queues exactly one cleanup', pg_temp.pend(array[801]) = 1 and pg_temp.trk(801) = 0);
  perform pg_temp.as_user(v_u1);
  perform pg_temp.mk(901, 'file', v_u1);
  perform pg_temp.as_user(v_u2);
  insert into public.resources (type, title, url) values ('pdf', 'T9 thief', pg_temp.u(901)) returning id into v_r2;
  perform pg_temp.chk('T9.1 another user cannot claim a pending upload that is not theirs', pg_temp.own(901) = 0 and (select claim_deadline from public.telegram_resource_files where chat_id = -1009990000001 and message_id = 901) is not null);
  delete from public.resources where id = v_r2;
  perform pg_temp.chk('T9.2 deleting a non-owner source never deletes the message', pg_temp.pend(array[901]) = 0 and pg_temp.trk(901) = 1);
  perform pg_temp.as_user(v_u1);
  insert into public.resources (type, title, url) values ('pdf', 'T9 owner', pg_temp.u(901)) returning id into v_r1;
  perform pg_temp.as_user(v_u2);
  insert into public.resources (type, title, url) values ('pdf', 'T9 copycat', pg_temp.u(901)) returning id into v_r2;
  insert into public.resources (type, title, url) values ('pdf', 'T9 copycat2', pg_temp.u(901) || '?single') returning id into v_r3;
  delete from public.resources where id in (v_r2, v_r3);
  perform pg_temp.chk('T9.3 pasting an OWNED message url (also ?single) into another source, then deleting it, keeps the message', pg_temp.pend(array[901]) = 0 and pg_temp.own(901) = 1);
  delete from public.resources where id = v_r1;
  perform pg_temp.chk('T9.4 only the true owner delete queues the cleanup (1)', pg_temp.pend(array[901]) = 1);
  perform pg_temp.as_user(v_u2);
  set local role authenticated;
  n := 0;
  begin insert into public.telegram_message_cleanup (chat_id, message_id) values (1, 1); exception when insufficient_privilege then n := n + 1; end;
  begin perform count(*) from public.telegram_resource_owners; exception when insufficient_privilege then n := n + 1; end;
  begin perform public.telegram_release_owner('resource', gen_random_uuid()); exception when insufficient_privilege then n := n + 1; end;
  begin perform public.telegram_set_owner('resource', gen_random_uuid(), '', 'x', 'file'); exception when insufficient_privilege then n := n + 1; end;
  begin perform public.telegram_register_message('x', 1, 1, 1, null, 'link', 't', null, 'resource', gen_random_uuid(), ''); exception when insufficient_privilege then n := n + 1; end;
  begin perform public.telegram_enqueue_if_orphan(1, 1); exception when insufficient_privilege then n := n + 1; end;
  begin insert into public.resources (type, title, url) values ('pdf', 'nope', 'https://example.com'); exception when insufficient_privilege then n := n + 1; end;
  select count(*) into n2 from public.telegram_resource_files;
  reset role;
  perform pg_temp.chk('T9.5 non-admin user blocked 7/7: insert cleanup, read owners, 4 internal functions, create resource (got ' || n || ')', n = 7);
  perform pg_temp.chk('T9.6 non-admin user sees 0 tracking rows (RLS, no policies)', n2 = 0);
  perform pg_temp.as_user(null);
  perform pg_temp.chk('T10.1 identity function variants', public.telegram_url_identity('https://t.me/c/4337039125/107/111') = array[-1004337039125, 111]::bigint[] and public.telegram_url_identity('https://t.me/c/4337039125/111') = array[-1004337039125, 111]::bigint[] and public.telegram_url_identity('https://t.me/c/4337039125/107/111?single') = array[-1004337039125, 111]::bigint[] and public.telegram_url_identity('https://youtube.com/watch?v=1') is null and public.telegram_url_identity('https://t.me/somechannel/12') is null and public.telegram_url_identity(null) is null);
  insert into public.telegram_resource_files (url, chat_id, thread_id, message_id, created_by, kind, claim_deadline) values (pg_temp.u(1101), -1009990000001, 5, 1101, v_u1, 'file', now() - interval '1 minute'), (pg_temp.u(1102), -1009990000001, 5, 1102, v_u1, 'file', now() + interval '1 hour');
  insert into public.telegram_resource_files (url, chat_id, thread_id, message_id, created_by, kind) values (pg_temp.u(1103), -1009990000001, 5, 1103, v_u1, 'file');
  n := public.telegram_sweep_unclaimed(); n2 := public.telegram_sweep_unclaimed();
  perform pg_temp.chk('T11.1 sweeper cleans only the expired pending upload, once; fresh pending + legacy unowned untouched', n = 1 and n2 = 0 and pg_temp.pend(array[1101]) = 1 and pg_temp.pend(array[1102,1103]) = 0 and pg_temp.trk(1102) = 1 and pg_temp.trk(1103) = 1);
  select count(*) into v_g_auth1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into v_g_anon1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  select count(*) into v_pol1 from pg_policies where schemaname = 'public';
  select count(*) into v_trg1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal;
  perform pg_temp.chk('T12.1 functions executable by authenticated/anon unchanged (' || v_g_auth0 || '/' || v_g_anon0 || ' -> ' || v_g_auth1 || '/' || v_g_anon1 || ')', v_g_auth0 = v_g_auth1 and v_g_anon0 = v_g_anon1);
  perform pg_temp.chk('T12.2 policy count unchanged (' || v_pol0 || ' -> ' || v_pol1 || '); RLS enabled on tracking/owners/cleanup', v_pol0 = v_pol1 and (select bool_and(relrowsecurity) from pg_class where oid in ('public.telegram_resource_files'::regclass, 'public.telegram_resource_owners'::regclass, 'public.telegram_message_cleanup'::regclass)));
  perform pg_temp.chk('T12.3 no new triggers (' || v_trg0 || ' -> ' || v_trg1 || '); the 3 cleanup triggers present', v_trg0 = v_trg1 and (select count(*) from pg_trigger where tgname in ('resources_tg_cleanup','university_materials_tg_cleanup','lessons_tg_cleanup') and not tgisinternal) = 3);
  perform pg_temp.chk('T12.4 new internal functions: no anon/authenticated execute; service_role can', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('telegram_url_identity','telegram_enqueue_if_orphan','telegram_release_owner','telegram_set_owner','telegram_attach_owner','telegram_register_message','telegram_discard_message','telegram_sweep_unclaimed','telegram_sync_owner_with_url','telegram_archive_audit') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 and has_function_privilege('service_role', 'public.telegram_set_owner(text,uuid,text,text,text)', 'execute'));
  perform pg_temp.chk('T12.5 owners table: no select grant for anon/authenticated', not has_table_privilege('anon', 'public.telegram_resource_owners', 'select') and not has_table_privilege('authenticated', 'public.telegram_resource_owners', 'select'));
  perform pg_temp.chk('T12.6 net count of real sources unchanged by tests', (select count(*) from (select 1 from public.resources union all select 1 from public.university_materials) s) = v_src0);
  select string_agg(a.issue || '=' || a.c, ', ' order by a.issue) into v_audit from (select x.issue, count(*)::text c from public.telegram_archive_audit() x group by x.issue) a;
  select count(*) filter (where not ok), string_agg(label || ': ' || case when ok then 'PASS' else 'FAIL' end, E'\n' order by ctid) into v_fail, v_rep from pg_temp.t_res;
  raise exception E'PATCH66_TEST_REPORT (rolled back) failures=%\n%\nAUDIT_IN_TXN: %', v_fail, v_rep, coalesce(v_audit, '-');
end $test$;