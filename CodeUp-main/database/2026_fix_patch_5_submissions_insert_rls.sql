-- ============================================================
-- Patch 5: إصلاح خطأ "new row violates row-level security policy
--          for table submissions" عند تسليم الطالب لواجب.
--
-- السبب: في 2026_codeup_platform_migration.sql تم حذف السياسة
-- القديمة "submissions: الطالب صاحب التسليم أو أدمن/قائد الكورس"
-- (التي كانت على الأرجح FOR ALL وتغطي select/insert/update)
-- واستبدالها بسياسة SELECT فقط (قراءة لمن يملك صلاحية العرض عبر
-- can_view_submission). لم يتم إضافة سياسة INSERT/UPDATE بديلة،
-- ونتيجة لذلك RLS يرفض أي إدراج افتراضيًا — حتى تسليم الطالب
-- لواجبه الخاص. هذا الباتش يعيد صلاحية الإدراج/التعديل لصاحب
-- التسليم فقط (بشرط أنه مسجّل في كورس الواجب)، مع بقاء حماية
-- حقول المراجعة (grade/status/reviewer_notes) عبر trigger
-- prevent_self_review_tampering الموجود مسبقًا في patch_2.
-- ============================================================

-- INSERT: الطالب يقدر يُنشئ تسليمًا لنفسه فقط، ولواجب في كورس هو مسجّل فيه
drop policy if exists "submissions: الطالب يُنشئ تسليمه الخاص" on submissions;
create policy "submissions: الطالب يُنشئ تسليمه الخاص" on submissions
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from assignments a
      where a.id = assignment_id
        and is_enrolled(auth.uid(), a.course_id)
    )
  );

-- UPDATE: صاحب التسليم يقدر يعدّل تسليمه (المحتوى/الملف/المشاركة)
-- ملاحظة: trigger prevent_self_review_tampering (patch_2) يمنعه من
-- تعديل grade/status/reviewer_notes/reviewed_at بنفسه، لذا لا حاجة
-- لتكرار ذلك المنطق هنا.
drop policy if exists "submissions: صاحب التسليم يعدّل تسليمه" on submissions;
create policy "submissions: صاحب التسليم يعدّل تسليمه" on submissions
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ============================================================
-- تمّ. طبّق هذا الملف في Supabase SQL Editor بعد الباتشات السابقة.
-- ============================================================
