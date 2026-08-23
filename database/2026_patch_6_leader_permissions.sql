-- Patch 6: صلاحيات مخصّصة لقائد المجموعة
-- تم تطبيقه مباشرة على قاعدة الإنتاج عبر Supabase MCP بتاريخ 2026-08-23.
-- هذا الملف للتوثيق وإعادة التطبيق على أي بيئة أخرى (تطوير/نسخة احتياطية).

alter table squad_leaders add column if not exists permissions jsonb not null default '{}'::jsonb;

create or replace function leader_has_permission(uid uuid, cid uuid, perm text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from squad_leaders sl join squads sq on sq.id = sl.squad_id
    where sq.course_id = cid and sl.profile_id = uid
      and coalesce((sl.permissions ->> perm)::boolean, false)
  );
$$;

-- ASSIGNMENTS
drop policy if exists "assignments: قائد يضيف حسب الصلاحية" on assignments;
create policy "assignments: قائد يضيف حسب الصلاحية" on assignments
  for insert with check (leader_has_permission(auth.uid(), course_id, 'can_add_assignment'));

drop policy if exists "assignments: قائد يعدّل ما أضافه بصلاحية" on assignments;
create policy "assignments: قائد يعدّل ما أضافه بصلاحية" on assignments
  for update using (created_by = auth.uid() and leader_has_permission(auth.uid(), course_id, 'can_add_assignment'));

-- UNITS/LESSONS
drop policy if exists "units: قائد يضيف حسب صلاحية المحتوى" on units;
create policy "units: قائد يضيف حسب صلاحية المحتوى" on units
  for insert with check (leader_has_permission(auth.uid(), course_id, 'can_add_content'));

drop policy if exists "lessons: قائد يضيف حسب صلاحية المحتوى" on lessons;
create policy "lessons: قائد يضيف حسب صلاحية المحتوى" on lessons
  for insert with check (exists (select 1 from units u where u.id = unit_id and leader_has_permission(auth.uid(), u.course_id, 'can_add_content')));

-- squad_leaders: يحتاج UPDATE policy لأدمن الكورس عشان يقدر يعدّل الصلاحيات
drop policy if exists "squad_leaders: تعديل الصلاحيات من أدمن الكورس" on squad_leaders;
create policy "squad_leaders: تعديل الصلاحيات من أدمن الكورس" on squad_leaders
  for update using (exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id)))
  with check (exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id)));

-- ANNOUNCEMENTS: تحديث الدالة لتسمح للقائد صاحب الصلاحية أيضًا
create or replace function create_announcement(p_course_id uuid, p_title text, p_content text)
returns announcements
language plpgsql security definer set search_path = public as $$
declare
  v_row announcements;
begin
  if not (is_course_admin(auth.uid(), p_course_id) or leader_has_permission(auth.uid(), p_course_id, 'can_post_announcement')) then
    raise exception 'لا تملك صلاحية نشر إعلان لهذا الكورس';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'العنوان إلزامي';
  end if;

  insert into announcements(course_id, title, content, type, created_by)
  values (p_course_id, p_title, p_content, 'general', auth.uid())
  returning * into v_row;

  insert into notifications(profile_id, title, body, related_type, related_id)
  select e.profile_id, 'إعلان جديد', p_title, 'announcement', v_row.id
  from enrollments e where e.course_id = p_course_id;

  perform log_activity(p_course_id, auth.uid(), 'announcement published');
  return v_row;
end;
$$;
