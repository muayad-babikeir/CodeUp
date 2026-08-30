-- ============================================================
-- CodeUp — Patch #28: نظام أرشفة الملفات (تيليجرام) — ناقص بالكامل
-- ============================================================
-- التشخيص:
-- الكود (js/shared.js، supabase/functions/telegram-send-immediate،
-- supabase/functions/archive-student-files، admin/js/audit.js،
-- admin/js/work.js، admin/js/courses.js) يفترض وجود:
--   1) أعمدة على file_uploads: archive_status, archive_error,
--      scheduled_delete_at, telegram_message_id, telegram_chat_id,
--      telegram_sent_at, idempotency_key
--   2) جدول archive_settings (مدة الاحتفاظ لكل كورس/عام)
--   3) دالة set_file_delete_schedule(p_file_id, p_new_time)
-- ولا شيء من هذا موجود في أي ملف SQL بالريبو — على الأرجح أُنشئ
-- مباشرة من لوحة Supabase (نفس ملاحظة الـ README عن conversations/
-- messages/posts) ولم يُصدَّر أبدًا. النتيجة الفعلية:
--
--   (أ) "مشاكل عند الرفع": تسليم أي واجب فيه ملف مرفق يفشل بالكامل
--       لأن upsert على file_uploads يستخدم
--       onConflict:"submission_id,idempotency_key" — عمود
--       idempotency_key غير موجود أصلًا، فيرجع خطأ Postgres فورًا
--       ("column file_uploads.idempotency_key does not exist").
--       الأخطر: هذا يحصل بعد ما يكون تسليم الواجب (submissions) قد
--       نجح فعلًا، فالطالب يشوف رسالة خطأ لكن تسليمه اتسجّل بدون ملف.
--
--   (ب) "أرشفة الملفات والأخطاء": الدالتان الخادميتان تفشلان بصمت
--       عند أي استعلام SELECT/UPDATE يذكر هذي الأعمدة (عمود غير
--       موجود = خطأ من قاعدة البيانات)، فلا يصل شيء لتيليجرام أصلًا،
--       ولوحة "الملفات والأرشفة" بالإدارة (admin/js/audit.js) تفشل
--       بالكامل لأن archive_settings وset_file_delete_schedule غير
--       موجودين.
--
--   (ج) حتى بعد إضافة الأعمدة: لا يوجد أي مكان يحسب
--       scheduled_delete_at تلقائيًا من مدة الاحتفاظ (retention_days)
--       عند نجاح الإرسال لتيليجرام — يعني حتى لو اشتغلت الأرشفة،
--       نسخة Supabase ما كانت راح تُحذف تلقائيًا أبدًا إلا يدويًا.
--       أضفت trigger يحسبها تلقائيًا بدل تكرار المنطق بكل Edge Function.
--
-- آمن للتشغيل فوق أي حالة حالية — لا يحذف ولا يعدّل بيانات موجودة.
-- شغّله في SQL Editor بعد كل الباتشات السابقة (يعتمد على is_super_admin
-- وis_course_admin المعرّفتين بالسكيمة الأساسية).
-- ============================================================

-- ---------- (١) الأعمدة الناقصة على file_uploads ----------
alter table file_uploads add column if not exists archive_status text not null default 'live';
alter table file_uploads add column if not exists archive_error text;
alter table file_uploads add column if not exists scheduled_delete_at timestamptz;
alter table file_uploads add column if not exists telegram_message_id bigint;
alter table file_uploads add column if not exists telegram_chat_id text;
alter table file_uploads add column if not exists telegram_sent_at timestamptz;
alter table file_uploads add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'file_uploads_archive_status_check'
  ) then
    alter table file_uploads add constraint file_uploads_archive_status_check
      check (archive_status in ('live','sending','sent','failed','archived'));
  end if;
end $$;

-- يدعم upsert(onConflict:"submission_id,idempotency_key") المستخدم عند رفع
-- ملف تسليم الطالب. NULL تُعامَل كقيم متمايزة افتراضيًا في Postgres، فهذا
-- الفهرس لا يزعج إدراج ملفات المنشورات/التعليقات (submission_id/idempotency_key
-- فاضيين هناك دائمًا).
create unique index if not exists uq_file_uploads_submission_idempotency
  on file_uploads(submission_id, idempotency_key);

-- ---------- (٢) سياسة UPDATE ناقصة على file_uploads ----------
-- upsert من طرف الطالب يترجم لـ INSERT ... ON CONFLICT DO UPDATE، وجزء
-- الـ UPDATE يحتاج سياسة صريحة (كانت موجودة سياسة SELECT وINSERT فقط).
drop policy if exists "file_uploads: صاحب الملف يعدّل ملفه" on file_uploads;
create policy "file_uploads: صاحب الملف يعدّل ملفه" on file_uploads
  for update using (uploader_id = auth.uid()) with check (uploader_id = auth.uid());

-- ---------- (٣) جدول إعدادات مدة الاحتفاظ ----------
create table if not exists archive_settings (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global','course')),
  scope_id uuid references courses(id) on delete cascade,
  retention_days int not null default 7 check (retention_days > 0),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- scope_id = NULL يمثّل الصف العام الوحيد؛ "nulls not distinct" (PG15+)
-- تجعل NULL يتصادم مع نفسه بدل ما يُعامَل كقيمة متمايزة كل مرة، وإلا
-- upsert(onConflict:"scope_type,scope_id") كان راح ينشئ صف عام جديد كل مرة
-- بدل ما يحدّث الموجود.
create unique index if not exists uq_archive_settings_scope
  on archive_settings(scope_type, scope_id) nulls not distinct;

alter table archive_settings enable row level security;

drop policy if exists "archive_settings: قراءة لأدمن الكورس أو السوبر أدمن" on archive_settings;
create policy "archive_settings: قراءة لأدمن الكورس أو السوبر أدمن" on archive_settings
  for select using (
    is_super_admin(auth.uid())
    or (scope_type = 'course' and is_course_admin(auth.uid(), scope_id))
  );

drop policy if exists "archive_settings: إضافة" on archive_settings;
create policy "archive_settings: إضافة" on archive_settings
  for insert with check (
    (scope_type = 'global' and is_super_admin(auth.uid()))
    or (scope_type = 'course' and is_course_admin(auth.uid(), scope_id))
  );

drop policy if exists "archive_settings: تعديل" on archive_settings;
create policy "archive_settings: تعديل" on archive_settings
  for update using (
    (scope_type = 'global' and is_super_admin(auth.uid()))
    or (scope_type = 'course' and is_course_admin(auth.uid(), scope_id))
  ) with check (
    (scope_type = 'global' and is_super_admin(auth.uid()))
    or (scope_type = 'course' and is_course_admin(auth.uid(), scope_id))
  );

drop policy if exists "archive_settings: حذف" on archive_settings;
create policy "archive_settings: حذف" on archive_settings
  for delete using (
    (scope_type = 'global' and is_super_admin(auth.uid()))
    or (scope_type = 'course' and is_course_admin(auth.uid(), scope_id))
  );

-- ---------- (٤) دالة تعديل موعد حذف ملف يدويًا (زر "أرشف الآن" / "تأجيل") ----------
create or replace function set_file_delete_schedule(p_file_id uuid, p_new_time timestamptz)
returns file_uploads
language plpgsql security definer set search_path = public as $$
declare
  v_row file_uploads;
begin
  select * into v_row from file_uploads where id = p_file_id;
  if v_row is null then
    raise exception 'الملف غير موجود';
  end if;
  if not (
    is_super_admin(auth.uid())
    or (v_row.course_id is not null and is_course_admin(auth.uid(), v_row.course_id))
  ) then
    raise exception 'لا تملك صلاحية على هذا الملف';
  end if;

  update file_uploads set scheduled_delete_at = p_new_time
  where id = p_file_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------- (٥) حساب موعد الحذف تلقائيًا لحظة نجاح الإرسال لتيليجرام ----------
-- بدل ما نكرر منطق "اقرأ مدة الاحتفاظ ثم احسب التاريخ" داخل كل Edge Function
-- (وننساه في واحدة منها لاحقًا)، الـ trigger يضمنه مركزيًا في كل مرة يتحول
-- فيها archive_status إلى 'sent' ولا يوجد موعد محسوب مسبقًا (يحترم أي
-- تأجيل يدوي فعله أدمن عبر postpone قبل اكتمال الإرسال).
create or replace function file_uploads_auto_schedule_delete()
returns trigger language plpgsql as $$
declare
  v_days int;
begin
  if new.archive_status = 'sent' and coalesce(old.archive_status,'') is distinct from 'sent' and new.scheduled_delete_at is null then
    select retention_days into v_days from archive_settings
      where scope_type = 'course' and scope_id = new.course_id;
    if v_days is null then
      select retention_days into v_days from archive_settings
        where scope_type = 'global' and scope_id is null;
    end if;
    if v_days is null then
      v_days := 7;
    end if;
    new.scheduled_delete_at := now() + (v_days || ' days')::interval;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_file_uploads_auto_schedule_delete on file_uploads;
create trigger trg_file_uploads_auto_schedule_delete
  before update on file_uploads
  for each row execute function file_uploads_auto_schedule_delete();

-- ============================================================
-- تمّ. بعد تشغيل هذا الملف:
-- - رفع ملف مع تسليم واجب هيرجع يشتغل بدون خطأ upsert.
-- - إرسال الأرشفة لتيليجرام (فوري + المهمة اليومية) هيرجع يشتغل
--   بدل ما يفشل بصمت على عمود غير موجود.
-- - لوحة "الملفات والأرشفة" بالإدارة هتشتغل بالكامل (إعدادات المدة +
--   جدول الحالة + أزرار "أرشف الآن"/"تأجيل").
-- - نسخ Supabase هتتحذف تلقائيًا بعد مدة الاحتفاظ من أول إرسال ناجح
--   لتيليجرام، بدون تدخل يدوي.
-- ============================================================
