-- ============================================================
-- CodeUp — FIX PATCH #1
-- يضيف دالة تسجيل ذاتي في الكورس (enroll_in_course) كانت ناقصة.
-- بدونها: أي طالب يفتح كورس لأول مرة يبقى "غير مسجل" فعليًا في
-- enrollments (لأن سياسة RLS الأصلية تسمح فقط للأدمن بالإضافة)،
-- فيفشل طلب القيادة وأي عملية تتحقق من is_enrolled().
--
-- آمن للتشغيل فوق أي حالة حالية — لا يحذف ولا يعدّل بيانات.
-- شغّله في SQL Editor بعد الملفين السابقين.
-- ============================================================

create or replace function enroll_in_course(p_course_id uuid)
returns enrollments
language plpgsql security definer set search_path = public as $$
declare
  v_row enrollments;
  v_status text;
begin
  select status into v_status from courses where id = p_course_id;
  if v_status is null then
    raise exception 'الكورس غير موجود';
  end if;
  if v_status <> 'published' then
    raise exception 'هذا الكورس غير متاح للتسجيل حاليًا';
  end if;

  insert into enrollments(course_id, profile_id)
  values (p_course_id, auth.uid())
  on conflict (course_id, profile_id) do nothing
  returning * into v_row;

  if v_row is null then
    select * into v_row from enrollments where course_id = p_course_id and profile_id = auth.uid();
  end if;

  perform log_activity(p_course_id, auth.uid(), 'student enrolled in course');
  return v_row;
end;
$$;

-- ============================================================
-- تمّ. لا حاجة لأي تعديل إضافي على RLS — الدالة SECURITY DEFINER
-- تتجاوز قيود enrollments insert المخصصة للأدمن فقط، بنفس طريقة
-- بقية دوال RPC الموجودة أصلًا (approve_join_request وغيرها).
-- ============================================================
