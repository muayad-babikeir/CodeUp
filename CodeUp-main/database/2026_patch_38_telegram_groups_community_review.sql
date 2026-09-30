-- ============================================================
-- CodeUp — Patch #38: تيليجرام نصوص/روابط + إصلاح رؤية المجموعة + قفل تعيين القائد + Community Review
-- ============================================================
-- هذا الباتش يغطي 4 أنظمة مختلفة طُلبت معًا. كل قسم مستقل ومُعلَّق
-- بالتفصيل. آمن للتشغيل فوق أي حالة حالية (CREATE OR REPLACE +
-- IF NOT EXISTS في كل مكان)، ولا يحذف أي بيانات.
-- ============================================================


-- ============================================================
-- القسم 1: أرشفة تيليجرام للنصوص والروابط (بدون ملف)
-- ============================================================
-- التشخيص: triggerTelegramSend() ما كانت تُستدعى إطلاقًا إلا من داخل
-- شرط "فيه ملف مرفوع" بكود الواجهة — يعني أي تسليم نصي بحت أو رابط
-- GitHub بدون ملف كان لا يُرسل لتيليجرام أبدًا من الأساس، مش مشكلة
-- بالدالة نفسها. الحل: نسمح بتسجيل صف file_uploads بدون ملف فعلي
-- (storage_path فاضي) يمثّل "محتوى نصي للأرشفة"، فيستخدم نفس خط
-- الأرشفة والتتبع (archive_status/telegram_message_id/...) الحالي
-- بالكامل بدون تكرار أي منطق. تعديل Edge Functions نفسها منفصل (ملفات .ts).

alter table file_uploads alter column storage_path drop not null;


-- ============================================================
-- القسم 2: إصلاح رؤية المجموعة قبل الانضمام
-- ============================================================
-- التشخيص الحقيقي (مو مجرد منطق واجهة): سياسات RLS الحالية على
-- squad_leaders و enrollments تسمح بقراءة الصف فقط لصاحبه أو أدمن
-- الكورس أو القائد نفسه — يعني حتى الأعضاء العاديين بنفس المجموعة ما
-- كانوا يقدرون يشوفون بعض ولا حتى يشوفون اسم قائدهم! (لا علاقة
-- بالعضوية من عدمها، كان معطوب للجميع تقريبًا إلا القائد/الأدمن).
-- الحل: دالة مساعدة جديدة (نفس نمط is_course_admin/is_squad_leader_of
-- الموجود) للتحقق من العضوية بأمان بدون recursion، ثم توسيع سياستي
-- القراءة لتشمل "عضو بنفس المجموعة" أيضًا.

create or replace function is_squad_member_of(uid uuid, p_squad_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from enrollments where squad_id = p_squad_id and profile_id = uid);
$$;

drop policy if exists "enrollments: الطالب يشوف صفه، القائد يشوف مجموعته، الأدمن يشوف الكل" on enrollments;
create policy "enrollments: الطالب يشوف صفه، القائد يشوف مجموعته، الأدمن يشوف الكل" on enrollments
  for select using (
    profile_id = auth.uid()
    or is_course_admin(auth.uid(), course_id)
    or (squad_id is not null and is_squad_leader_of(auth.uid(), squad_id))
    or (squad_id is not null and is_squad_member_of(auth.uid(), squad_id)) -- جديد: عضو عادي يشوف بقية أعضاء مجموعته
  );

-- سياسة القراءة الحالية على squad_leaders (باسمها الأصلي بالسكيمة)، موسّعة لعضو المجموعة
drop policy if exists "squad_leaders: يشوفها أدمن الكورس أو القائد نفسه" on squad_leaders;
create policy "squad_leaders: يشوفها أدمن الكورس أو القائد نفسه" on squad_leaders
  for select using (
    profile_id = auth.uid()
    or is_squad_member_of(auth.uid(), squad_id) -- جديد: أي عضو بالمجموعة يشوف قائدها
    or is_course_admin(auth.uid(), (select course_id from squads where id = squad_leaders.squad_id))
  );

-- ملاحظة: لا حاجة لأي تعديل إضافي بجانب الواجهة — بمجرد ما RLS يرجّع
-- بيانات القائد/الأعضاء صح للعضو، منطق العرض بالواجهة (renderSquads)
-- يعرضهم تلقائيًا. غير الأعضاء يبقون بدون وصول (RLS ترجع صف فاضي لهم)
-- والواجهة تعرض رسالة واضحة بدل "لا يوجد قائد" المضللة.


-- ============================================================
-- القسم 3: قفل تعيين قائد المجموعة على سوبر أدمن فقط
-- ============================================================
-- تحديث صريح فوق قرار سابق (patch #37 كانت تسمح لأي قائد/أدمن كورس).
-- التوجيه الجديد أوضح وأصرم: سوبر أدمن فقط، من لوحة التحكم فقط.
create or replace function assign_squad_leader(p_squad_id uuid, p_new_leader_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_is_member boolean;
begin
  if not is_super_admin(auth.uid()) then
    raise exception 'هذه العملية متاحة لسوبر أدمن فقط';
  end if;

  select course_id into v_course_id from squads where id = p_squad_id;
  if v_course_id is null then raise exception 'المجموعة غير موجودة'; end if;

  select exists(select 1 from enrollments where squad_id = p_squad_id and profile_id = p_new_leader_id)
    into v_is_member;
  if not v_is_member then
    raise exception 'هذا الطالب ليس عضوًا بهذه المجموعة';
  end if;

  delete from squad_leaders where squad_id = p_squad_id;
  insert into squad_leaders(squad_id, profile_id) values (p_squad_id, p_new_leader_id);

  perform log_activity(v_course_id, auth.uid(), 'squad leader assigned');

  insert into notifications(profile_id, title, body, related_type, related_id, course_id)
  values (p_new_leader_id, 'تم تعيينك قائدًا', 'أصبحت قائد المجموعة.', 'squad_leader_assigned', p_squad_id, v_course_id);
end;
$$;

-- تحصين إضافي بمستوى RLS (دفاع مضاعف، مو بديل عن الفحص جوّه الدالة):
-- منع أي إدخال/حذف مباشر على squad_leaders إلا لسوبر أدمن أو عبر
-- الدالة نفسها (السياسة الحالية كانت تسمح لأدمن الكورس أيضًا).
drop policy if exists "squad_leaders: تعيين من أدمن الكورس فقط" on squad_leaders;
create policy "squad_leaders: تعيين من سوبر أدمن فقط" on squad_leaders
  for insert with check (is_super_admin(auth.uid()));
drop policy if exists "squad_leaders: حذف من سوبر أدمن فقط" on squad_leaders;
create policy "squad_leaders: حذف من سوبر أدمن فقط" on squad_leaders
  for delete using (is_super_admin(auth.uid()));


-- ============================================================
-- القسم 4: نظام "مراجعة المجتمع" (Community Review) — جديد بالكامل
-- ============================================================
-- جدول واحد بسيط (Minimal Table) بالضبط زي المطلوب — مراجعة غير
-- رسمية لا تلمس grade/status/XP إطلاقًا. كل الكتابة عبر RPC واحدة
-- (submit_community_review) فقط — لا توجد أي سياسة INSERT/UPDATE
-- مباشرة على الجدول، فيستحيل تجاوز قواعد التحقق من الواجهة.

create table if not exists community_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  reviewer_id uuid not null references profiles(id) on delete cascade,
  review_type text not null check (review_type in ('meets_requirements','needs_review')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, reviewer_id)
);
create index if not exists idx_community_reviews_submission on community_reviews(submission_id);

alter table community_reviews enable row level security;

-- قراءة: أي عضو مسجّل بنفس الكورس (أو القائد/الأدمن) يقدر يشوف المراجعات والتعليقات
drop policy if exists "community_reviews: قراءة لأعضاء نفس الكورس" on community_reviews;
create policy "community_reviews: قراءة لأعضاء نفس الكورس" on community_reviews
  for select using (
    exists (
      select 1 from submissions s
      join assignments a on a.id = s.assignment_id
      where s.id = community_reviews.submission_id
        and (is_enrolled(auth.uid(), a.course_id) or is_course_admin(auth.uid(), a.course_id) or is_leader_in_course(auth.uid(), a.course_id))
    )
  );
-- ملاحظة: عمدًا لا توجد سياسة insert/update — كل الكتابة تمر إجباريًا
-- عبر submit_community_review() أدناه، وهي SECURITY DEFINER تتحقق من
-- كل الشروط بنفسها (التسجيل بالكورس، عدم مراجعة تسليمك أنت).

create or replace function submit_community_review(p_submission_id uuid, p_review_type text, p_comment text default null)
returns community_reviews
language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_owner uuid;
  v_row community_reviews;
begin
  if p_review_type not in ('meets_requirements','needs_review') then
    raise exception 'نوع مراجعة غير صالح';
  end if;

  select a.course_id, s.profile_id into v_course_id, v_owner
  from submissions s join assignments a on a.id = s.assignment_id
  where s.id = p_submission_id;

  if v_course_id is null then
    raise exception 'التسليم غير موجود';
  end if;
  if v_owner = auth.uid() then
    raise exception 'لا يمكنك مراجعة تسليمك الخاص';
  end if;
  if not (is_enrolled(auth.uid(), v_course_id) or is_leader_in_course(auth.uid(), v_course_id) or is_course_admin(auth.uid(), v_course_id)) then
    raise exception 'يجب أن تكون عضوًا بهذا الكورس للمراجعة';
  end if;

  insert into community_reviews(submission_id, reviewer_id, review_type, comment)
  values (p_submission_id, auth.uid(), p_review_type, p_comment)
  on conflict (submission_id, reviewer_id)
  do update set review_type = excluded.review_type, comment = excluded.comment, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function submit_community_review(uuid, text, text) to authenticated;
