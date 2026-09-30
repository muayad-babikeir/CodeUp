-- ============================================================
-- CodeUp — FIX PATCH #4 — XP / Streak / Progress + حالة "متأخر"
-- ============================================================
-- يعالج مشكلتين حقيقيتين موجودتين بالواجهة لكن بدون أي تنفيذ
-- فعلي بقاعدة البيانات:
--
-- 1) أعمدة enrollments.xp / progress / streak / completed_count
--    تُقرأ بكل مكان (لوحة التقدم، المتصدرون، لوحة الأدمن) لكن
--    ما فيه ولا trigger يحدّثها عند تسليم واجب أو مراجعته، فتبقى
--    عالقيمة الافتراضية للأبد.
--
-- 2) حالة "متأخر" (late) بجدول submissions موجودة بالـ enum
--    وبفلتر الأدمن، لكن الكود بـ index.html يكتب دايمًا
--    status:'submitted' بغض النظر عن الموعد النهائي، فما توجد
--    ولا حالة "late" فعليًا.
--
-- آمن للتشغيل فوق أي حالة حالية. شغّله بعد fix_patch_1/2/3.
-- ============================================================

-- ---------- عمود مساعد لحساب الـ streak (آخر يوم فيه نشاط تسليم) ----------
alter table enrollments add column if not exists last_activity_date date;

-- ------------------------------------------------------------
-- 1) قبل إدراج/تعديل submission: تحديد status تلقائيًا
--    (submitted/late) حسب مقارنة submitted_at بموعد الواجب.
--    ما يلمس الحالات الثانية (missing تُحسب بالعميل من غياب صف،
--    reviewed تُحدّد فقط عبر review_submission RPC).
-- ------------------------------------------------------------
create or replace function set_submission_late_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deadline date;
begin
  if new.status = 'submitted' then
    select deadline into v_deadline from assignments where id = new.assignment_id;
    if v_deadline is not null and new.submitted_at is not null
       and new.submitted_at::date > v_deadline then
      new.status := 'late';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_submission_late_status on submissions;
create trigger trg_set_submission_late_status
  before insert or update on submissions
  for each row execute procedure set_submission_late_status();

-- ------------------------------------------------------------
-- 2) بعد إدراج/تحديث submission: إعادة حساب XP/التقدم/الـ streak
--    لصاحب التسليم بذلك الكورس. يُعاد الحساب من الصفر في كل
--    مرة (بدل increment) لتفادي أي تكرار عد أو تعارض سباق.
-- ------------------------------------------------------------
create or replace function recalc_enrollment_gamification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_course_id uuid;
  v_total_assignments int;
  v_completed int;
  v_bonus_xp numeric;
  v_progress int;
  v_last_date date;
  v_streak int;
  v_today date := current_date;
begin
  select a.course_id into v_course_id from assignments a where a.id = new.assignment_id;
  if v_course_id is null then return new; end if;

  select count(*) into v_total_assignments from assignments where course_id = v_course_id;

  select count(distinct s.assignment_id) into v_completed
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = new.profile_id and a.course_id = v_course_id
    and s.status in ('submitted','late','reviewed');

  select coalesce(sum(s.grade),0) into v_bonus_xp
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = new.profile_id and a.course_id = v_course_id and s.status = 'reviewed';

  v_progress := case when v_total_assignments > 0
    then round((v_completed::numeric / v_total_assignments) * 100) else 0 end;

  select last_activity_date into v_last_date
  from enrollments where profile_id = new.profile_id and course_id = v_course_id;

  select streak into v_streak
  from enrollments where profile_id = new.profile_id and course_id = v_course_id;
  v_streak := coalesce(v_streak, 0);

  if TG_OP = 'INSERT' then
    if v_last_date is null or v_last_date < v_today - 1 then
      v_streak := 1;
    elsif v_last_date = v_today - 1 then
      v_streak := v_streak + 1;
    end if; -- v_last_date = v_today: بدون تغيير (نفس اليوم)
    v_last_date := v_today;
  end if;

  update enrollments
  set xp = (v_completed * 10) + v_bonus_xp,
      progress = v_progress,
      completed_count = v_completed,
      streak = v_streak,
      last_activity_date = v_last_date,
      status = case
        when v_progress >= 70 then 'on_track'
        when v_progress >= 30 then 'at_risk'
        else 'behind'
      end
  where profile_id = new.profile_id and course_id = v_course_id;

  return new;
end;
$$;

drop trigger if exists trg_recalc_gamification_ins on submissions;
create trigger trg_recalc_gamification_ins
  after insert on submissions
  for each row execute procedure recalc_enrollment_gamification();

drop trigger if exists trg_recalc_gamification_upd on submissions;
create trigger trg_recalc_gamification_upd
  after update of status, grade on submissions
  for each row execute procedure recalc_enrollment_gamification();

-- ------------------------------------------------------------
-- 3) Backfill: احسب القيم الصحيحة لكل enrollment موجود حاليًا
--    (بدل ما تضل 0 لحد أول تسليم جديد). دالة مساعدة أولًا،
--    ثم تُشغَّل مرة وحدة على كل enrollment موجود.
-- ------------------------------------------------------------
create or replace function recalc_enrollment_gamification_backfill(p_profile_id uuid, p_course_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total_assignments int;
  v_completed int;
  v_bonus_xp numeric;
  v_progress int;
begin
  select count(*) into v_total_assignments from assignments where course_id = p_course_id;

  select count(distinct s.assignment_id) into v_completed
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = p_profile_id and a.course_id = p_course_id
    and s.status in ('submitted','late','reviewed');

  select coalesce(sum(s.grade),0) into v_bonus_xp
  from submissions s join assignments a on a.id = s.assignment_id
  where s.profile_id = p_profile_id and a.course_id = p_course_id and s.status = 'reviewed';

  v_progress := case when v_total_assignments > 0
    then round((v_completed::numeric / v_total_assignments) * 100) else 0 end;

  update enrollments
  set xp = (v_completed * 10) + v_bonus_xp,
      progress = v_progress,
      completed_count = v_completed,
      status = case
        when v_progress >= 70 then 'on_track'
        when v_progress >= 30 then 'at_risk'
        else 'behind'
      end
  where profile_id = p_profile_id and course_id = p_course_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in select distinct profile_id, course_id from enrollments loop
    perform recalc_enrollment_gamification_backfill(r.profile_id, r.course_id);
  end loop;
end $$;

-- ============================================================
-- تمّ. من الآن: كل تسليم جديد يحدّث XP/التقدم/الحالة فورًا،
-- وأي تسليم بعد الموعد النهائي يُعلَّم "متأخر" تلقائيًا.
-- ملاحظة: streak محسوب فقط للأمام (من تاريخ تشغيل هذا الملف)،
-- لأن معرفة الأيام المتتالية الفعلية تاريخيًا تحتاج بيانات لا
-- نملكها بدقة (تاريخ كل submitted_at بالتقويم اليومي الفعلي).
-- ============================================================
