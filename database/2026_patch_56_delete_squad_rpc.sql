-- 2026_patch_56_delete_squad_rpc.sql
-- (طُبّق مسبقًا على قاعدة البيانات بتاريخ 2026-10-01 — الملف للأرشفة، وإعادة تشغيله آمنة)
-- حذف مجموعة نهائيًا: يتحقق من صلاحية أدمن الكورس واسم التأكيد، ويرفض الحذف لو فيه واجبات خاصة بالمجموعة.
create or replace function public.delete_squad_permanently(p_squad_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_squad squads;
  v_blocking int;
begin
  select * into v_squad from squads where id = p_squad_id;
  if v_squad is null then raise exception 'المجموعة غير موجودة'; end if;
  if not is_course_admin(auth.uid(), v_squad.course_id) then
    raise exception 'صلاحية أدمن الكورس مطلوبة لحذف مجموعة';
  end if;
  if trim(v_squad.name) <> trim(coalesce(p_confirm_name, '')) then
    raise exception 'اسم التأكيد غير مطابق لاسم المجموعة';
  end if;

  select (select count(*) from assignments where squad_id = p_squad_id)
       + (select count(*) from assignment_squads a
            where a.squad_id = p_squad_id
              and not exists (select 1 from assignment_squads b
                              where b.assignment_id = a.assignment_id and b.squad_id <> p_squad_id))
    into v_blocking;
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف المجموعة لأنها مرتبطة بـ % واجب(ات) خاصة بها. احذف تلك الواجبات أو انقلها لمجموعة أخرى، أو اجعل المجموعة "مؤرشفة" بدل الحذف.', v_blocking;
  end if;

  update squad_proposals set resulting_squad_id = null where resulting_squad_id = p_squad_id;
  perform log_activity(v_squad.course_id, auth.uid(), 'حذف المجموعة: ' || v_squad.name);
  delete from squads where id = p_squad_id;
end;
$$;

revoke execute on function public.delete_squad_permanently(uuid, text) from public, anon;
grant execute on function public.delete_squad_permanently(uuid, text) to authenticated;
