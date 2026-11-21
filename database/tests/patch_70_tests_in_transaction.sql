-- ════════════════════════════════════════════════════════════════════
-- اختبارات patch 70 (المواد المشتركة) — داخل معاملة تنتهي بـ RAISE EXCEPTION فتتراجع كل الكتابات.
-- تفترض أن patch 70 مطبَّق. لتجربته قبل التطبيق: ألصق متن الـ migration (بلا begin/commit) ثم هذا الملف
-- في استعلام واحد؛ التراجع يشمل الـ DDL أيضًا.
-- ⚠️ المعرّفات خاصة بمشروع Supabase الحي hodjfdhapxnygrnzoggr (جامعتا أم درمان والخرطوم، ومستخدم عادي/سوبر).
-- النتيجة تظهر في نص الخطأ الأخير (PASS/FAIL لكل بند).
-- ════════════════════════════════════════════════════════════════════
do $t$
declare
  r text := '';
  umd uuid := 'fc82a45f-ca0c-4d79-981c-802e3f7a8182';
  khr uuid := '9490e3e3-8e10-4408-ba71-c27f360d0777';
  nrm uuid := '23d9cb99-d72f-49e1-885c-0e0b23ea7f4b';
  n int; n2 int; rc int; res text;
  topics_b int; owners_b int; mats_b int;
  it_prog uuid; it_y9 uuid; it_s1 uuid; it_s2 uuid;
  cs_prog uuid; cs_y1 uuid; cs_s1 uuid; cs_s2 uuid;
  khr_sem uuid; nul_sem uuid;
  sub_a uuid; sub_b uuid; sub_c uuid; sub_n uuid;
begin
  select count(*) into topics_b from public.archive_topics;
  select count(*) into owners_b from public.telegram_resource_owners;
  select count(*) into mats_b   from public.university_materials;

  -- ── A) سلامة الترحيل ───────────────────────────────────────────────
  select count(*) into n from public.university_subjects;
  select count(*) into n2 from public.university_subject_placements where is_primary;
  r := r || 'A1 subjects='||n||' primary placements='||n2||': '||case when n=n2 then 'PASS' else 'FAIL' end||E'\n';
  select count(*) into n from public.university_subject_placements pl join public.university_subjects s on s.id=pl.subject_id where pl.is_primary and pl.semester_id<>s.semester_id;
  r := r || 'A2 primary placement == subjects.semester_id (mismatch='||n||'): '||case when n=0 then 'PASS' else 'FAIL' end||E'\n';
  select count(*) into n from (select * from public.university_subjects_backup_20261121 except select * from public.university_subjects) x;
  select count(*) into n2 from (select * from public.university_subjects except select * from public.university_subjects_backup_20261121) x;
  r := r || 'A3 subjects identical to backup (diff '||n||'/'||n2||'): '||case when n=0 and n2=0 then 'PASS' else 'FAIL' end||E'\n';
  r := r || 'A4 materials='||mats_b||' (expected 212 in production): '||case when mats_b=212 then 'PASS' else 'CHECK' end||E'\n';
  select count(*) into n from pg_trigger where tgname in ('university_materials_tg_cleanup','university_subjects_topic_cleanup','university_years_create_semesters') and not tgisinternal;
  r := r || 'A5 existing Telegram/semester triggers still present ('||n||'/3): '||case when n=3 then 'PASS' else 'FAIL' end||E'\n';
  select count(*) into n from (select semester_id, count(*) from public.university_subjects group by 1
      except select semester_id, count(*) from public.university_subjects_backup_20261121 group by 1) x;
  r := r || 'A6 per-semester subject counts (student read path) unchanged: '||case when n=0 then 'PASS' else 'FAIL' end||E'\n';

  -- ── B) بيانات مؤقتة: قسم CS وسنة IT مؤقتة (الفصول تُنشأ بتريغر السنة) ────
  select id into it_prog from public.university_programs where university_id=umd and name='IT';
  insert into public.university_programs(university_id,name,slug,order_index) values (umd,'CS-T','cs-t',90) returning id into cs_prog;
  insert into public.university_years(program_id,year_number) values (cs_prog,1) returning id into cs_y1;
  insert into public.university_years(program_id,year_number) values (it_prog,9) returning id into it_y9;
  select id into cs_s1 from public.university_semesters where year_id=cs_y1 order by semester_number limit 1;
  select id into cs_s2 from public.university_semesters where year_id=cs_y1 order by semester_number offset 1 limit 1;
  select id into it_s1 from public.university_semesters where year_id=it_y9 order by semester_number limit 1;
  select id into it_s2 from public.university_semesters where year_id=it_y9 order by semester_number offset 1 limit 1;
  r := r || 'B0 temp semesters created by trigger: '||case when cs_s1 is not null and cs_s2 is not null and it_s1 is not null and it_s2 is not null then 'PASS' else 'FAIL (no semesters)' end||E'\n';

  -- B1: المسار القديم للواجهة (إنشاء مادة عبر semester_id) ينشئ الموضع الأساسي
  begin
    insert into public.university_subjects(semester_id,title,order_index) values (it_s1,'T-shared',1) returning id into sub_a;
    select count(*) into n from public.university_subject_placements where subject_id=sub_a and is_primary and program_id=it_prog and semester_id=it_s1;
    r := r || 'B1 old UI insert creates primary placement: '||case when n=1 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B1 FAIL: '||sqlerrm||E'\n'; end;
  insert into public.university_materials(subject_id,title,url,material_type,order_index) values (sub_a,'m1','https://example.com/a','link',1);

  -- B2: مشاركة المادة مع قسم آخر دون نسخ
  begin
    perform public.university_subject_set_placement(sub_a, cs_s2);
    select count(*) into n from public.university_subject_placements where subject_id=sub_a;
    select count(*) into n2 from public.university_subjects where title='T-shared';
    select count(*) into rc from public.university_materials where subject_id=sub_a;
    r := r || 'B2 shared into 2nd department: placements='||n||', subject rows='||n2||', materials='||rc||': '||case when n=2 and n2=1 and rc=1 then 'PASS (no duplication)' else 'FAIL' end||E'\n';
    select count(*) into n from public.university_subject_placements pl where pl.subject_id=sub_a and pl.semester_id in (it_s1, cs_s2);
    r := r || 'B2b appears in both semesters via placements: '||case when n=2 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B2 FAIL: '||sqlerrm||E'\n'; end;

  -- B3: استقلال السنة والفصل لكل قسم
  begin
    perform public.university_subject_set_placement(sub_a, cs_s1);   -- نقل موضع CS فقط
    select count(*) into n from public.university_subject_placements where subject_id=sub_a and program_id=it_prog and semester_id=it_s1 and is_primary;
    select count(*) into n2 from public.university_subject_placements where subject_id=sub_a and program_id=cs_prog and semester_id=cs_s1 and not is_primary;
    r := r || 'B3 moving CS placement leaves IT placement untouched: '||case when n=1 and n2=1 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B3 FAIL: '||sqlerrm||E'\n'; end;

  -- B4/B5: قيود التفرد
  begin
    insert into public.university_subject_placements(subject_id,semester_id) values (sub_a, cs_s2);
    r := r || 'B4 same subject twice in same department: FAIL (allowed)'||E'\n';
  exception when unique_violation then r := r || 'B4 same subject twice in same department blocked: PASS'||E'\n'; end;
  begin
    update public.university_subject_placements set is_primary=true where subject_id=sub_a and program_id=cs_prog;
    r := r || 'B5 two primaries: FAIL (allowed)'||E'\n';
  exception when unique_violation then r := r || 'B5 two primaries blocked: PASS'||E'\n'; end;

  -- B6: خارج الجامعة
  begin
    select s.id into khr_sem from public.university_semesters s where s.university_id=khr and s.year_id is not null limit 1;
    insert into public.university_subject_placements(subject_id,semester_id) values (sub_a, khr_sem);
    r := r || 'B6 cross-university placement: FAIL (allowed)'||E'\n';
  exception when sqlstate '23514' then r := r || 'B6 cross-university placement blocked: PASS'||E'\n'; end;

  -- B7: فصل بلا سنة (قديم): الموضع ممنوع، لكن إنشاء المادة بالمسار القديم لا ينكسر
  begin
    insert into public.university_semesters(title,order_index,university_id,year_id,semester_number) values ('null-year',0,umd,null,99) returning id into nul_sem;
    begin
      perform public.university_subject_set_placement(sub_a, nul_sem);
      r := r || 'B7a placement into year-less semester: FAIL (allowed)'||E'\n';
    exception when sqlstate '23503' then r := r || 'B7a placement into year-less semester blocked: PASS'||E'\n'; end;
    insert into public.university_subjects(semester_id,title,order_index) values (nul_sem,'T-nullyear',1) returning id into sub_n;
    select count(*) into n from public.university_subject_placements where subject_id=sub_n;
    r := r || 'B7b old UI insert into year-less semester still works (no placement): '||case when n=0 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B7 FAIL: '||sqlerrm||E'\n'; end;

  -- B8: إزالة قسم غير أساسي لا تحذف المادة ولا تؤثر على القسم الآخر
  begin
    res := public.university_subject_remove_placement(sub_a, cs_s1);
    select count(*) into n from public.university_subjects where id=sub_a;
    select count(*) into n2 from public.university_subject_placements where subject_id=sub_a and is_primary and semester_id=it_s1;
    select count(*) into rc from public.university_materials where subject_id=sub_a;
    r := r || 'B8 remove non-primary ('||res||'): subject kept='||n||', IT placement kept='||n2||', materials='||rc||': '||case when res='removed' and n=1 and n2=1 and rc=1 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B8 FAIL: '||sqlerrm||E'\n'; end;

  -- B9: لا تُزال آخر مواضع المادة
  begin
    perform public.university_subject_remove_placement(sub_a, it_s1);
    r := r || 'B9 remove last placement: FAIL (allowed)'||E'\n';
  exception when sqlstate '23514' then r := r || 'B9 remove last placement refused: PASS'||E'\n'; end;

  -- B10: إزالة الموضع الأساسي ترقّي موضعًا آخر
  begin
    perform public.university_subject_set_placement(sub_a, cs_s2);
    res := public.university_subject_remove_placement(sub_a, it_s1);
    select count(*) into n from public.university_subjects where id=sub_a and semester_id=cs_s2;
    select count(*) into n2 from public.university_subject_placements where subject_id=sub_a and is_primary and semester_id=cs_s2;
    select count(*) into rc from public.university_materials where subject_id=sub_a;
    r := r || 'B10 remove primary ('||res||'): home moved='||n||', promoted='||n2||', materials='||rc||': '||case when res='removed_primary_promoted' and n=1 and n2=1 and rc=1 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B10 FAIL: '||sqlerrm||E'\n'; end;

  -- B11: حذف فصل: المادة المشتركة تنجو، وغير المشتركة تُحذف كالسابق
  begin
    perform public.university_subject_set_placement(sub_a, it_s2);
    insert into public.university_subjects(semester_id,title,order_index) values (cs_s2,'T-only-cs',2) returning id into sub_b;
    delete from public.university_semesters where id = cs_s2;
    select count(*) into n from public.university_subjects where id=sub_a and semester_id=it_s2;
    select count(*) into n2 from public.university_subjects where id=sub_b;
    select count(*) into rc from public.university_materials where subject_id=sub_a;
    r := r || 'B11 delete home semester: shared subject kept (moved)='||n||', non-shared removed='||(1-n2)||', shared materials='||rc||': '||case when n=1 and n2=0 and rc=1 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B11 FAIL: '||sqlerrm||E'\n'; end;

  -- B12: مزامنة الواجهة القديمة (ترتيب/نقل المادة)
  begin
    insert into public.university_subjects(semester_id,title,order_index) values (it_s1,'T-sync',5) returning id into sub_c;
    update public.university_subjects set order_index=77 where id=sub_c;
    select count(*) into n from public.university_subject_placements where subject_id=sub_c and is_primary and order_index=77;
    update public.university_subjects set semester_id=it_s2 where id=sub_c;
    select count(*) into n2 from public.university_subject_placements where subject_id=sub_c and is_primary and semester_id=it_s2;
    r := r || 'B12 old-UI order/move syncs primary placement: '||case when n=1 and n2=1 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B12 FAIL: '||sqlerrm||E'\n'; end;

  -- B13: إعادة تشغيل الترحيل لا تضيف شيئًا (idempotent)
  begin
    insert into public.university_subject_placements (subject_id, semester_id, is_primary, order_index)
    select sub.id, sub.semester_id, true, sub.order_index
      from public.university_subjects sub join public.university_semesters s on s.id = sub.semester_id and s.year_id is not null
    on conflict (subject_id, program_id) do nothing;
    get diagnostics rc = row_count;
    r := r || 'B13 re-running backfill inserts '||rc||' rows: '||case when rc=0 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B13 FAIL: '||sqlerrm||E'\n'; end;

  -- B14: حذف مادة يحذف مواضعها وملفاتها فقط
  begin
    delete from public.university_subjects where id=sub_a;
    select count(*) into n from public.university_subject_placements where subject_id=sub_a;
    select count(*) into n2 from public.university_materials where subject_id=sub_a;
    r := r || 'B14 delete subject cascades placements/materials ('||n||'/'||n2||'): '||case when n=0 and n2=0 then 'PASS' else 'FAIL' end||E'\n';
  exception when others then r := r || 'B14 FAIL: '||sqlerrm||E'\n'; end;

  -- ── C) RLS والصلاحيات ──────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',nrm,'role','authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.university_subject_placements;
    r := r || 'C1 normal user can read placements ('||n||'): '||case when n>0 then 'PASS' else 'FAIL' end||E'\n';
    begin
      insert into public.university_subject_placements(subject_id,semester_id) values (sub_c, it_s1);
      r := r || 'C2 normal user INSERT: FAIL (allowed)'||E'\n';
    exception when others then r := r || 'C2 normal user INSERT blocked ('||sqlstate||'): PASS'||E'\n'; end;
    begin
      perform public.university_subject_set_placement(sub_c, it_s1);
      r := r || 'C3 normal user RPC set_placement: FAIL (allowed)'||E'\n';
    exception when others then r := r || 'C3 normal user RPC blocked ('||sqlstate||'): PASS'||E'\n'; end;
    reset role;
  exception when others then reset role; r := r || 'C error: '||sqlerrm||E'\n'; end;

  begin
    insert into public.university_admins(university_id, profile_id, role) values (umd, nrm, 'admin');
    perform set_config('request.jwt.claims', json_build_object('sub',nrm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.university_subject_set_placement(sub_c, it_s1);   -- نفس القسم: نقل الموضع الأساسي
    select count(*) into n from public.university_subject_placements where subject_id=sub_c and semester_id=it_s1 and is_primary;
    r := r || 'C4 university admin can manage placements of own university: '||case when n=1 then 'PASS' else 'FAIL' end||E'\n';
    begin
      insert into public.university_subject_placements(subject_id,semester_id) values (sub_c, khr_sem);
      r := r || 'C5 university admin cross-university: FAIL (allowed)'||E'\n';
    exception when others then r := r || 'C5 university admin cross-university blocked ('||sqlstate||'): PASS'||E'\n'; end;
    reset role;
  exception when others then reset role; r := r || 'C4/C5 error: '||sqlerrm||E'\n'; end;

  begin
    perform set_config('request.jwt.claims', '', true);   -- مسح claims المستخدم السابق وإلا يبقى auth.uid() ساريًا
    set local role anon;
    select count(*) into n from public.university_subject_placements;
    r := r || 'C6 anon sees '||n||' rows: '||case when n=0 then 'PASS' else 'FAIL' end||E'\n';
    reset role;
  exception when others then reset role; r := r || 'C6 anon blocked ('||sqlstate||'): PASS'||E'\n'; end;

  -- ── D) لم يتأثر Telegram ولا الملفات ───────────────────────────────
  select count(*) into n from public.archive_topics;
  select count(*) into n2 from public.telegram_resource_owners;
  select count(*) into rc from public.university_materials;
  r := r || 'D1 archive_topics '||topics_b||'->'||n||', telegram_resource_owners '||owners_b||'->'||n2||', materials '||mats_b||'->'||rc||': '||case when n=topics_b and n2=owners_b and rc=mats_b then 'PASS' else 'FAIL' end||E'\n';

  raise exception E'\n%', r;   -- يُفرض التراجع دائمًا
end $t$;
