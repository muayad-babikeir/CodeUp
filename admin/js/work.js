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

async function openAssignmentModal(courseId, a){
  const isEdit = !!a;
  const { data: squads } = await db.from("squads").select("id,name").eq("course_id", courseId).eq("status","active");
  let targetedSquadIds = [];
  if(isEdit){
    const { data: links } = await db.from("assignment_squads").select("squad_id").eq("assignment_id", a.id);
    targetedSquadIds = (links||[]).map(l=>l.squad_id);
  }
  let existingFiles = [];
  if(isEdit){
    const { data: files } = await db.from("file_uploads").select("*").eq("related_type","assignment").eq("related_id", a.id);
    existingFiles = files || [];
  }

  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الواجب":"واجب جديد"}</h3>
    <label>العنوان</label><input id="aTitle" value="${a?CodeUp.escapeHtml(a.title):""}">
    <label>الوصف</label><textarea id="aDesc" rows="3">${a?CodeUp.escapeHtml(a.description||""):""}</textarea>
    <label>النوع</label>
    <select id="aType"><option value="weekly" ${!a||a.type==='weekly'?'selected':''}>أسبوعي</option><option value="daily" ${a?.type==='daily'?'selected':''}>يومي</option></select>
    <label>الموعد النهائي</label><input id="aDeadline" type="date" value="${a?.deadline||""}">
    <label>يظهر لـ</label>
    <div style="display:flex;flex-direction:column;gap:6px;margin:6px 0">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px">
        <input type="radio" name="aTargetMode" id="aTargetAll" ${!targetedSquadIds.length?"checked":""}> كل طلاب الكورس
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px">
        <input type="radio" name="aTargetMode" id="aTargetSome" ${targetedSquadIds.length?"checked":""}> مجموعات محددة فقط
      </label>
    </div>
    <div id="aSquadList" style="display:${targetedSquadIds.length?"block":"none"};margin-bottom:8px">
      ${(squads||[]).map(s=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px">
        <input type="checkbox" data-squadcheck value="${s.id}" ${targetedSquadIds.includes(s.id)?"checked":""}> ${CodeUp.escapeHtml(s.name)}
      </label>`).join("") || `<p class="small">لا توجد مجموعات نشطة بهذا الكورس بعد.</p>`}
    </div>
    <label>المرفقات (اختياري)</label>
    <div id="aExistingFiles">${existingFiles.map(f=>renderFileCard(f,"course-assets")).join("")}</div>
    <input type="file" id="aNewFile" accept="image/*,application/pdf,.doc,.docx,.txt,.zip">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="aCancel">إلغاء</button><button class="btn dark" id="aSave">حفظ</button>
    </div><div id="aMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  wireFileCardPreviews(m.el);
  m.el.querySelector("#aExistingFiles").querySelectorAll("[data-filecard]").forEach(card=>{
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger"; delBtn.textContent = "حذف المرفق"; delBtn.style.marginInlineStart = "6px";
    delBtn.onclick = async ()=>{
      const fileId = card.dataset.filecard;
      const f = existingFiles.find(x=>x.id===fileId);
      try{
        await db.storage.from("course-assets").remove([f.storage_path]);
        await db.from("file_uploads").delete().eq("id", fileId).throwOnError();
        card.remove();
        CodeUp.toast("تم حذف المرفق","success");
      }catch(e){ CodeUp.toast(e.message,"error"); }
    };
    card.appendChild(delBtn);
  });
  m.el.querySelector("#aTargetAll").onchange = ()=>{ m.el.querySelector("#aSquadList").style.display = "none"; };
  m.el.querySelector("#aTargetSome").onchange = ()=>{ m.el.querySelector("#aSquadList").style.display = "block"; };
  m.el.querySelector("#aCancel").onclick = m.close;
  m.el.querySelector("#aSave").onclick = async ()=>{
    const saveBtn = m.el.querySelector("#aSave");
    if(saveBtn.disabled) return;
    saveBtn.disabled = true; saveBtn.textContent = "جارِ الحفظ…";
    const msgEl = m.el.querySelector("#aMsg");
    const payload = {
      title: m.el.querySelector("#aTitle").value.trim(),
      description: m.el.querySelector("#aDesc").value.trim(),
      type: m.el.querySelector("#aType").value,
      deadline: m.el.querySelector("#aDeadline").value || null
    };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان إلزامي"; saveBtn.disabled=false; saveBtn.textContent="حفظ"; return; }
    try{
      let assignmentId = a?.id;
      if(isEdit){
        await db.from("assignments").update({...payload, updated_at: new Date().toISOString()}).eq("id", a.id).throwOnError();
      }else{
        const {data, error} = await db.from("assignments").insert({...payload, course_id: courseId, created_by: Admin.ctx.user.id}).select().single();
        if(error) throw error;
        assignmentId = data.id;
      }

      // تحديث استهداف المجموعات
      await db.from("assignment_squads").delete().eq("assignment_id", assignmentId);
      const targetAll = m.el.querySelector("#aTargetAll").checked;
      if(!targetAll){
        const checkedIds = [...m.el.querySelectorAll("[data-squadcheck]:checked")].map(cb=>cb.value);
        if(checkedIds.length){
          await db.from("assignment_squads").insert(checkedIds.map(sid=>({assignment_id: assignmentId, squad_id: sid}))).throwOnError();
        }
      }

      // رفع مرفق جديد إن وُجد (bucket منفصل تمامًا عن ملفات الطلاب — لا يدخل نظام الأرشفة إطلاقًا)
      const fileInput = m.el.querySelector("#aNewFile");
      if(fileInput.files[0]){
        const file = fileInput.files[0];
        const cleanName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${courseId}/${assignmentId}/${Date.now()}_${cleanName}`;
        const { error: upErr } = await db.storage.from("course-assets").upload(path, file, { upsert:false });
        if(upErr) throw upErr;
        await db.from("file_uploads").insert({
          course_id: courseId, uploader_id: Admin.ctx.user.id, related_type:"assignment",
          related_id: assignmentId, storage_path: path, file_name: file.name, mime_type: file.type, file_size: file.size,
          archive_status: "live"
        }).throwOnError();
      }

      CodeUp.toast("تم الحفظ", "success"); m.close(); Admin.go("assignments");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; saveBtn.disabled=false; saveBtn.textContent="حفظ"; }
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
  const fileCards = (files||[]).map(f=>renderFileCard(f,"submissions")).join("");

  const m = Admin.modal(`
    <h3>مراجعة تسليم: ${CodeUp.escapeHtml(sub.profiles?.full_name||"")}</h3>
    <p class="small">${CodeUp.escapeHtml(sub.assignments?.title||"")}</p>
    <div style="margin:10px 0">${CodeUp.escapeHtml(sub.content||"بدون ملاحظات")}</div>
    ${fileCards || '<p class="small">لا توجد ملفات مرفقة.</p>'}
    <label>الدرجة</label><input id="rGrade" type="number" step="0.5" value="${sub.grade??""}">
    <label>ملاحظات المراجع</label><textarea id="rNotes" rows="3">${CodeUp.escapeHtml(sub.reviewer_notes||"")}</textarea>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="rCancel">إغلاق</button><button class="btn dark" id="rSave">حفظ المراجعة</button>
    </div>`);
  wireFileCardPreviews(m.el);
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
