-- (طُبّق مسبقًا على القاعدة الحية عبر Supabase MCP — للأرشفة؛ إعادة التشغيل آمنة)
-- Patch #64 — تعميم «الاستيراد من تيليجرام» على الكورسات (مصادر الدروس).
-- الوجهة: موضوع Forum لكل كورس داخل المجموعة العامة (archive_destinations بلا جامعة ولا سنة)، بنفس صيغة الرفع:
--   فاصل ← "القسم | رقم" ← الملف، والقسم الافتراضي = اسم الدرس. الفهرس المثبّت يعمل كما في مواد الجامعة.

-- 1) نوع المصدر telegram (واجهة الطالب تعرضه أصلًا: LP_TYPE_LABEL/lpTypeIcon)
alter table public.resources drop constraint if exists resources_type_check;
alter table public.resources add constraint resources_type_check
  check (type = any (array['youtube_video','youtube_course','article','docs','pdf','website','interactive','github','external_course','telegram']));

-- 2) العمليات: هدفها مادة جامعية أو درس (واحد فقط). course_id للقفل: عملية واحدة غير مكتملة لكل كورس (حتى لا تتداخل رسائل موضوعه)
alter table public.telegram_import_jobs alter column subject_id drop not null;
alter table public.telegram_import_jobs add column if not exists lesson_id uuid references public.lessons(id) on delete cascade;
alter table public.telegram_import_jobs add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.telegram_import_jobs drop constraint if exists telegram_import_jobs_target_check;
alter table public.telegram_import_jobs add constraint telegram_import_jobs_target_check check ((subject_id is not null) <> (lesson_id is not null));
create index if not exists telegram_import_jobs_lesson_idx on public.telegram_import_jobs(lesson_id, status);
create index if not exists telegram_import_jobs_course_idx on public.telegram_import_jobs(course_id, status);

alter table public.telegram_import_items alter column subject_id drop not null;
alter table public.telegram_import_items add column if not exists lesson_id uuid references public.lessons(id) on delete cascade;
alter table public.telegram_import_items drop constraint if exists telegram_import_items_target_check;
alter table public.telegram_import_items add constraint telegram_import_items_target_check check ((subject_id is not null) <> (lesson_id is not null));
create index if not exists telegram_import_items_dedupe_lesson_idx on public.telegram_import_items(source_chat_id, source_message_id, lesson_id) where status = 'copied' and lesson_id is not null;

-- 3) موضوع الكورس في تيليجرام
alter table public.archive_topics add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.archive_topics drop constraint if exists archive_topics_topic_key_check;
alter table public.archive_topics add constraint archive_topics_topic_key_check
  check (topic_key in ('index','submissions','projects','materials','community','store','university') or topic_key like 'subject:%' or topic_key like 'course:%');
create unique index if not exists archive_topics_course_dest_key on public.archive_topics(destination_id, course_id) where course_id is not null;

-- حذف كورس يحذف موضوعه من تيليجرام (نفس آلية حذف المادة)
create or replace function public.trg_course_enqueue_topic_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.telegram_message_cleanup (chat_id, thread_id)
  select d.telegram_chat_id::bigint, t.telegram_thread_id
  from public.archive_topics t join public.archive_destinations d on d.id = t.destination_id
  where t.course_id = old.id and d.telegram_chat_id ~ '^-?[0-9]+$';
  return old;
end $$;
revoke execute on function public.trg_course_enqueue_topic_cleanup() from public, anon, authenticated;
drop trigger if exists courses_topic_cleanup on public.courses;
create trigger courses_topic_cleanup before delete on public.courses
  for each row execute function public.trg_course_enqueue_topic_cleanup();

-- 4) قراءة التقدّم لمن يدير الكورس (سوبر أدمن / أدمن الكورس / قائد بصلاحية إضافة محتوى)
drop policy if exists "import_jobs: مدير الكورس يقرأ" on public.telegram_import_jobs;
create policy "import_jobs: مدير الكورس يقرأ" on public.telegram_import_jobs for select using (
  lesson_id is not null and exists (
    select 1 from public.lessons l join public.units u on u.id = l.unit_id
    where l.id = lesson_id and (public.is_super_admin(auth.uid()) or public.is_course_admin(auth.uid(), u.course_id) or public.leader_has_permission(auth.uid(), u.course_id, 'can_add_content'))
  )
);
drop policy if exists "import_items: مدير الكورس يقرأ" on public.telegram_import_items;
create policy "import_items: مدير الكورس يقرأ" on public.telegram_import_items for select using (
  lesson_id is not null and exists (
    select 1 from public.lessons l join public.units u on u.id = l.unit_id
    where l.id = lesson_id and (public.is_super_admin(auth.uid()) or public.is_course_admin(auth.uid(), u.course_id) or public.leader_has_permission(auth.uid(), u.course_id, 'can_add_content'))
  )
);
