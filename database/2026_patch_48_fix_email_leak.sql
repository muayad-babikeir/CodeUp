-- ============================================================
-- PATCH #48 — C1 fix: profiles.email column-level exposure
-- ============================================================
-- توثيق فقط: هذا التعديل اتطبّق فعليًا على قاعدة الإنتاج مباشرة (عبر
-- اتصال MCP) أثناء مراجعة CODEUP_PRODUCTION_AUDIT.md — الملف ده نسخة
-- في الريبو للتوثيق والمرجعية، مش تشغيل جديد.
--
-- المشكلة: RLS على profiles كانت بتفلتر الصفوف بس (auth.uid() IS NOT
-- NULL)، لكن الـGRANT كان على الجدول كامل، يعني أي مستخدم مسجّل دخول
-- يقدر يجيب بريد أي مستخدم تاني بـ select("*") مباشر من المتصفح.
-- ============================================================

revoke select on profiles from authenticated;
revoke select on profiles from anon;

-- نفس الأعمدة اللي كل الموقع (الفيد/الماركت بليس/المتصدرين/لوحات
-- الأدمن) كان بيعتمد عليها أصلًا لعرض الاسم/الصورة — صفر تغيير وظيفي.
grant select (id, full_name, avatar_url, is_super_admin, created_at) on profiles to authenticated;

-- المسار الوحيد المتبقي لقراءة بريد مستخدم غير نفسك: صاحب البريد نفسه،
-- سوبر أدمن، أو أدمن/قائد له علاقة حقيقية موجودة بالفعل بهذا الطالب
-- (نفس الكورس/المجموعة) — يطابق بالظبط الشاشات الإدارية التي كانت
-- تعرض البريد قبل هذا التعديل، بدون توسيع الصلاحية عن نطاقها الأصلي.
create or replace function get_profile_emails(p_user_ids uuid[])
returns table(id uuid, email text)
language sql security definer set search_path = public as $$
  select p.id, p.email
  from profiles p
  where p.id = any(p_user_ids)
    and (
      auth.uid() = p.id
      or is_super_admin(auth.uid())
      or exists (
        select 1 from enrollments e
        join course_admins ca on ca.course_id = e.course_id
        where e.profile_id = p.id and ca.profile_id = auth.uid()
      )
      or exists (
        select 1 from enrollments e
        join squad_leaders sl on sl.squad_id = e.squad_id
        where e.profile_id = p.id and sl.profile_id = auth.uid()
      )
      or exists (select 1 from university_admins ua where ua.profile_id = auth.uid())
      or exists (select 1 from tech_week_admins twa where twa.profile_id = auth.uid())
    );
$$;

revoke execute on function get_profile_emails(uuid[]) from public;
revoke execute on function get_profile_emails(uuid[]) from anon;
grant execute on function get_profile_emails(uuid[]) to authenticated;
