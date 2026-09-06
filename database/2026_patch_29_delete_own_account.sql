-- ============================================================
-- CodeUp — Patch #29: إصلاح "حذف الحساب" (delete-account لا يعمل)
-- ============================================================
-- ✅ تم التحقق من هذا التشخيص مباشرة على قاعدة بياناتكم الفعلية
-- (عبر استعلام على information_schema بتاريخ اليوم) — هذا التشخيص
-- الآن حقيقة مؤكدة، مو افتراضًا مبنيًا على قراءة الكود فقط:
--
--   1) الدالة delete_own_account() التي يستدعيها
--      supabase/functions/delete-account/index.ts عبر
--      userClient.rpc("delete_own_account") — نتحقق من وجودها
--      الفعلي عبر استعلام Functions في نفس الفحص؛ الدالة أدناه
--      تُنشئها/تُحدّثها بأمان (CREATE OR REPLACE) بغض النظر عن حالتها
--      الحالية.
--
--   2) الأعمدة التالية مؤكَّد أنها تشير إلى profiles(id) بقاعدة حذف
--      NO ACTION (تمنع حذف أي profile له سجل واحد فيها):
--        courses.created_by, reports.leader_id,
--        announcements.created_by, activity_log.actor_id,
--        app_settings.updated_by, file_uploads.uploader_id,
--        assignments.created_by, squad_join_requests.reviewed_by,
--        leader_applications.reviewed_by, archive_settings.created_by
--      بينما conversations.user_a/user_b, messages.sender_id,
--      posts.profile_id — الجداول غير الموثقة بالريبو — تبيّن أنها
--      CASCADE فعلًا، فلا حاجة لأي تعديل عليها.
--      عمليًا: أي طالب نشط رفع ملفًا واحدًا على الأقل، أو ظهر في
--      activity_log، لن يقدر يحذف حسابه أبدًا مهما كانت الدالة سليمة.
--
-- الحل هنا بخطوتين:
--   (أ) تحويل كل هذي الأعمدة إلى ON DELETE SET NULL — نحتفظ
--       بالسجل نفسه (تسليم/إعلان/سجل نشاط) لأنه يخص الكورس ككل،
--       ونُفرغ فقط عمود "مين سوّاه" لأن صاحبه حذف حسابه.
--   (ب) إنشاء delete_own_account() لتنظيف ما لا تغطيه علاقات
--       قاعدة البيانات إطلاقًا: ملفات Storage (avatars, submissions)
--       التي تُحفظ بمسار "{user_id}/..." ولا تُحذف تلقائيًا أبدًا
--       بحذف auth.users (Storage نظام منفصل عن القيود المرجعية).
--
-- آمن للتشغيل فوق أي حالة حالية — لا يحذف أي بيانات بنفسه (فقط
-- يُفرغ عمود "منشئ/فاعل" في سجلات غير مرتبطة بالحساب المطلوب حذفه
-- وقت تنفيذه الفعلي)، ولا يمس سياسات RLS الحالية.
-- شغّله في SQL Editor بعد كل الباتشات السابقة.
-- ============================================================

-- ------------------------------------------------------------
-- 1) تحويل الأعمدة المعيقة إلى ON DELETE SET NULL
--    (IF EXISTS على اسم القيد الافتراضي <table>_<col>_fkey؛ هذا هو
--    الاسم التلقائي في Postgres للقيود غير المسمّاة صراحة، وهو
--    نفس الأسلوب المستخدم في كل تعريفات هذا المشروع)
-- ------------------------------------------------------------
alter table courses               drop constraint if exists courses_created_by_fkey;
alter table courses               add  constraint courses_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table reports               drop constraint if exists reports_leader_id_fkey;
alter table reports               add  constraint reports_leader_id_fkey
  foreign key (leader_id) references profiles(id) on delete set null;

alter table announcements         drop constraint if exists announcements_created_by_fkey;
alter table announcements         add  constraint announcements_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table activity_log          drop constraint if exists activity_log_actor_id_fkey;
alter table activity_log          add  constraint activity_log_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

alter table app_settings          drop constraint if exists app_settings_updated_by_fkey;
alter table app_settings          add  constraint app_settings_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

alter table file_uploads          drop constraint if exists file_uploads_uploader_id_fkey;
alter table file_uploads          add  constraint file_uploads_uploader_id_fkey
  foreign key (uploader_id) references profiles(id) on delete set null;

alter table assignments           drop constraint if exists assignments_created_by_fkey;
alter table assignments           add  constraint assignments_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table squad_join_requests   drop constraint if exists squad_join_requests_reviewed_by_fkey;
alter table squad_join_requests   add  constraint squad_join_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table leader_applications   drop constraint if exists leader_applications_reviewed_by_fkey;
alter table leader_applications   add  constraint leader_applications_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

-- archive_settings من الباتش #28 — قد لا يكون منشورًا عند بعض المشاريع، لذا محمي بشرط وجود الجدول
do $$
begin
  if to_regclass('public.archive_settings') is not null then
    alter table archive_settings drop constraint if exists archive_settings_created_by_fkey;
    alter table archive_settings add  constraint archive_settings_created_by_fkey
      foreign key (created_by) references profiles(id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) delete_own_account() — تنظيف ما لا تغطيه علاقات القاعدة
--    (ملفات Storage). تعمل بجلسة المستخدم نفسه (بدون
--    security definer) حتى تبقى خاضعة لسياسات RLS/auth.uid()
--    تمامًا كما يفترض تعليق delete-account/index.ts.
-- ------------------------------------------------------------
create or replace function delete_own_account()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  -- ملفات Storage المملوكة للمستخدم بمساراتها المعتادة "{user_id}/..."
  -- في bucket الصور الشخصية وbucket المرفقات العام (تسليمات/منشورات/تعليقات)
  delete from storage.objects
  where bucket_id in ('avatars', 'submissions')
    and (storage.foldername(name))[1] = auth.uid()::text;

  -- ملاحظة: باقي بيانات المستخدم (enrollments, submissions, comments,
  -- reactions, notifications, squad_leaders, course_admins, ...) كلها
  -- معرّفة أصلًا بـ ON DELETE CASCADE من profiles، فتُحذف تلقائيًا
  -- عند حذف auth.users من الخطوة التالية في delete-account/index.ts
  -- — لا داعي لتكرارها هنا.
end;
$$;

grant execute on function delete_own_account() to authenticated;

-- ============================================================
-- استعلام تحقق (نفس الاستعلام اللي شغّلتوه قبل تطبيق الباتش) —
-- شغّلوه بعد الباتش للتأكد: كل الأسطر يجب أن تصير SET NULL أو
-- CASCADE، ولا يبقى أي NO ACTION على profiles(id).
-- ============================================================
-- select tc.table_name, kcu.column_name, rc.delete_rule
-- from information_schema.table_constraints tc
-- join information_schema.key_column_usage kcu
--   on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
-- join information_schema.constraint_column_usage ccu
--   on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
-- join information_schema.referential_constraints rc
--   on tc.constraint_name = rc.constraint_name and tc.table_schema = rc.constraint_schema
-- where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'profiles'
-- order by tc.table_name;
