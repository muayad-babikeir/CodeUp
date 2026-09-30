// admin/js/audit.js

Admin.sections.files = {
  label: "الملفات والأرشفة",
  async render(body){
    const cid = Admin.currentCourseId;
    const isSuper = Admin.role === "super";
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w60" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;

    // إعدادات المدة (عامة + خاصة بهذا الكورس)
    const [{ data: settings, error: e1 }, { data: files, error: e2 }] = await Promise.all([
      db.from("archive_settings").select("*").in("scope_type", isSuper?["global","course"]:["course"]).or(cid?`scope_id.eq.${cid},scope_id.is.null`:"scope_id.is.null"),
      db.from("file_uploads").select("*, profiles(full_name)").eq("course_id", cid).eq("related_type","submission").order("created_at",{ascending:false}).limit(60)
    ]);
    if(e1 || e2){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل بيانات الأرشفة.</span><button class="btn alertRetry" id="filesRetry">إعادة المحاولة</button></div>`; body.querySelector("#filesRetry").onclick=()=>Admin.go("files"); return; }
    const globalSetting = (settings||[]).find(s=>s.scope_type==='global');
    const courseSetting = (settings||[]).find(s=>s.scope_type==='course' && s.scope_id===cid);

    const statusLabelAr = {live:"بالتخزين — لسه ما اترسل", sending:"جارِ الإرسال…", sent:"أُرسل لتيليجرام (بالتخزين لسه)", failed:"فشل الإرسال — سيُعاد المحاولة", archived:"أُرشف (اتحذف من التخزين)"};
    const statusPillClass = {live:"neutral", sending:"pending", sent:"info", failed:"rejected", archived:"approved"};
    const failedCount = (files||[]).filter(f=>f.archive_status==='failed').length;

    body.innerHTML = `
      ${failedCount>0?`<div class="alertBox warn"><span>يوجد ${failedCount} ملف فشل إرساله لتيليجرام — سيُعاد المحاولة تلقائيًا، أو أرشفه يدويًا بالأسفل.</span></div>`:""}
      ${isSuper?`
      <div class="card">
        <b>المدة الافتراضية لكل المنصة</b>
        <div class="row" style="margin-top:8px;gap:8px">
          <input id="globalDays" type="number" min="1" value="${globalSetting?.retention_days??7}" style="width:100px">
          <span class="small">يوم — قبل حذف نسخة Supabase (تيليجرام يحتفظ بنسخته للأبد بغض النظر)</span>
        </div>
        <button class="btn dark" id="saveGlobalBtn" style="margin-top:10px">حفظ المدة العامة</button>
      </div>`:""}

      <div class="card" style="margin-top:14px">
        <b>مدة خاصة بهذا الكورس (اختياري — تتجاوز العامة)</b>
        <div class="row" style="margin-top:8px;gap:8px">
          <input id="courseDays" type="number" min="1" placeholder="اتركه فاضي لاستخدام الإعداد العام" value="${courseSetting?.retention_days??""}" style="width:220px">
        </div>
        <button class="btn dark" id="saveCourseBtn" style="margin-top:10px">حفظ لهذا الكورس</button>
        ${courseSetting?`<button class="btn" id="clearCourseBtn" style="margin-top:10px">إلغاء التخصيص (رجوع للعام)</button>`:""}
      </div>

      <div class="card" style="margin-top:14px">
        <b>ملفات تسليمات الطلاب — الحالة</b>
        <div class="tableScroll"><table style="margin-top:10px"><thead><tr><th>الملف</th><th>رفعه</th><th>الحالة</th><th>موعد الحذف</th><th></th></tr></thead>
        <tbody>${(files||[]).map(f=>`
          <tr data-filerow="${f.id}">
            <td>${CodeUp.escapeHtml(f.file_name||"—")}</td>
            <td>${CodeUp.escapeHtml(f.profiles?.full_name||"")}</td>
            <td><span class="pill ${statusPillClass[f.archive_status]||''}">${statusLabelAr[f.archive_status]||f.archive_status}</span>${f.archive_error?`<div class="small" style="color:var(--red);margin-top:4px">${CodeUp.escapeHtml(f.archive_error)}</div>`:""}</td>
            <td class="mono small">${f.archive_status==='archived'?"—":(f.scheduled_delete_at?CodeUp.formatDate(f.scheduled_delete_at):"—")}</td>
            <td>
              ${f.archive_status!=='archived'?`<button class="btn" data-archivenow="${f.id}">أرشف الآن</button>
              <button class="btn" data-postpone="${f.id}">تأجيل</button>`:`<span class="small">—</span>`}
            </td>
          </tr>
        `).join("") || `<tr><td colspan="5"><div class="emptyStatePro"><p style="margin:0">لا توجد ملفات تسليمات بعد.</p></div></td></tr>`}
        </tbody></table></div>
      </div>`;

    const globalBtn = body.querySelector("#saveGlobalBtn");
    if(globalBtn) globalBtn.onclick = async ()=>{
      const days = parseInt(body.querySelector("#globalDays").value);
      if(!days || days<1){ CodeUp.toast("أدخل رقمًا صحيحًا أكبر من صفر","error"); return; }
      await CodeUp.withBtnLoading(globalBtn, async ()=>{
        try{
          await db.from("archive_settings").upsert({scope_type:"global", scope_id:null, retention_days:days, created_by:Admin.ctx.user.id}, {onConflict:"scope_type,scope_id"}).throwOnError();
          CodeUp.toast("تم الحفظ","success");
        }catch(e){ CodeUp.toast(e.message,"error"); }
      });
    };

    const saveCourseBtn = body.querySelector("#saveCourseBtn");
    saveCourseBtn.onclick = async ()=>{
      const val = body.querySelector("#courseDays").value.trim();
      if(!val){ CodeUp.toast("أدخل رقم أيام أو استخدم زر الإلغاء","error"); return; }
      const days = parseInt(val);
      if(!days || days<1){ CodeUp.toast("أدخل رقمًا صحيحًا أكبر من صفر","error"); return; }
      await CodeUp.withBtnLoading(saveCourseBtn, async ()=>{
        try{
          await db.from("archive_settings").upsert({scope_type:"course", scope_id:cid, retention_days:days, created_by:Admin.ctx.user.id}, {onConflict:"scope_type,scope_id"}).throwOnError();
          CodeUp.toast("تم الحفظ لهذا الكورس","success"); Admin.go("files");
        }catch(e){ CodeUp.toast(e.message,"error"); }
      });
    };

    const clearBtn = body.querySelector("#clearCourseBtn");
    if(clearBtn) clearBtn.onclick = async ()=>{
      await CodeUp.withBtnLoading(clearBtn, async ()=>{
        try{ await db.from("archive_settings").delete().eq("scope_type","course").eq("scope_id",cid).throwOnError(); Admin.go("files"); }
        catch(e){ CodeUp.toast(e.message,"error"); }
      });
    };

    body.querySelectorAll("[data-archivenow]").forEach(b=>{
      b.onclick = async ()=>{
        await CodeUp.withBtnLoading(b, async ()=>{
          try{ await db.rpc("set_file_delete_schedule",{p_file_id:b.dataset.archivenow, p_new_time:new Date().toISOString()}).throwOnError(); CodeUp.toast("سيُحذف من التخزين بأول تشغيل للمهمة اليومية (بعد التأكد من نجاح الإرسال لتيليجرام)","success"); Admin.go("files"); }
          catch(e){ CodeUp.toast(e.message,"error"); }
        });
      };
    });
    body.querySelectorAll("[data-postpone]").forEach(b=>{
      b.onclick = async ()=>{
        const days = prompt("أجّل الحذف كم يوم من الآن؟", "7");
        if(!days) return;
        const newDate = new Date(Date.now() + parseInt(days)*24*60*60*1000).toISOString();
        await CodeUp.withBtnLoading(b, async ()=>{
          try{ await db.rpc("set_file_delete_schedule",{p_file_id:b.dataset.postpone, p_new_time:newDate}).throwOnError(); CodeUp.toast("تم التأجيل","success"); Admin.go("files"); }
          catch(e){ CodeUp.toast(e.message,"error"); }
        });
      };
    });
  }
};

Admin.sections.audit_log = {
  label: "سجل التدقيق",
  async render(body){
    body.innerHTML = `<div class="card">${Array(4).fill(`<div class="skeleton skeleton-line w80" style="height:26px;margin-bottom:10px"></div>`).join("")}</div>`;
    let q = db.from("activity_log").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(150);
    if(Admin.role !== "super") q = q.eq("course_id", Admin.currentCourseId);
    const { data, error } = await q;
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل السجل.</span><button class="btn alertRetry" id="alRetry">إعادة المحاولة</button></div>`; body.querySelector("#alRetry").onclick=()=>Admin.go("audit_log"); return; }
    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>المستخدم</th><th>الحدث</th><th>الوقت</th></tr></thead>
      <tbody>${(data||[]).map(a=>`
        <tr>
          <td><div class="metaWithAvatar">${CodeUp.avatarHtml(a.profiles?.full_name, null, 26)}<span>${CodeUp.escapeHtml(a.profiles?.full_name||"—")}</span></div></td>
          <td>${CodeUp.escapeHtml(a.action_text)}</td>
          <td class="small">${CodeUp.timeAgo(a.created_at)}</td>
        </tr>
      `).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا يوجد سجل بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;
  }
};

/* ============================================================
   LEADER PANEL — كل استعلام هنا مقيّد صراحة بـ Admin.currentSquadId
   ضمن Admin.ctx.leaderSquads (لا يعتمد على RLS فقط؛ دفاع مزدوج)
   ============================================================ */
async function renderLeaderSection(section, body){
  const mySquads = Admin.ctx.leaderSquads.map(s=>s.squad_id);
  if(!mySquads.length){ body.innerHTML = `<div class="emptyStatePro"><h4>لا تقود أي مجموعة حاليًا</h4><p>تواصل مع مسؤول الكورس لو تتوقع إنك مفروض تكون قائد مجموعة.</p></div>`; return; }

  if(mySquads.length > 1 && !document.getElementById("squadSwitcherLeader")){
    const nav = document.getElementById("navRoot");
    const sw = document.createElement("select");
    sw.id = "squadSwitcherLeader";
    sw.style.cssText = "width:100%;margin:0 0 10px;padding:8px;border-radius:8px;border:1px solid #333;background:#1f2740;color:#fff";
    sw.innerHTML = Admin.ctx.leaderSquads.map(s=>`<option value="${s.squad_id}">${CodeUp.escapeHtml(s.squads?.name||"")}</option>`).join("");
    sw.onchange = ()=>{ Admin.currentSquadId = sw.value; Admin.go(Admin.section); };
    nav.prepend(sw);
  }
  const squadId = Admin.currentSquadId || mySquads[0];
  if(!mySquads.includes(squadId)){ body.innerHTML = `<div class="emptyStatePro"><p style="margin:0">لا تملك صلاحية على هذه المجموعة.</p></div>`; return; }

  const { data: squad } = await db.from("squads").select("*, courses(id,name)").eq("id", squadId).single();
  document.getElementById("pageTitle").textContent = squad?.name || "";

  if(section==="mysquad" || section==="members"){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: members, error } = await db.from("enrollments").select("*, profiles(full_name,email)").eq("squad_id", squadId);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الأعضاء.</span><button class="btn alertRetry" id="mbRetry">إعادة المحاولة</button></div>`; body.querySelector("#mbRetry").onclick=()=>Admin.go(section); return; }
    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>الطالب</th><th>الحالة</th><th>التقدم</th><th>XP</th></tr></thead>
      <tbody>${(members||[]).map(m=>`
        <tr><td>${CodeUp.escapeHtml(m.profiles?.full_name||m.profiles?.email||"")}</td><td><span class="pill ${m.status==='on_track'?'approved':m.status==='behind'?'rejected':'pending'}">${enrollmentStatusLabel(m.status)}</span></td><td>${m.progress}%</td><td>${m.xp}</td></tr>
      `).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><p style="margin:0">لا يوجد أعضاء في مجموعتك بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;
    return;
  }

  if(section==="ljoin"){
    const { data, error } = await db.from("squad_join_requests").select("*, profiles!user_id(full_name,email)").eq("squad_id", squadId).order("created_at",{ascending:false});
    if(error){ body.innerHTML = `<div class="emptyState">تعذّر تحميل طلبات الانضمام: ${CodeUp.escapeHtml(error.message)}</div>`; return; }
    renderRequestQueue(body, data||[], {
      title:(r)=>CodeUp.escapeHtml(r.profiles?.full_name||r.profiles?.email||""),
      subtitle:(r)=> r.message?CodeUp.escapeHtml(r.message):"بدون رسالة",
      onApprove: async (r)=> CodeUp.rpc.approveJoinRequest(r.id),
      onReject: async (r, reason)=> CodeUp.rpc.rejectJoinRequest(r.id, reason),
      afterAction: ()=>{ Admin.renderNav(); Admin.go("ljoin"); }
    });
    return;
  }

  if(section==="lassignments"){
    const myLeaderRow = Admin.ctx.leaderSquads.find(s=>s.squad_id===squadId);
    const canAdd = !!(myLeaderRow?.permissions?.can_add_assignment);
    const { data } = await db.from("assignments").select("*").eq("course_id", squad.courses.id).order("deadline");
    body.innerHTML = `
      ${canAdd?`<div class="toolbar"><button class="btn dark" id="leaderNewAssignBtn">+ واجب جديد</button></div>`:""}
      <div class="card"><div class="tableScroll"><table><thead><tr><th>العنوان</th><th>الموعد النهائي</th></tr></thead>
      <tbody>${(data||[]).map(a=>`<tr><td>${CodeUp.escapeHtml(a.title)}</td><td class="small">${CodeUp.formatDate(a.deadline)}</td></tr>`).join("")||`<tr><td colspan="2"><div class="emptyStatePro"><p style="margin:0">لا توجد واجبات بعد.</p></div></td></tr>`}</tbody></table></div></div>`;
    if(canAdd){
      body.querySelector("#leaderNewAssignBtn").onclick = ()=> openLeaderAssignmentModal(squad.courses.id);
    }
    return;
  }

  if(section==="lsubmissions"){
    const { data: members } = await db.from("enrollments").select("profile_id").eq("squad_id", squadId);
    const memberIds = (members||[]).map(m=>m.profile_id);
    if(!memberIds.length){ body.innerHTML = `<div class="emptyState">لا يوجد أعضاء بعد.</div>`; return; }
    const { data: subs } = await db.from("submissions").select("*, assignments(title), profiles(full_name)").in("profile_id", memberIds).order("submitted_at",{ascending:false}).limit(60);
    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>الطالب</th><th>الواجب</th><th>الحالة</th></tr></thead>
      <tbody>${(subs||[]).map(s=>`<tr><td>${CodeUp.escapeHtml(s.profiles?.full_name||"")}</td><td>${CodeUp.escapeHtml(s.assignments?.title||"")}</td><td><span class="pill ${s.status==='reviewed'?'approved':s.status==='late'?'pending':''}">${subStatusAr(s.status)}</span></td></tr>`).join("")||`<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا توجد تسليمات بعد.</p></div></td></tr>`}</tbody></table></div></div>`;
    return;
  }

  if(section==="ltimeline"){
    const { data: members } = await db.from("enrollments").select("profile_id").eq("squad_id", squadId);
    const memberIds = (members||[]).map(m=>m.profile_id);
    if(!memberIds.length){ body.innerHTML = `<div class="emptyState">لا يوجد أعضاء بعد.</div>`; return; }
    const { data } = await db.from("submissions").select("*, profiles(full_name)").eq("visibility","squad").in("profile_id", memberIds).order("created_at",{ascending:false}).limit(30);
    body.innerHTML = `<div class="card">${(data||[]).map(p=>`<div style="padding:8px 0;border-top:1px dashed #eee"><b>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</b> — ${CodeUp.escapeHtml(p.content||"")}</div>`).join("")||`<div class="emptyState">لا توجد منشورات بعد.</div>`}</div>`;
    return;
  }

  if(section==="lactivity"){
    const { data } = await db.from("activity_log").select("*, profiles(full_name)").eq("course_id", squad.courses.id).order("created_at",{ascending:false}).limit(40);
    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>المستخدم</th><th>الحدث</th><th>الوقت</th></tr></thead>
      <tbody>${(data||[]).map(a=>`<tr><td>${CodeUp.escapeHtml(a.profiles?.full_name||"—")}</td><td>${CodeUp.escapeHtml(a.action_text)}</td><td class="small">${CodeUp.timeAgo(a.created_at)}</td></tr>`).join("")||`<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا يوجد نشاط بعد.</p></div></td></tr>`}</tbody></table></div></div>`;
    return;
  }

  if(section==="lprogress"){
    const { data } = await db.from("enrollments").select("*, profiles(full_name)").eq("squad_id", squadId).order("xp",{ascending:false});
    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>الطالب</th><th>التقدم</th><th>XP</th><th>Streak</th></tr></thead>
      <tbody>${(data||[]).map(e=>`<tr><td>${CodeUp.escapeHtml(e.profiles?.full_name||"")}</td><td style="min-width:110px"><div class="progressTrack" style="margin-bottom:4px"><div class="progressFill" style="width:${e.progress??0}%"></div></div><span class="small">${e.progress??0}%</span></td><td>${e.xp}</td><td>${e.streak}</td></tr>`).join("")||`<tr><td colspan="4"><div class="emptyStatePro"><p style="margin:0">لا يوجد أعضاء بعد.</p></div></td></tr>`}</tbody></table></div></div>`;
    return;
  }

  if(section==="lcontent"){
    const myLeaderRow = Admin.ctx.leaderSquads.find(s=>s.squad_id===squadId);
    if(!myLeaderRow?.permissions?.can_add_content){ body.innerHTML = `<div class="emptyState">لا تملك صلاحية إدارة المحتوى.</div>`; return; }
    const cid = squad.courses.id;
    const { data: units } = await db.from("units").select("*, lessons(*)").eq("course_id", cid).order("order_index");
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="leaderNewUnitBtn">+ وحدة جديدة</button></div>
      ${(units||[]).map(u=>`
        <div class="card">
          <div class="row" style="display:flex;justify-content:space-between;align-items:center">
            <b>${CodeUp.escapeHtml(u.title)}</b>
            <button class="btn" data-editunit="${u.id}">تعديل</button>
          </div>
          <div class="tableScroll"><table style="margin-top:10px"><thead><tr><th>الدرس</th><th>رابط الفيديو</th><th></th></tr></thead>
          <tbody>${(u.lessons||[]).sort((a,b)=>a.order_index-b.order_index).map(l=>`
            <tr>
              <td>${CodeUp.escapeHtml(l.title)}</td>
              <td>${l.video_url?`<a href="${l.video_url}" target="_blank">رابط ↗</a>`:"—"}</td>
              <td><button class="btn" data-editlesson="${l.id}" data-unit="${u.id}">تعديل</button></td>
            </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro" style="padding:16px 8px"><p style="margin:0">لا توجد دروس بعد.</p></div></td></tr>`}
          </tbody></table></div>
          <button class="btn" style="margin-top:10px" data-addlesson="${u.id}">+ إضافة درس</button>
        </div>
      `).join("") || `<div class="emptyStatePro"><h4>لا توجد وحدات بعد</h4><p>ابدأ بإضافة أول وحدة.</p></div>`}
    `;
    body.querySelector("#leaderNewUnitBtn").onclick = ()=> openUnitModal(cid, null, ()=>Admin.go("lcontent"));
    body.querySelectorAll("[data-editunit]").forEach(b=>{
      b.onclick = ()=> openUnitModal(cid, units.find(u=>u.id===b.dataset.editunit), ()=>Admin.go("lcontent"));
    });
    body.querySelectorAll("[data-addlesson]").forEach(b=>{
      b.onclick = ()=> openLessonModal(b.dataset.addlesson, null, ()=>Admin.go("lcontent"));
    });
    body.querySelectorAll("[data-editlesson]").forEach(b=>{
      const u = units.find(u=>u.id===b.dataset.unit);
      const lesson = u?.lessons?.find(l=>l.id===b.dataset.editlesson);
      b.onclick = ()=> openLessonModal(b.dataset.unit, lesson, ()=>Admin.go("lcontent"));
    });
    return;
  }

  body.innerHTML = `<div class="emptyState">القسم غير متاح.</div>`;
}

function openLeaderAssignmentModal(courseId){
  const m = Admin.modal(`
    <h3>واجب جديد</h3>
    <label>العنوان</label><input id="laTitle">
    <label>الوصف</label><textarea id="laDesc" rows="3"></textarea>
    <label>النوع</label>
    <select id="laType"><option value="weekly" selected>أسبوعي</option><option value="daily">يومي</option></select>
    <label>الموعد النهائي</label><input id="laDeadline" type="date">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="laCancel">إلغاء</button><button class="btn dark" id="laSave">حفظ</button>
    </div><div id="laMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#laCancel").onclick = m.close;
  m.el.querySelector("#laSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#laMsg");
    const payload = {
      title: m.el.querySelector("#laTitle").value.trim(),
      description: m.el.querySelector("#laDesc").value.trim(),
      type: m.el.querySelector("#laType").value,
      deadline: m.el.querySelector("#laDeadline").value || null
    };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان إلزامي"; return; }
    try{
      await db.from("assignments").insert({...payload, course_id: courseId, created_by: Admin.ctx.user.id}).throwOnError();
      CodeUp.toast("تم إضافة الواجب", "success"); m.close(); Admin.go("lassignments");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}
