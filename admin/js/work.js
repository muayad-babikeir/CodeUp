// admin/js/work.js

Admin.sections.assignments = {
  label: "الواجبات",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data: assignments } = await db.from("assignments").select("*").eq("course_id", cid).order("deadline");
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newAssignBtn">+ واجب جديد</button></div>
      <div class="card"><table><thead><tr><th>العنوان</th><th>النوع</th><th>الموعد النهائي</th><th></th></tr></thead>
      <tbody>${(assignments||[]).map(a=>`
        <tr>
          <td>${CodeUp.escapeHtml(a.title)}</td>
          <td>${a.type==='daily'?'يومي':'أسبوعي'}</td>
          <td>${CodeUp.formatDate(a.deadline)}</td>
          <td><button class="btn" data-edit="${a.id}">تعديل</button></td>
        </tr>`).join("") || `<tr><td colspan="4" class="emptyState">لا توجد واجبات بعد.</td></tr>`}
      </tbody></table></div>`;
    body.querySelector("#newAssignBtn").onclick = ()=> openAssignmentModal(cid);
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openAssignmentModal(cid, assignments.find(a=>a.id===b.dataset.edit));
    });
  }
};

function openAssignmentModal(courseId, a){
  const isEdit = !!a;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الواجب":"واجب جديد"}</h3>
    <label>العنوان</label><input id="aTitle" value="${a?CodeUp.escapeHtml(a.title):""}">
    <label>الوصف</label><textarea id="aDesc" rows="3">${a?CodeUp.escapeHtml(a.description||""):""}</textarea>
    <label>النوع</label>
    <select id="aType"><option value="weekly" ${!a||a.type==='weekly'?'selected':''}>أسبوعي</option><option value="daily" ${a?.type==='daily'?'selected':''}>يومي</option></select>
    <label>الموعد النهائي</label><input id="aDeadline" type="date" value="${a?.deadline||""}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="aCancel">إلغاء</button><button class="btn dark" id="aSave">حفظ</button>
    </div><div id="aMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#aCancel").onclick = m.close;
  m.el.querySelector("#aSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#aMsg");
    const payload = {
      title: m.el.querySelector("#aTitle").value.trim(),
      description: m.el.querySelector("#aDesc").value.trim(),
      type: m.el.querySelector("#aType").value,
      deadline: m.el.querySelector("#aDeadline").value || null
    };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان إلزامي"; return; }
    try{
      if(isEdit) await db.from("assignments").update({...payload, updated_at: new Date().toISOString()}).eq("id", a.id).throwOnError();
      else await db.from("assignments").insert({...payload, course_id: courseId, created_by: Admin.ctx.user.id}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); Admin.go("assignments");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

Admin.sections.submissions = {
  label: "التسليمات",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data: subs } = await db.from("submissions")
      .select("*, assignments!inner(title,course_id), profiles(full_name,email)")
      .eq("assignments.course_id", cid).order("submitted_at",{ascending:false}).limit(100);

    body.innerHTML = `
      <div class="toolbar">
        <select id="statusFilter">
          <option value="">كل الحالات</option>
          <option value="submitted">تم التسليم</option><option value="late">متأخر</option>
          <option value="reviewed">تمت المراجعة</option><option value="missing">لم يُسلَّم</option>
        </select>
      </div>
      <div class="card"><table><thead><tr><th>الطالب</th><th>الواجب</th><th>الحالة</th><th>الدرجة</th><th></th></tr></thead>
      <tbody id="subsBody"></tbody></table></div>`;

    const tbody = body.querySelector("#subsBody");
    const draw = (list)=>{
      tbody.innerHTML = list.map(s=>`
        <tr>
          <td>${CodeUp.escapeHtml(s.profiles?.full_name||s.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(s.assignments?.title||"")}</td>
          <td><span class="pill ${s.status==='reviewed'?'approved':s.status==='late'?'pending':''}">${subStatusAr(s.status)}</span></td>
          <td>${s.grade??"—"}</td>
          <td><button class="btn" data-review="${s.id}">مراجعة</button></td>
        </tr>`).join("") || `<tr><td colspan="5" class="emptyState">لا توجد تسليمات بعد.</td></tr>`;
      tbody.querySelectorAll("[data-review]").forEach(b=>{
        b.onclick = ()=> openReviewModal(list.find(s=>s.id===b.dataset.review));
      });
    };
    draw(subs||[]);
    body.querySelector("#statusFilter").onchange = (e)=>{
      const v = e.target.value;
      draw(v ? (subs||[]).filter(s=>s.status===v) : (subs||[]));
    };
  }
};

function subStatusAr(s){ return {submitted:"تم التسليم",late:"متأخر",missing:"لم يُسلَّم",reviewed:"تمت المراجعة"}[s]||s; }

async function openReviewModal(sub){
  const { data: files } = await db.from("file_uploads").select("*").eq("submission_id", sub.id);
  let fileLinks = "";
  for(const f of (files||[])){
    try{
      const url = await CodeUp.getSignedUrl("submissions", f.storage_path, 600);
      const isImage = (f.mime_type||"").startsWith("image/");
      if(isImage){
        fileLinks += `<div style="margin:8px 0"><a href="${url}" target="_blank"><img src="${url}" alt="${CodeUp.escapeHtml(f.file_name||"صورة")}" style="max-width:100%;max-height:360px;border-radius:8px;display:block"></a></div>`;
      }else{
        fileLinks += `<div><a href="${url}" target="_blank">${CodeUp.escapeHtml(f.file_name||"ملف")}</a></div>`;
      }
    }catch(e){ fileLinks += `<div class="small">تعذّر تحميل رابط الملف: ${CodeUp.escapeHtml(f.file_name||"")}</div>`; }
  }

  const m = Admin.modal(`
    <h3>مراجعة تسليم: ${CodeUp.escapeHtml(sub.profiles?.full_name||"")}</h3>
    <p class="small">${CodeUp.escapeHtml(sub.assignments?.title||"")}</p>
    <div style="margin:10px 0">${CodeUp.escapeHtml(sub.content||"بدون ملاحظات")}</div>
    ${fileLinks || '<p class="small">لا توجد ملفات مرفقة.</p>'}
    <label>الدرجة</label><input id="rGrade" type="number" step="0.5" value="${sub.grade??""}">
    <label>ملاحظات المراجع</label><textarea id="rNotes" rows="3">${CodeUp.escapeHtml(sub.reviewer_notes||"")}</textarea>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="rCancel">إغلاق</button><button class="btn dark" id="rSave">حفظ المراجعة</button>
    </div>`);
  m.el.querySelector("#rCancel").onclick = m.close;
  m.el.querySelector("#rSave").onclick = async ()=>{
    const saveBtn = m.el.querySelector("#rSave");
    saveBtn.disabled = true;
    try{
      const gradeVal = m.el.querySelector("#rGrade").value;
      await CodeUp.rpc.reviewSubmission(sub.id, gradeVal ? Number(gradeVal) : null, m.el.querySelector("#rNotes").value.trim());
      CodeUp.toast("تم حفظ المراجعة", "success"); m.close(); Admin.go("submissions");
    }catch(e){
      CodeUp.toast(e.message || "تعذّر حفظ المراجعة", "error"); saveBtn.disabled = false;
    }
  };
}
