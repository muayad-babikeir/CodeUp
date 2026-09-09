-- ============================================================
-- CodeUp — Patch #37: إدارة المجموعات (مغادرة/تعيين قائد) + إشعارات القادة/الأدمن
-- ============================================================
-- بناءً على نقاش مباشر مع صاحب المنصة، القرارات المطبَّقة هنا:
--
--   1) طالب موجود بمجموعة بنفس الكورس ويطلب الانضمام لمجموعة ثانية:
--      يُسمح له بالطلب (مو منع فوري)، لكن الواجهة تحذّره وقت الطلب إن
--      قبول القائد لهذا الطلب سينقله تلقائيًا ويخرجه من مجموعته الحالية.
--      آلية النقل التلقائي هذي موجودة أصلًا في approve_join_request()
--      (on conflict... do update set squad_id) — ما احتجنا نعدلها.
--
--   2) أي قائد مجموعة أو أدمن كورس يقدر يعيّن أي عضو بالمجموعة كقائد
--      جديد (وينزل القائد القديم تلقائيًا لعضو عادي) — دالة جديدة.
--
--   3) إشعارات جديدة للقادة/الأدمن لما يوصل طلب انضمام أو طلب قيادة
--      جديد (ما كانت موجودة إطلاقًا قبل هذا الباتش — تأكدنا بالفحص).
--      نوع مختلف عن إشعارات الطالب نفسه (squad_join_request /
--      leader_application) حتى تقدر الواجهة تفرّق بينهم وتوجّه كل
--      نوع للمكان الصحيح (تفصيل التوجيه بكود الواجهة، مو هنا).
--
--   4) مغادرة المجموعة: الطالب ما يقدر يعدّل enrollments مباشرة
--      (RLS يسمح فقط لأدمن الكورس/القائد)، فأضفنا دالة leave_squad().
--
-- ⚠️ اكتشاف جانبي مهم أثناء الفحص: عمود notifications.course_id غير
-- موجود إطلاقًا بالسكيمة (رغم أن كود الواجهة يعتمد عليه للتوجيه لصفحة
-- الكورس الصحيحة!) — يعني توجيه الإشعارات لصفحة كورسها الفعلي لم يكن
-- يشتغل أبدًا لأي نوع إشعار (submission, squad_join_request,
-- leader_application)، ويرجع دائمًا للصفحة الرئيسية بدل الكورس. أضفنا
-- العمود هنا وصلّحنا كل الدوال التي تنشئ هذي الإشعارات لتعبئته.
--
-- آمن للتشغيل فوق أي حالة حالية — CREATE OR REPLACE + ADD COLUMN IF
-- NOT EXISTS فقط، ما يحذف ولا يغيّر أي بيانات موجودة.
-- ============================================================

alter table notifications add column if not exists course_id uuid references courses(id) on delete cascade;

-- ------------------------------------------------------------
-- 0) تصحيح توجيه الإشعارات الحالية: تعبئة course_id في كل دالة تنشئ إشعارًا
-- ------------------------------------------------------------
create or replace function approve_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r squad_join_requests;
  v_course_id uuid;
  v_capacity int;
  v_current_count int;
begin
  select * into r from squad_join_requests where id = p_request_id for update;
  if r is null then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  select course_id, capacity into v_course_id, v_capacity from squads where id = r.squad_id;

  if not (is_course_admin(auth.uid(), v_course_id) or is_squad_leader_of(auth.uid(), r.squad_id)) then
    raise exception 'لا تملك صلاحية مراجعة طلبات هذه المجموعة';
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from enrollments where squad_id = r.squad_id;
    if v_current_count >= v_capacity then
      raise exception 'المجموعة ممتلئة، لا يمكن القبول';
    end if;
  end if;

  insert into enrollments(course_id, profile_id, squad_id)
  values (v_course_id, r.user_id, r.squad_id)
  on conflict (course_id, profile_id) do update set squad_id = excluded.squad_id;

  update squad_join_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;

  perform log_activity(v_course_id, auth.uid(), 'join request approved');

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (r.user_id, 'تمت الموافقة على طلب الانضمام 🎉', 'تم قبولك في المجموعة.', 'squad_join_request', r.id, v_course_id);
end;
$$;

create or replace function reject_join_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r squad_join_requests;
  v_course_id uuid;
begin
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'سبب الرفض إلزامي';
  end if;

  select * into r from squad_join_requests where id = p_request_id for update;
  if r is null then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  select course_id into v_course_id from squads where id = r.squad_id;

  if not (is_course_admin(auth.uid(), v_course_id) or is_squad_leader_of(auth.uid(), r.squad_id)) then
    raise exception 'لا تملك صلاحية مراجعة طلبات هذه المجموعة';
  end if;

  update squad_join_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id;

  perform log_activity(v_course_id, auth.uid(), 'join request rejected');

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (r.user_id, 'تم رفض طلب الانضمام', p_reason, 'squad_join_request', r.id, v_course_id);
end;
$$;

create or replace function approve_leader_application(p_application_id uuid, p_squad_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a leader_applications;
begin
  select * into a from leader_applications where id = p_application_id for update;
  if a is null then raise exception 'الطلب غير موجود'; end if;
  if a.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  if not is_course_admin(auth.uid(), a.course_id) then
    raise exception 'لا تملك صلاحية مراجعة طلبات القيادة لهذا الكورس';
  end if;

  if p_squad_id is null or not exists (select 1 from squads where id = p_squad_id and course_id = a.course_id) then
    raise exception 'يجب اختيار مجموعة صالحة تابعة لنفس الكورس';
  end if;

  insert into squad_leaders(squad_id, profile_id)
  values (p_squad_id, a.user_id)
  on conflict (squad_id, profile_id) do nothing;

  update leader_applications
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), squad_id = p_squad_id
  where id = p_application_id;

  perform log_activity(a.course_id, auth.uid(), 'leader application approved');

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (a.user_id, 'تمت الموافقة على طلب القيادة 👑', 'أصبحت قائد مجموعة.', 'leader_application', a.id, a.course_id);
end;
$$;

create or replace function reject_leader_application(p_application_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  a leader_applications;
begin
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'سبب الرفض إلزامي';
  end if;

  select * into a from leader_applications where id = p_application_id for update;
  if a is null then raise exception 'الطلب غير موجود'; end if;
  if a.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقًا'; end if;

  if not is_course_admin(auth.uid(), a.course_id) then
    raise exception 'لا تملك صلاحية مراجعة طلبات القيادة لهذا الكورس';
  end if;

  update leader_applications
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_application_id;

  perform log_activity(a.course_id, auth.uid(), 'leader application rejected');

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (a.user_id, 'تم رفض طلب القيادة', p_reason, 'leader_application', a.id, a.course_id);
end;
$$;

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

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (v_row.profile_id, 'تمت مراجعة تسليمك',
          case when p_grade is not null then 'الدرجة: ' || p_grade::text else 'تمت مراجعة تسليمك' end,
          'submission', v_row.id, v_course_id);

  perform log_activity(v_course_id, auth.uid(), 'submission reviewed');
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 1) مغادرة المجموعة
-- ------------------------------------------------------------
create or replace function leave_squad(p_course_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update enrollments
  set squad_id = null
  where course_id = p_course_id and profile_id = auth.uid();

  if not found then
    raise exception 'لا يوجد تسجيل لك بهذا الكورس';
  end if;

  perform log_activity(p_course_id, auth.uid(), 'left squad');
end;
$$;

-- ------------------------------------------------------------
-- 2) تعيين/تبديل قائد المجموعة
-- ------------------------------------------------------------
create or replace function assign_squad_leader(p_squad_id uuid, p_new_leader_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_is_member boolean;
begin
  select course_id into v_course_id from squads where id = p_squad_id;
  if v_course_id is null then raise exception 'المجموعة غير موجودة'; end if;

  if not (is_course_admin(auth.uid(), v_course_id) or is_squad_leader_of(auth.uid(), p_squad_id)) then
    raise exception 'لا تملك صلاحية تعيين قائد لهذه المجموعة';
  end if;

  select exists(select 1 from enrollments where squad_id = p_squad_id and profile_id = p_new_leader_id)
    into v_is_member;
  if not v_is_member then
    raise exception 'هذا الطالب ليس عضوًا بهذه المجموعة';
  end if;

  delete from squad_leaders where squad_id = p_squad_id;
  insert into squad_leaders(squad_id, profile_id) values (p_squad_id, p_new_leader_id);

  perform log_activity(v_course_id, auth.uid(), 'squad leader assigned');

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (p_new_leader_id, 'تم تعيينك قائدًا 👑', 'أصبحت قائد المجموعة.', 'squad_leader_assigned', p_squad_id, v_course_id);
end;
$$;

-- ------------------------------------------------------------
-- 3) إشعار القادة/الأدمن عند طلب انضمام جديد (لم يكن موجودًا إطلاقًا)
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
  v_recipient uuid;
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

  perform log_activity(v_course_id, auth.uid(), 'user requested to join squad');

  -- إشعار كل قادة هذه المجموعة + كل أدمن هذا الكورس — نوع مختلف
  -- (squad_join_request_new) عن إشعار نتيجة المراجعة اللي يوصل للطالب نفسه
  for v_recipient in
    select profile_id from squad_leaders where squad_id = p_squad_id
    union
    select profile_id from course_admins where course_id = v_course_id
  loop
    insert into notifications(profile_id, title, body, related_type, related_id, course_id)
    values (v_recipient, 'طلب انضمام جديد', 'فيه طالب طلب الانضمام لمجموعة تديرها، بانتظار مراجعتك.', 'squad_join_request_new', v_row.id, v_course_id);
  end loop;

  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 4) إشعار الأدمن عند طلب قيادة جديد (لم يكن موجودًا إطلاقًا)
-- ------------------------------------------------------------
create or replace function apply_for_leader(p_course_id uuid, p_squad_id uuid default null, p_message text default null, p_experience text default null)
returns leader_applications
language plpgsql security definer set search_path = public as $$
declare
  v_row leader_applications;
  v_recipient uuid;
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

  perform log_activity(p_course_id, auth.uid(), 'leader application submitted');

  for v_recipient in select profile_id from course_admins where course_id = p_course_id loop
    insert into notifications(profile_id, title, body, related_type, related_id, course_id)
    values (v_recipient, 'طلب قيادة جديد', 'فيه طالب قدّم طلب قيادة مجموعة بأحد كورساتك، بانتظار مراجعتك.', 'leader_application_new', v_row.id, p_course_id);
  end loop;

  return v_row;
end;
$$;
