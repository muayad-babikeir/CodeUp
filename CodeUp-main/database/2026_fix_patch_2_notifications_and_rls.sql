-- ============================================================
-- CodeUp — FIX PATCH #2
-- يعالج: إشعارات عند إنشاء الطلبات (مو بس عند المراجعة)، مراجعة
-- الواجبات والإعلانات عبر RPC محمي بدل كتابة مباشرة، حماية تسليمات
-- الطلاب من تعديل حقول المراجعة على أنفسهم، وإصلاح صلاحية تعديل
-- is_super_admin لمستخدم آخر (كانت تفشل بصمت بسبب RLS ناقصة).
--
-- آمن للتشغيل فوق أي حالة حالية — لا يحذف بيانات. شغّله بعد
-- الملفين السابقين (migration + fix_patch_1).
-- ============================================================

-- ------------------------------------------------------------
-- 1) إشعار أدمن الكورس (وقائد المجموعة عند الانضمام) فور تسجيل الطلب
-- ------------------------------------------------------------
create or replace function request_join_squad(p_squad_id uuid, p_message text default null)
returns squad_join_requests
language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_capacity int;
  v_status text;
  v_current_count int;
  v_already_member boolean;
  v_row squad_join_requests;
begin
  select course_id, capacity, status into v_course_id, v_capacity, v_status
  from squads where id = p_squad_id;

  if v_course_id is null then
    raise exception 'المجموعة غير موجودة';
  end if;
  if v_status <> 'active' then
    raise exception 'المجموعة غير متاحة للانضمام حاليًا';
  end if;

  select exists(select 1 from enrollments where profile_id = auth.uid() and squad_id = p_squad_id)
    into v_already_member;
  if v_already_member then
    raise exception 'أنت عضو بالفعل في هذه المجموعة';
  end if;

  if exists (select 1 from squad_join_requests where squad_id = p_squad_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'لديك طلب انضمام قيد المراجعة بالفعل لهذه المجموعة';
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from enrollments where squad_id = p_squad_id;
    if v_current_count >= v_capacity then
      raise exception 'المجموعة ممتلئة حاليًا';
    end if;
  end if;

  insert into squad_join_requests(squad_id, user_id, message)
  values (p_squad_id, auth.uid(), p_message)
  returning * into v_row;

  -- إشعار أدمن الكورس + قادة نفس المجموعة (فور التقديم، مو فقط عند المراجعة)
  insert into notifications(profile_id, title, body, related_type, related_id)
  select ca.profile_id, 'طلب انضمام جديد', 'يوجد طلب انضمام جديد بانتظار المراجعة', 'squad_join_request', v_row.id
  from course_admins ca where ca.course_id = v_course_id
  union
  select sl.profile_id, 'طلب انضمام جديد', 'يوجد طلب انضمام جديد لمجموعتك بانتظار المراجعة', 'squad_join_request', v_row.id
  from squad_leaders sl where sl.squad_id = p_squad_id;

  perform log_activity(v_course_id, auth.uid(), 'user requested to join squad');
  return v_row;
end;
$$;

create or replace function apply_for_leader(p_course_id uuid, p_squad_id uuid default null, p_message text default null, p_experience text default null)
returns leader_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row leader_applications;
begin
  if not is_enrolled(auth.uid(), p_course_id) then
    raise exception 'يجب أن تكون مسجلاً في الكورس للتقديم كقائد';
  end if;

  if exists (select 1 from leader_applications where course_id = p_course_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'لديك طلب قيادة قيد المراجعة بالفعل لهذا الكورس';
  end if;

  insert into leader_applications(course_id, user_id, squad_id, message, experience)
  values (p_course_id, auth.uid(), p_squad_id, p_message, p_experience)
  returning * into v_row;

  -- إشعار أدمن الكورس فور التقديم
  insert into notifications(profile_id, title, body, related_type, related_id)
  select ca.profile_id, 'طلب قيادة جديد', 'يوجد طلب قيادة جديد لهذا الكورس بانتظار المراجعة', 'leader_application', v_row.id
  from course_admins ca where ca.course_id = p_course_id;

  perform log_activity(p_course_id, auth.uid(), 'leader application submitted');
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 2) مراجعة تسليم واجب: RPC محمي بدل كتابة مباشرة من العميل
--    (يمنع أي احتمال لتلاعب الطالب بدرجته، ويرسل إشعارًا تلقائيًا)
-- ------------------------------------------------------------
create or replace function review_submission(p_submission_id uuid, p_grade numeric, p_notes text)
returns submissions
language plpgsql security definer set search_path = public as $$
declare
  v_row submissions;
  v_course_id uuid;
begin
  select a.course_id into v_course_id from submissions s join assignments a on a.id = s.assignment_id where s.id = p_submission_id;
  if v_course_id is null then
    raise exception 'التسليم غير موجود';
  end if;
  if not (is_course_admin(auth.uid(), v_course_id) or is_leader_in_course(auth.uid(), v_course_id)) then
    raise exception 'لا تملك صلاحية مراجعة هذا التسليم';
  end if;

  update submissions
  set grade = p_grade, reviewer_notes = p_notes, status = 'reviewed', reviewed_at = now()
  where id = p_submission_id
  returning * into v_row;

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (v_row.profile_id, 'تمت مراجعة تسليمك',
          case when p_grade is not null then 'الدرجة: ' || p_grade::text else 'تمت مراجعة تسليمك' end,
          'submission', v_row.id);

  perform log_activity(v_course_id, auth.uid(), 'submission reviewed');
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 3) نشر إعلان: RPC محمي (بدل insert مباشر) لأنه يحتاج يفنّش
--    إشعارات لكل الطلاب المسجلين، والعميل ما يقدر يكتب بجدول
--    notifications مباشرة (RLS تمنعه أصلًا لغير الـRPC).
-- ------------------------------------------------------------
create or replace function create_announcement(p_course_id uuid, p_title text, p_content text)
returns announcements
language plpgsql security definer set search_path = public as $$
declare
  v_row announcements;
begin
  if not is_course_admin(auth.uid(), p_course_id) then
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

-- ------------------------------------------------------------
-- 4) حماية تسليمات الطلاب من تعديل حقول المراجعة على أنفسهم
--    (RLS الأصلية تسمح للطالب يعدّل صف تسليمه، لكن كصفوف كاملة —
--    بدون تقييد أعمدة. من دون هذا الـtrigger، طالب يقدر تقنيًا
--    يستدعي update/insert مباشر من supabase-js ويحط لنفسه درجة
--    أو يعلّم تسليمه reviewed بنفسه.)
-- ------------------------------------------------------------
create or replace function prevent_self_review_tampering()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_is_privileged boolean;
  v_old_grade numeric;
  v_old_notes text;
  v_old_reviewed_at timestamptz;
begin
  select a.course_id into v_course_id from assignments a where a.id = new.assignment_id;
  v_is_privileged := is_course_admin(auth.uid(), v_course_id) or is_leader_in_course(auth.uid(), v_course_id);

  if v_is_privileged or new.profile_id <> auth.uid() then
    return new; -- الأدمن/القائد يراجعون بحرية عبر review_submission
  end if;

  if TG_OP = 'INSERT' then
    v_old_grade := null; v_old_notes := null; v_old_reviewed_at := null;
  else
    v_old_grade := old.grade; v_old_notes := old.reviewer_notes; v_old_reviewed_at := old.reviewed_at;
  end if;

  if new.grade is distinct from v_old_grade
     or new.reviewer_notes is distinct from v_old_notes
     or new.reviewed_at is distinct from v_old_reviewed_at
     or new.status = 'reviewed' then
    raise exception 'لا يمكنك تعديل حقول المراجعة (الدرجة/الحالة/الملاحظات) لتسليمك — هذا للمراجع فقط';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_self_review_tampering on submissions;
create trigger trg_prevent_self_review_tampering
  before insert or update on submissions
  for each row execute procedure prevent_self_review_tampering();

-- ------------------------------------------------------------
-- 5) إصلاح: سوبر أدمن ما كان يقدر يعدّل is_super_admin لمستخدم
--    آخر عبر لوحة الإدارة — RLS الأصلية لجدول profiles تسمح فقط
--    بتعديل صفّك أنت (id = auth.uid()), فكانت عملية "ترقية مستخدم"
--    من admin/js/people.js تفشل بصمت (0 rows updated) لأي حساب
--    غير حساب السوبر أدمن نفسه. هذا يضيف صلاحية صريحة لذلك، مع
--    بقاء trigger منع التصعيد الذاتي (من fix_patch الأول) فعّالًا.
-- ------------------------------------------------------------
drop policy if exists "profiles: سوبر أدمن يعدّل أي حساب" on profiles;
create policy "profiles: سوبر أدمن يعدّل أي حساب" on profiles
  for update using (is_super_admin(auth.uid()));

-- ============================================================
-- تمّ.
-- ============================================================
