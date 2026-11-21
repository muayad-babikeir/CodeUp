-- ════════════════════════════════════════════════════════════════════
-- Patch 67 — السماح بعدة مجموعات Telegram للجامعة الواحدة
-- ════════════════════════════════════════════════════════════════════
-- المشكلة: duplicate key value violates unique constraint "uq_archive_destinations_university"
-- السبب: فهرس فريد على (university_id) NULLS NOT DISTINCT موجود في القاعدة الحية فقط (drift؛
--        لا يوجد في أي ملف SQL) فيحصر الجامعة بمجموعة واحدة، مع أن التصميم (patch 61) = مجموعة لكل سنة.
-- الحل:  حذف الفهرس الخاطئ فقط، وتعويض ما كان يحميه بقيود دقيقة:
--   1) telegram_chat_id فريد عالميًا (كان بلا أي قيد).
--   2) صف عام واحد نشط (بلا جامعة وبلا سنة) — تعتمد عليه Edge Functions بـ limit(1).
--   3) مجموعة احتياطية نشطة واحدة لكل جامعة (بلا سنة) — يعتمد عليها telegram-upload-resource.
--   4) تريغر يضمن تطابق university_id مع جامعة السنة المرتبطة.
-- باقي القيود تبقى كما هي: archive_destinations_year_active_key (مجموعة نشطة لكل سنة)،
--   archive_destinations_serial_key (كود تعريفي فريد lower())، FKs، RLS.
-- Idempotent. لا DROP TABLE ولا حذف بيانات.
--
-- Rollback (في آخر الملف).
-- ════════════════════════════════════════════════════════════════════

begin;

-- 0) نسخة احتياطية (جدول جديد، RLS مفعّل بلا سياسات = لا وصول للعميل)
do $$
begin
  if to_regclass('public.archive_destinations_backup_20261116') is null then
    execute 'create table public.archive_destinations_backup_20261116 as table public.archive_destinations';
    execute 'alter table public.archive_destinations_backup_20261116 enable row level security';
  end if;
end $$;

-- 1) فحص مسبق: لا تكرار في Chat IDs (وإلا نوقف المهاجرة بدل أن نخمّن)
do $$
begin
  if exists (select 1 from public.archive_destinations group by telegram_chat_id having count(*) > 1) then
    raise exception 'patch 67: توجد Chat IDs مكررة في archive_destinations — عالجها يدويًا أولًا';
  end if;
end $$;

-- 2) إزالة القيد الذي يمنع التعدد
drop index if exists public.uq_archive_destinations_university;

-- 3) قيود التفرد الصحيحة
create unique index if not exists archive_destinations_chat_id_key
  on public.archive_destinations (telegram_chat_id);

create unique index if not exists archive_destinations_global_active_key
  on public.archive_destinations ((1))
  where university_id is null and year_id is null and is_active;

create unique index if not exists archive_destinations_uni_fallback_active_key
  on public.archive_destinations (university_id)
  where university_id is not null and year_id is null and is_active;

-- 4) اتساق الجامعة مع السنة
create or replace function public.trg_archive_destination_check_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_uni uuid;
begin
  if new.year_id is not null then
    select p.university_id into v_uni
      from public.university_years y
      join public.university_programs p on p.id = y.program_id
     where y.id = new.year_id;
    if v_uni is null then
      raise exception 'السنة الدراسية غير موجودة أو غير مرتبطة بجامعة' using errcode = '23503';
    end if;
    if new.university_id is distinct from v_uni then
      raise exception 'الجامعة لا تطابق جامعة السنة الدراسية المختارة' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.trg_archive_destination_check_scope() from public, anon, authenticated;

drop trigger if exists archive_destinations_check_scope on public.archive_destinations;
create trigger archive_destinations_check_scope
  before insert or update of university_id, year_id on public.archive_destinations
  for each row execute function public.trg_archive_destination_check_scope();

commit;

-- ── Rollback ────────────────────────────────────────────────────────
-- (يعمل فقط إن كانت كل جامعة بصف واحد على الأكثر)
-- drop trigger if exists archive_destinations_check_scope on public.archive_destinations;
-- drop function if exists public.trg_archive_destination_check_scope();
-- drop index if exists public.archive_destinations_uni_fallback_active_key;
-- drop index if exists public.archive_destinations_global_active_key;
-- drop index if exists public.archive_destinations_chat_id_key;
-- create unique index uq_archive_destinations_university on public.archive_destinations (university_id) nulls not distinct;
-- البيانات الأصلية محفوظة في public.archive_destinations_backup_20261116
