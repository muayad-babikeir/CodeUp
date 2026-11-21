-- ════════════════════════════════════════════════════════════════════
-- Patch 70 — المواد المشتركة بين أقسام الجامعة الواحدة (المرحلة 1: قاعدة البيانات فقط)
-- ════════════════════════════════════════════════════════════════════
-- الفكرة: المادة سجل واحد (university_subjects) + عدة «مواضع ظهور» (university_subject_placements)
--   كل موضع = قسم + فصل (والفصل يحدد السنة). ملفات المادة (university_materials.subject_id) مشتركة تلقائيًا.
-- التوافق: university_subjects.semester_id يبقى «الموضع الأساسي» (يعتمد عليه Telegram وRLS وتطبيق الطالب).
--   تريغرات المزامنة تبقي الواجهة الحالية تعمل دون أي تعديل (إنشاء مادة عبر semester_id يُنشئ موضعها الأساسي).
-- قواعد:
--   • المشاركة داخل الجامعة الواحدة فقط (تريغر).
--   • المادة تظهر مرة واحدة في كل قسم، بسنة/فصل مستقلين لكل قسم (unique subject+program).
--   • إزالة قسم لا تحذف المادة؛ إزالة الأساسي تُرقّي موضعًا آخر؛ لا تُزال آخر مواضع المادة.
--   • حذف فصل يُرقّي موضعًا آخر للمواد المشتركة قبل الحذف المتسلسل (حماية المحتوى المشترك).
-- لا يحذف أي بيانات. نسخة احتياطية: university_subjects_backup_20261121. Idempotent.
--
-- Rollback في آخر الملف.
-- ════════════════════════════════════════════════════════════════════

begin;

-- 0) نسخة احتياطية (جدول جديد، RLS مفعّل بلا سياسات)
do $$
begin
  if to_regclass('public.university_subjects_backup_20261121') is null then
    execute 'create table public.university_subjects_backup_20261121 as table public.university_subjects';
    execute 'alter table public.university_subjects_backup_20261121 enable row level security';
  end if;
end $$;

-- 1) الجدول
create table if not exists public.university_subject_placements (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.university_subjects(id)  on delete cascade,
  semester_id uuid not null references public.university_semesters(id) on delete cascade,
  program_id  uuid not null references public.university_programs(id)  on delete cascade,
  is_primary  boolean not null default false,
  order_index integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint uq_subject_placement_program unique (subject_id, program_id)
);
create unique index if not exists uq_subject_placement_primary
  on public.university_subject_placements (subject_id) where is_primary;
create index if not exists idx_subject_placements_semester
  on public.university_subject_placements (semester_id, order_index);

alter table public.university_subject_placements enable row level security;

-- 2) تريغر التحضير والتحقق (يحسب program_id ويمنع الخروج عن الجامعة)
create or replace function public.trg_subject_placement_prepare()
returns trigger language plpgsql set search_path = public as $$
declare v_prog uuid; v_univ uuid; v_home_univ uuid;
begin
  select s.university_id, p.id into v_univ, v_prog
    from public.university_semesters s
    join public.university_years y    on y.id = s.year_id
    join public.university_programs p on p.id = y.program_id
   where s.id = new.semester_id;
  if v_prog is null then
    raise exception 'الفصل غير موجود أو غير مرتبط بسنة وقسم' using errcode = '23503';
  end if;
  select s.university_id into v_home_univ
    from public.university_subjects sub join public.university_semesters s on s.id = sub.semester_id
   where sub.id = new.subject_id;
  if v_home_univ is distinct from v_univ then
    raise exception 'لا يمكن مشاركة المادة إلا بين أقسام الجامعة نفسها' using errcode = '23514';
  end if;
  new.program_id := v_prog;
  return new;
end $$;
revoke all on function public.trg_subject_placement_prepare() from public, anon, authenticated;

-- 3) مزامنة: الموضع الأساسي ← university_subjects.semester_id
create or replace function public.trg_subject_placement_sync_home()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.university_subjects
     set semester_id = new.semester_id
   where id = new.subject_id and semester_id is distinct from new.semester_id;
  return null;
end $$;
revoke all on function public.trg_subject_placement_sync_home() from public, anon, authenticated;

-- 4) مزامنة: university_subjects ← الموضع الأساسي (يبقي الواجهة الحالية تعمل)
create or replace function public.trg_subject_sync_primary_placement()
returns trigger language plpgsql set search_path = public as $$
declare v_has_year boolean;
begin
  if tg_op = 'INSERT' then
    select (year_id is not null) into v_has_year from public.university_semesters where id = new.semester_id;
    if coalesce(v_has_year, false) then
      insert into public.university_subject_placements (subject_id, semester_id, is_primary, order_index)
      values (new.id, new.semester_id, true, new.order_index)
      on conflict (subject_id, program_id) do nothing;
    end if;
    return null;
  end if;
  -- UPDATE
  if new.semester_id is distinct from old.semester_id then
    update public.university_subject_placements
       set semester_id = new.semester_id
     where subject_id = new.id and is_primary and semester_id is distinct from new.semester_id;
  end if;
  if new.order_index is distinct from old.order_index then
    update public.university_subject_placements
       set order_index = new.order_index
     where subject_id = new.id and is_primary;
  end if;
  return null;
end $$;
revoke all on function public.trg_subject_sync_primary_placement() from public, anon, authenticated;

-- 5) حماية المحتوى المشترك قبل حذف فصل: يُرقّى موضع آخر للمادة المشتركة بدل أن تُحذف بالتسلسل
create or replace function public.trg_semester_protect_shared_subjects()
returns trigger language plpgsql set search_path = public as $$
declare r record; v_np uuid;
begin
  for r in select id from public.university_subjects where semester_id = old.id loop
    select id into v_np from public.university_subject_placements
     where subject_id = r.id and semester_id <> old.id
     order by order_index, created_at limit 1;
    if v_np is not null then
      delete from public.university_subject_placements where subject_id = r.id and semester_id = old.id;
      update public.university_subject_placements set is_primary = true where id = v_np;  -- المزامنة تنقل semester_id للمادة
    end if;
  end loop;
  return old;
end $$;
revoke all on function public.trg_semester_protect_shared_subjects() from public, anon, authenticated;

-- 6) الـ triggers (بلا DROP: تُنشأ فقط إن لم تكن موجودة)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'subject_placements_prepare' and tgrelid = 'public.university_subject_placements'::regclass) then
    create trigger subject_placements_prepare
      before insert or update of semester_id, subject_id on public.university_subject_placements
      for each row execute function public.trg_subject_placement_prepare();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'subject_placements_sync_home' and tgrelid = 'public.university_subject_placements'::regclass) then
    create trigger subject_placements_sync_home
      after insert or update of is_primary, semester_id on public.university_subject_placements
      for each row when (new.is_primary) execute function public.trg_subject_placement_sync_home();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'university_subjects_sync_placement' and tgrelid = 'public.university_subjects'::regclass) then
    create trigger university_subjects_sync_placement
      after insert or update of semester_id, order_index on public.university_subjects
      for each row execute function public.trg_subject_sync_primary_placement();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'university_semesters_protect_shared' and tgrelid = 'public.university_semesters'::regclass) then
    create trigger university_semesters_protect_shared
      before delete on public.university_semesters
      for each row execute function public.trg_semester_protect_shared_subjects();
  end if;
end $$;

-- 7) RLS (نفس نمط جداول الجامعة: قراءة لأي مستخدم مسجّل، والإدارة لأدمن الجامعة)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='university_subject_placements' and policyname='university_subject_placements: قراءة لأي مستخدم مسجّل') then
    create policy "university_subject_placements: قراءة لأي مستخدم مسجّل"
      on public.university_subject_placements for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='university_subject_placements' and policyname='university_subject_placements: أدمن الجامعة يدير') then
    create policy "university_subject_placements: أدمن الجامعة يدير"
      on public.university_subject_placements for all
      using (exists (select 1 from public.university_semesters s where s.id = university_subject_placements.semester_id
                      and public.is_university_admin(auth.uid(), s.university_id)))
      with check (exists (select 1 from public.university_semesters s where s.id = university_subject_placements.semester_id
                      and public.is_university_admin(auth.uid(), s.university_id)));
  end if;
end $$;

-- 8) دوال الإدارة (SECURITY INVOKER: تحترم RLS؛ لا تُمنح لـ anon)
create or replace function public.university_subject_set_placement(p_subject uuid, p_semester uuid, p_order integer default null)
returns uuid language plpgsql set search_path = public as $$
declare v_prog uuid; v_id uuid;
begin
  select p.id into v_prog
    from public.university_semesters s
    join public.university_years y on y.id = s.year_id
    join public.university_programs p on p.id = y.program_id
   where s.id = p_semester;
  if v_prog is null then
    raise exception 'الفصل غير موجود أو غير مرتبط بسنة وقسم' using errcode = '23503';
  end if;
  -- المادة موجودة أصلًا في هذا القسم → نغيّر سنتها/فصلها فقط
  update public.university_subject_placements
     set semester_id = p_semester, order_index = coalesce(p_order, order_index)
   where subject_id = p_subject and program_id = v_prog
   returning id into v_id;
  if v_id is null then
    insert into public.university_subject_placements (subject_id, semester_id, is_primary, order_index)
    values (p_subject, p_semester, false, coalesce(p_order, 0))
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.university_subject_remove_placement(p_subject uuid, p_semester uuid)
returns text language plpgsql set search_path = public as $$
declare v_pl public.university_subject_placements; v_cnt int; v_np uuid;
begin
  select * into v_pl from public.university_subject_placements
   where subject_id = p_subject and semester_id = p_semester for update;
  if not found then
    raise exception 'هذا الارتباط غير موجود أو لا تملك صلاحية تعديله';
  end if;
  select count(*) into v_cnt from public.university_subject_placements where subject_id = p_subject;
  if v_cnt <= 1 then
    raise exception 'لا يمكن إزالة آخر قسم للمادة. احذف المادة نفسها إن أردت' using errcode = '23514';
  end if;
  delete from public.university_subject_placements where id = v_pl.id;
  if v_pl.is_primary then
    select id into v_np from public.university_subject_placements
     where subject_id = p_subject order by order_index, created_at limit 1;
    update public.university_subject_placements set is_primary = true where id = v_np;
    return 'removed_primary_promoted';
  end if;
  return 'removed';
end $$;

revoke all on function public.university_subject_set_placement(uuid, uuid, integer) from public, anon;
revoke all on function public.university_subject_remove_placement(uuid, uuid) from public, anon;
grant execute on function public.university_subject_set_placement(uuid, uuid, integer) to authenticated;
grant execute on function public.university_subject_remove_placement(uuid, uuid) to authenticated;

-- 9) ترحيل البيانات القديمة: كل مادة موجودة ← موضع أساسي واحد (إضافة فقط، قابل للتكرار)
insert into public.university_subject_placements (subject_id, semester_id, is_primary, order_index)
select sub.id, sub.semester_id, true, sub.order_index
  from public.university_subjects sub
  join public.university_semesters s on s.id = sub.semester_id and s.year_id is not null
on conflict (subject_id, program_id) do nothing;

-- 10) فحص ذاتي: لا مادة (ذات فصل مرتبط بسنة) بلا موضع أساسي، ولا موضع أساسي يخالف semester_id
do $$
declare n_missing int; n_mismatch int;
begin
  select count(*) into n_missing from public.university_subjects sub
   where exists (select 1 from public.university_semesters s where s.id = sub.semester_id and s.year_id is not null)
     and not exists (select 1 from public.university_subject_placements pl where pl.subject_id = sub.id and pl.is_primary);
  select count(*) into n_mismatch from public.university_subject_placements pl
    join public.university_subjects sub on sub.id = pl.subject_id
   where pl.is_primary and pl.semester_id <> sub.semester_id;
  if n_missing > 0 or n_mismatch > 0 then
    raise exception 'patch 70: فشل الفحص الذاتي (بلا موضع أساسي=%، مخالفة=%)', n_missing, n_mismatch;
  end if;
end $$;

commit;

-- ── Rollback ────────────────────────────────────────────────────────
-- يزيل نظام المشاركة فقط. المواد والملفات لا تُمس (semester_id لم يتغير). مواضع الأقسام المشتركة تُفقد.
-- drop trigger if exists university_semesters_protect_shared on public.university_semesters;
-- drop trigger if exists university_subjects_sync_placement on public.university_subjects;
-- drop function if exists public.university_subject_remove_placement(uuid, uuid);
-- drop function if exists public.university_subject_set_placement(uuid, uuid, integer);
-- drop table if exists public.university_subject_placements;   -- (يحذف الـ triggers المرتبطة به)
-- drop function if exists public.trg_semester_protect_shared_subjects();
-- drop function if exists public.trg_subject_sync_primary_placement();
-- drop function if exists public.trg_subject_placement_sync_home();
-- drop function if exists public.trg_subject_placement_prepare();
-- النسخة الاحتياطية: public.university_subjects_backup_20261121
