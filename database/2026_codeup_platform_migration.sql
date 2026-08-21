-- ============================================================
-- CodeUp — MIGRATION: Join Requests + Leader Applications +
-- Squad-scoped Assignments + Timeline + Comments + Reactions +
-- Notifications + Atomic RPCs + RLS + Storage policies
--
-- هذا الملف Migration إضافي فوق codeup-schema.sql الحالي.
-- آمن لإعادة التشغيل (idempotent) — لا يحذف بيانات أو جداول.
--
-- طريقة الاستخدام:
-- 1) تأكد أنك شغّلت codeup-schema.sql الأصلي أولًا على المشروع.
-- 2) افتح SQL Editor في Supabase والصق هذا الملف كاملًا وشغّله.
-- 3) يمكن إعادة تشغيله بأمان لو احتجت (كل شيء IF NOT EXISTS /
--    CREATE OR REPLACE / DROP POLICY IF EXISTS ثم CREATE).
-- ============================================================

-- ------------------------------------------------------------
-- 0) ALTER: أعمدة جديدة على جداول موجودة
-- ------------------------------------------------------------

-- assignments: نوع (يومي/أسبوعي) + إمكانية استهداف Squad محددة
alter table assignments add column if not exists squad_id uuid references squads(id) on delete cascade;
alter table assignments add column if not exists type text not null default 'weekly' check (type in ('daily','weekly'));
alter table assignments add column if not exists created_by uuid references profiles(id);
alter table assignments add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_assignments_course on assignments(course_id);
create index if not exists idx_assignments_squad on assignments(squad_id);

-- submissions: نص/شرح + Visibility للـ Timeline + تتبع التحديث
alter table submissions add column if not exists content text;
alter table submissions add column if not exists visibility text not null default 'private' check (visibility in ('course','squad','private'));
alter table submissions add column if not exists created_at timestamptz not null default now();
alter table submissions add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_submissions_assignment on submissions(assignment_id);
create index if not exists idx_submissions_profile on submissions(profile_id);
create index if not exists idx_submissions_visibility on submissions(visibility, created_at desc);

-- squads: سعة + حالة (مطلوبة لمنع الانضمام لمجموعة ممتلئة/مؤرشفة)
alter table squads add column if not exists capacity int;
alter table squads add column if not exists description text;
alter table squads add column if not exists status text not null default 'active' check (status in ('active','archived'));

-- courses: حالة النشر (draft/published/archived) بدل is_active فقط — نحافظ على is_active كما هو
alter table courses add column if not exists status text not null default 'published' check (status in ('draft','published','archived'));

-- file_uploads: ربط اختياري مباشر بالتسليم لتسهيل الاستعلام (submission قد يملك عدة ملفات)
alter table file_uploads add column if not exists submission_id uuid references submissions(id) on delete cascade;
alter table file_uploads add column if not exists file_size bigint;
create index if not exists idx_file_uploads_submission on file_uploads(submission_id);

-- ------------------------------------------------------------
-- 1) SQUAD_JOIN_REQUESTS
-- ------------------------------------------------------------
create table if not exists squad_join_requests (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
-- لا يوجد أكثر من طلب pending واحد لنفس الطالب لنفس المجموعة
create unique index if not exists uq_join_request_pending
  on squad_join_requests(squad_id, user_id) where (status = 'pending');
create index if not exists idx_join_requests_squad on squad_join_requests(squad_id, status);
create index if not exists idx_join_requests_user on squad_join_requests(user_id);

-- ------------------------------------------------------------
-- 2) LEADER_APPLICATIONS
-- ------------------------------------------------------------
create table if not exists leader_applications (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  squad_id uuid references squads(id) on delete set null,
  message text,
  experience text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_leader_application_pending
  on leader_applications(course_id, user_id) where (status = 'pending');
create index if not exists idx_leader_apps_course on leader_applications(course_id, status);
create index if not exists idx_leader_apps_user on leader_applications(user_id);

-- ------------------------------------------------------------
-- 3) COMMENTS (+ Replies عبر parent_id) على SUBMISSIONS
-- ------------------------------------------------------------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  parent_id uuid references comments(id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_comments_submission on comments(submission_id, created_at);
create index if not exists idx_comments_parent on comments(parent_id);

-- ------------------------------------------------------------
-- 4) REACTIONS (على submissions أو comments)
-- ------------------------------------------------------------
create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('submission','comment')),
  target_id uuid not null,
  reaction_type text not null default 'like' check (reaction_type in ('like','helpful','great')),
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id, reaction_type)
);
create index if not exists idx_reactions_target on reactions(target_type, target_id);

-- ------------------------------------------------------------
-- 5) NOTIFICATIONS
-- ------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  related_type text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_profile on notifications(profile_id, is_read, created_at desc);

-- ============================================================
-- HELPER FUNCTIONS الإضافية
-- ============================================================

-- توافق تسمية مع المواصفة (is_platform_admin) فوق نفس عمود is_super_admin الحالي
-- لا ننشئ عمودًا جديدًا حتى لا نكسر البنية الحالية.
create or replace function is_platform_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_super_admin(uid);
$$;

create or replace function is_squad_member(uid uuid, sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from enrollments e where e.squad_id = sid and e.profile_id = uid);
$$;

-- هل يستطيع uid رؤية submission معيّن (صاحبه / أدمن الكورس / قائد مجموعة الطالب / منشور timeline مرئي له)
create or replace function can_view_submission(uid uuid, sub_id uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  s record;
  a record;
  e record;
begin
  select * into s from submissions where id = sub_id;
  if s is null then return false; end if;
  if s.profile_id = uid then return true; end if;

  select * into a from assignments where id = s.assignment_id;
  if a is null then return false; end if;

  if is_course_admin(uid, a.course_id) or is_leader_in_course(uid, a.course_id) then
    return true;
  end if;

  -- Timeline visibility
  select * into e from enrollments where course_id = a.course_id and profile_id = uid;
  if e is null then return false; end if;

  if s.visibility = 'course' then
    return true; -- e موجود يعني uid مسجّل في نفس الكورس
  elsif s.visibility = 'squad' then
    return e.squad_id is not null and e.squad_id = (
      select e2.squad_id from enrollments e2 where e2.profile_id = s.profile_id and e2.course_id = a.course_id
    );
  else
    return false; -- private
  end if;
end;
$$;

create or replace function log_activity(p_course_id uuid, p_actor_id uuid, p_action text)
returns void language sql security definer set search_path = public as $$
  insert into activity_log(course_id, actor_id, action_text) values (p_course_id, p_actor_id, p_action);
$$;

-- ============================================================
-- ATOMIC RPC FUNCTIONS (SECURITY DEFINER + تحقق صلاحيات داخلي)
-- ============================================================

-- ---------- Join Requests ----------
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

  perform log_activity(v_course_id, auth.uid(), 'user requested to join squad');
  return v_row;
end;
$$;

create or replace function cancel_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update squad_join_requests
  set status = 'cancelled'
  where id = p_request_id and user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'لا يمكن إلغاء هذا الطلب';
  end if;
end;
$$;

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

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (r.user_id, 'تمت الموافقة على طلب الانضمام 🎉', 'تم قبولك في المجموعة.', 'squad_join_request', r.id);
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

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (r.user_id, 'تم رفض طلب الانضمام', p_reason, 'squad_join_request', r.id);
end;
$$;

-- ---------- Leader Applications ----------
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

  perform log_activity(p_course_id, auth.uid(), 'leader application submitted');
  return v_row;
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

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (a.user_id, 'تمت الموافقة على طلب القيادة 👑', 'أصبحت قائد مجموعة.', 'leader_application', a.id);
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

  insert into notifications(profile_id, title, body, related_type, related_id)
  values (a.user_id, 'تم رفض طلب القيادة', p_reason, 'leader_application', a.id);
end;
$$;

-- ---------- Comments / Reactions ----------
create or replace function add_comment(p_submission_id uuid, p_content text, p_parent_id uuid default null)
returns comments
language plpgsql security definer set search_path = public as $$
declare
  v_row comments;
begin
  if not can_view_submission(auth.uid(), p_submission_id) then
    raise exception 'لا تملك صلاحية التعليق على هذا المنشور';
  end if;
  if p_content is null or char_length(trim(p_content)) = 0 then
    raise exception 'التعليق فارغ';
  end if;
  if p_parent_id is not null and not exists (select 1 from comments where id = p_parent_id and submission_id = p_submission_id) then
    raise exception 'الرد غير صالح';
  end if;

  insert into comments(submission_id, user_id, parent_id, content)
  values (p_submission_id, auth.uid(), p_parent_id, p_content)
  returning * into v_row;

  perform log_activity(null, auth.uid(), 'comment created');
  return v_row;
end;
$$;

create or replace function toggle_reaction(p_target_type text, p_target_id uuid, p_reaction_type text default 'like')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
begin
  if p_target_type not in ('submission','comment') then
    raise exception 'نوع هدف غير صالح';
  end if;

  if p_target_type = 'submission' then
    if not can_view_submission(auth.uid(), p_target_id) then
      raise exception 'لا تملك صلاحية التفاعل مع هذا المنشور';
    end if;
  end if;

  select exists(
    select 1 from reactions
    where user_id = auth.uid() and target_type = p_target_type and target_id = p_target_id and reaction_type = p_reaction_type
  ) into v_exists;

  if v_exists then
    delete from reactions
    where user_id = auth.uid() and target_type = p_target_type and target_id = p_target_id and reaction_type = p_reaction_type;
    return false; -- تمت إزالة التفاعل
  else
    insert into reactions(user_id, target_type, target_id, reaction_type)
    values (auth.uid(), p_target_type, p_target_id, p_reaction_type);
    return true; -- تمت إضافة التفاعل
  end if;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY على الجداول الجديدة
-- ============================================================
alter table squad_join_requests enable row level security;
alter table leader_applications enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table notifications enable row level security;

-- ---------- SQUAD_JOIN_REQUESTS ----------
drop policy if exists "join_requests: صاحب الطلب أو أدمن/قائد المجموعة" on squad_join_requests;
create policy "join_requests: صاحب الطلب أو أدمن/قائد المجموعة" on squad_join_requests
  for select using (
    user_id = auth.uid()
    or is_squad_leader_of(auth.uid(), squad_id)
    or exists (select 1 from squads sq where sq.id = squad_id and is_course_admin(auth.uid(), sq.course_id))
  );
-- الإدراج/التحديث فقط عبر RPC (SECURITY DEFINER) — لا سياسة insert/update مباشرة للعميل
drop policy if exists "join_requests: لا تعديل مباشر" on squad_join_requests;

-- ---------- LEADER_APPLICATIONS ----------
drop policy if exists "leader_apps: صاحب الطلب أو أدمن الكورس" on leader_applications;
create policy "leader_apps: صاحب الطلب أو أدمن الكورس" on leader_applications
  for select using (
    user_id = auth.uid()
    or is_course_admin(auth.uid(), course_id)
  );

-- ---------- COMMENTS ----------
drop policy if exists "comments: قراءة لمن يرى التسليم" on comments;
create policy "comments: قراءة لمن يرى التسليم" on comments
  for select using (can_view_submission(auth.uid(), submission_id));

drop policy if exists "comments: صاحب التعليق يعدّل" on comments;
create policy "comments: صاحب التعليق يعدّل" on comments
  for update using (user_id = auth.uid());

drop policy if exists "comments: صاحبه أو أدمن/قائد الكورس يحذف" on comments;
create policy "comments: صاحبه أو أدمن/قائد الكورس يحذف" on comments
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from submissions s join assignments a on a.id = s.assignment_id
      where s.id = submission_id and (is_course_admin(auth.uid(), a.course_id) or is_leader_in_course(auth.uid(), a.course_id))
    )
  );
-- الإدراج فقط عبر add_comment() RPC لضمان التحقق من الصلاحية والمحتوى

-- ---------- REACTIONS ----------
drop policy if exists "reactions: قراءة عامة لمن يرى الهدف" on reactions;
create policy "reactions: قراءة عامة لمن يرى الهدف" on reactions
  for select using (
    (target_type = 'submission' and can_view_submission(auth.uid(), target_id))
    or (target_type = 'comment' and exists (
      select 1 from comments c where c.id = target_id and can_view_submission(auth.uid(), c.submission_id)
    ))
  );
-- الإدراج/الحذف فقط عبر toggle_reaction() RPC

-- ---------- NOTIFICATIONS ----------
drop policy if exists "notifications: صاحبها فقط" on notifications;
create policy "notifications: صاحبها فقط" on notifications
  for select using (profile_id = auth.uid());
drop policy if exists "notifications: صاحبها يعلّم كمقروء" on notifications;
create policy "notifications: صاحبها يعلّم كمقروء" on notifications
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============================================================
-- تحديث سياسة SUBMISSIONS لدعم Timeline (SELECT عبر can_view_submission)
-- ============================================================
drop policy if exists "submissions: الطالب صاحب التسليم أو أدمن/قائد الكورس" on submissions;
create policy "submissions: قراءة لمن يملك صلاحية العرض" on submissions
  for select using (can_view_submission(auth.uid(), id));

-- ============================================================
-- منع التصعيد الذاتي: لا يمكن لأي مستخدم تعديل عمود is_super_admin
-- الخاص به عبر RLS "profiles: يعدّل بياناته فقط" — نضيّق ذلك بصلاحيات
-- عمودية عبر REVOKE بدل توسيع RLS الحالية (تبقى القيمة قابلة للتغيير
-- فقط عبر Service Role / SQL Editor يدويًا).
-- ============================================================
create or replace function prevent_self_admin_escalation()
returns trigger language plpgsql as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin and auth.uid() = old.id then
    raise exception 'لا يمكنك تغيير صلاحية الإدارة الخاصة بك';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_admin_escalation on profiles;
create trigger trg_prevent_self_admin_escalation
  before update on profiles
  for each row execute procedure prevent_self_admin_escalation();

-- ============================================================
-- STORAGE: السماح لأدمن/قائد الكورس بقراءة ملفات تسليمات طلابهم
-- (بالإضافة إلى سياسة "صاحب الملف يقرأ ملفه" الموجودة أصلًا)
-- ============================================================
drop policy if exists "submissions bucket: أدمن/قائد الكورس يقرأ ملفات طلابه" on storage.objects;
create policy "submissions bucket: أدمن/قائد الكورس يقرأ ملفات طلابه" on storage.objects
  for select using (
    bucket_id = 'submissions'
    and exists (
      select 1 from file_uploads f
      where f.storage_path = storage.objects.name
        and f.course_id is not null
        and (is_course_admin(auth.uid(), f.course_id) or is_leader_in_course(auth.uid(), f.course_id))
    )
  );

-- ============================================================
-- تمّ. راجع التقرير المرفق لقائمة كل ما تم إنشاؤه/تعديله.
-- ============================================================
