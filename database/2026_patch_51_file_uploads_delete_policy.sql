-- Patch #51 — (مطبَّق على القاعدة الحية بالفعل) سياسة DELETE لـ file_uploads
drop policy if exists "file_uploads: حذف المرفق (صاحبه أو أدمن)" on file_uploads;
create policy "file_uploads: حذف المرفق (صاحبه أو أدمن)" on file_uploads
  for delete using (uploader_id = auth.uid() or is_super_admin(auth.uid()) or (course_id is not null and is_course_admin(auth.uid(), course_id)));
