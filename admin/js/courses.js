// admin/js/courses.js

Admin.sections.courses = {
  label: "الكورسات",
  async render(body){
    const { data: courses } = await db.from("courses").select("*").order("created_at",{ascending:false});
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newCourseBtn">+ كورس جديد</button></div>
      <div class="card"><table>
        <thead><tr><th>الاسم</th><th>الحالة</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
        <tbody>${(courses||[]).map(c=>`
          <tr>
            <td>${CodeUp.escapeHtml(c.name)}</td>
            <td><span class="pill ${c.status==='published'?'approved':c.status==='draft'?'pending':'rejected'}">${courseStatusLabel(c.status)}</span></td>
            <td>${CodeUp.formatDate(c.created_at)}</td>
            <td><button class="btn" data-edit="${c.id}">تعديل</button></td>
          </tr>`).join("") || `<tr><td colspan="4" class="emptyState">لا توجد كورسات بعد.</td></tr>`}
        </tbody></table></div>`;

    body.querySelector("#newCourseBtn").onclick = ()=> openCourseModal();
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openCourseModal(courses.find(c=>c.id===b.dataset.edit));
    });
  }
};

function courseStatusLabel(s){ return {published:"منشور",draft:"مسودة",archived:"مؤرشف"}[s]||s; }

function openCourseModal(course){
  const isEdit = !!course;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الكورس":"كورس جديد"}</h3>
    <label>الاسم</label><input id="cName" value="${course?CodeUp.escapeHtml(course.name):""}">
    <label>الرابط (slug)</label><input id="cSlug" value="${course?CodeUp.escapeHtml(course.slug):""}" placeholder="cpp-2026">
    <label>الوصف</label><textarea id="cDesc" rows="3">${course?CodeUp.escapeHtml(course.description||""):""}</textarea>
    <label>الحالة</label>
    <select id="cStatus">
      <option value="draft" ${course?.status==='draft'?'selected':''}>مسودة</option>
      <option value="published" ${!course||course.status==='published'?'selected':''}>منشور</option>
      <option value="archived" ${course?.status==='archived'?'selected':''}>مؤرشف</option>
    </select>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="cCancel">إلغاء</button>
      <button class="btn dark" id="cSave">حفظ</button>
    </div>
    <div id="cMsg" class="emptyState" style="display:none;padding:8px;color:#b42318"></div>
  `);
  m.el.querySelector("#cCancel").onclick = m.close;
  m.el.querySelector("#cSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#cMsg");
    const payload = {
      name: m.el.querySelector("#cName").value.trim(),
      slug: m.el.querySelector("#cSlug").value.trim(),
      description: m.el.querySelector("#cDesc").value.trim(),
      status: m.el.querySelector("#cStatus").value
    };
    if(!payload.name || !payload.slug){ msgEl.style.display="block"; msgEl.textContent="الاسم والرابط إلزاميان"; return; }
    try{
      if(isEdit) await db.from("courses").update(payload).eq("id", course.id).throwOnError();
      else await db.from("courses").insert({...payload, created_by: Admin.ctx.user.id, is_active:true}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); Admin.go("courses");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

Admin.sections.course_admins = {
  label: "أدمن الكورسات",
  async render(body){
    const [{data: admins}, {data: profiles}] = await Promise.all([
      db.from("course_admins").select("*, courses(name), profiles(full_name,email)").order("created_at",{ascending:false}),
      db.from("profiles").select("id, full_name, email").order("full_name")
    ]);
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="assignBtn">+ تعيين أدمن كورس</button></div>
      <div class="card"><table><thead><tr><th>المستخدم</th><th>الكورس</th><th>الدور</th><th></th></tr></thead>
      <tbody>${(admins||[]).map(a=>`
        <tr>
          <td>${CodeUp.escapeHtml(a.profiles?.full_name||a.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(a.courses?.name||"")}</td>
          <td><span class="pill ${a.role}">${a.role==='owner'?'مالك':'أدمن'}</span></td>
          <td><button class="btn danger" data-remove="${a.id}">إزالة</button></td>
        </tr>`).join("") || `<tr><td colspan="4" class="emptyState">لا يوجد أدمن كورسات بعد.</td></tr>`}
      </tbody></table></div>`;

    body.querySelector("#assignBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>تعيين أدمن كورس</h3>
        <label>الكورس</label>
        <select id="acCourse">${Admin.courses.map(c=>`<option value="${c.id}">${CodeUp.escapeHtml(c.name)}</option>`).join("")}</select>
        <label>المستخدم</label>
        <select id="acUser">${(profiles||[]).map(p=>`<option value="${p.id}">${CodeUp.escapeHtml(p.full_name||p.email)}</option>`).join("")}</select>
        <label>الدور</label>
        <select id="acRole"><option value="admin">أدمن</option><option value="owner">مالك</option></select>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="acCancel">إلغاء</button><button class="btn dark" id="acSave">تعيين</button>
        </div><div id="acMsg" class="emptyState" style="display:none;padding:8px;color:#b42318"></div>
      `);
      m.el.querySelector("#acCancel").onclick = m.close;
      m.el.querySelector("#acSave").onclick = async ()=>{
        const msgEl = m.el.querySelector("#acMsg");
        try{
          await db.from("course_admins").insert({
            course_id: m.el.querySelector("#acCourse").value,
            profile_id: m.el.querySelector("#acUser").value,
            role: m.el.querySelector("#acRole").value
          }).throwOnError();
          CodeUp.toast("تم التعيين", "success"); m.close(); Admin.go("course_admins");
        }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message.includes("duplicate")?"هذا المستخدم أدمن على هذا الكورس بالفعل":e.message; }
      };
    };

    body.querySelectorAll("[data-remove]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("تأكيد إزالة صلاحية الإدارة؟")) return;
        const { error } = await db.from("course_admins").delete().eq("id", b.dataset.remove);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("course_admins");
      };
    });
  }
};

Admin.sections.settings = {
  label: "إعدادات الكورس",
  async render(body){
    const { data: course } = await db.from("courses").select("*").eq("id", Admin.currentCourseId).single();
    if(!course){ body.innerHTML = `<div class="emptyState">اختر كورسًا أولًا.</div>`; return; }
    body.innerHTML = `
      <div class="card">
        <label>الاسم</label><input id="sName" value="${CodeUp.escapeHtml(course.name)}">
        <label>الوصف</label><textarea id="sDesc" rows="4">${CodeUp.escapeHtml(course.description||"")}</textarea>
        <label>الحالة</label>
        <select id="sStatus">
          <option value="draft" ${course.status==='draft'?'selected':''}>مسودة</option>
          <option value="published" ${course.status==='published'?'selected':''}>منشور</option>
          <option value="archived" ${course.status==='archived'?'selected':''}>مؤرشف</option>
        </select>
        <button class="btn dark" id="sSave" style="margin-top:16px">حفظ التغييرات</button>
      </div>`;
    body.querySelector("#sSave").onclick = async ()=>{
      await db.from("courses").update({
        name: body.querySelector("#sName").value.trim(),
        description: body.querySelector("#sDesc").value.trim(),
        status: body.querySelector("#sStatus").value
      }).eq("id", course.id);
      CodeUp.toast("تم الحفظ", "success");
    };
  }
};

Admin.sections.progress = {
  label: "التقدم",
  async render(body){
    const { data } = await db.from("enrollments").select("*, profiles(full_name,email), squads(name)").eq("course_id", Admin.currentCourseId).order("xp",{ascending:false});
    body.innerHTML = `<div class="card"><table><thead><tr><th>الطالب</th><th>المجموعة</th><th>الحالة</th><th>التقدم</th><th>XP</th><th>Streak</th></tr></thead>
      <tbody>${(data||[]).map(e=>`
        <tr>
          <td>${CodeUp.escapeHtml(e.profiles?.full_name||e.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(e.squads?.name||"—")}</td>
          <td><span class="pill ${e.status==='on_track'?'approved':e.status==='behind'?'rejected':'pending'}">${e.status}</span></td>
          <td>${e.progress}%</td><td>${e.xp}</td><td>${e.streak}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="emptyState">لا يوجد طلاب مسجلون بعد.</td></tr>`}
      </tbody></table></div>`;
  }
};
