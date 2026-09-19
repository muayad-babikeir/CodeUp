// admin/js/university.js
// إدارة قسم "الجامعة" — مستقل تمامًا عن نظام الكورسات. صلاحية التعديل
// فعليًا مقصورة على سوبر أدمن عبر RLS (is_super_admin)، هذا الملف فقط
// يبني الواجهة؛ أي محاولة تعديل من غير سوبر أدمن سترجع خطأ من القاعدة.

const MATERIAL_TYPE_LABEL = {video:"فيديو", telegram:"تيليجرام", link:"رابط عام"};

// إدارة قائمة الجامعات نفسها + تعيين أدمن لكل جامعة — سوبر أدمن فقط (نفس نمط
// صفحة "أدمن الكورسات" بالحرف، لكن لجدول universities/university_admins الجديدين)
Admin.sections.universities = {
  label: "الجامعات",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
    const [{data: universities, error}, {data: admins}, {data: profiles}] = await Promise.all([
      db.from("universities").select("*").order("order_index"),
      db.from("university_admins").select("*, universities(name), profiles(full_name,email)").order("created_at",{ascending:false}),
      db.from("profiles").select("id,full_name,email").order("full_name")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الجامعات.</span><button class="btn alertRetry" id="univsRetry">إعادة المحاولة</button></div>`; body.querySelector("#univsRetry").onclick=()=>Admin.go("universities"); return; }

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newUnivBtn">+ جامعة جديدة</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>الجامعة</th><th>الترتيب</th><th></th></tr></thead>
      <tbody>${(universities||[]).map(u=>`
        <tr>
          <td>${CodeUp.escapeHtml(u.name)}</td>
          <td>${u.order_index}</td>
          <td><button class="btn" data-edit="${u.id}">تعديل</button></td>
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا توجد جامعات بعد.</p></div></td></tr>`}
      </tbody></table></div></div>

      <div class="card" style="margin-top:14px">
        <div class="toolbar"><b>أدمن الجامعات</b><button class="btn dark" id="assignUnivAdminBtn">+ تعيين أدمن جامعة</button></div>
        <div class="tableScroll"><table><thead><tr><th>المستخدم</th><th>الجامعة</th><th>الدور</th><th></th></tr></thead>
        <tbody>${(admins||[]).map(a=>`
          <tr>
            <td>${CodeUp.escapeHtml(a.profiles?.full_name||a.profiles?.email||"")}</td>
            <td>${CodeUp.escapeHtml(a.universities?.name||"")}</td>
            <td><span class="pill ${a.role}">${a.role==='owner'?'مالك':'أدمن'}</span></td>
            <td><button class="btn danger" data-removeadmin="${a.id}">إزالة</button></td>
          </tr>`).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><p style="margin:0">لا يوجد أدمن جامعات بعد.</p></div></td></tr>`}
        </tbody></table></div>
      </div>`;

    body.querySelector("#newUnivBtn").onclick = ()=> openUniversityModal();
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openUniversityModal(universities.find(u=>u.id===b.dataset.edit));
    });
    body.querySelectorAll("[data-removeadmin]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("إزالة صلاحية إدارة هذه الجامعة من هذا المستخدم؟")) return;
        const { error } = await db.from("university_admins").delete().eq("id", b.dataset.removeadmin);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("universities");
      };
    });
    body.querySelector("#assignUnivAdminBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>تعيين أدمن جامعة</h3>
        <label>الجامعة</label>
        <select id="uaUniv">${(universities||[]).map(u=>`<option value="${u.id}">${CodeUp.escapeHtml(u.name)}</option>`).join("")}</select>
        <label>المستخدم</label>
        <select id="uaUser">${(profiles||[]).map(p=>`<option value="${p.id}">${CodeUp.escapeHtml(p.full_name||p.email)}</option>`).join("")}</select>
        <label>الدور</label>
        <select id="uaRole"><option value="admin">أدمن</option><option value="owner">مالك</option></select>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="uaCancel">إلغاء</button><button class="btn dark" id="uaSave">تعيين</button>
        </div><div id="uaMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
      `);
      m.el.querySelector("#uaCancel").onclick = m.close;
      m.el.querySelector("#uaSave").onclick = async ()=>{
        const msgEl = m.el.querySelector("#uaMsg");
        try{
          await db.from("university_admins").insert({
            university_id: m.el.querySelector("#uaUniv").value,
            profile_id: m.el.querySelector("#uaUser").value,
            role: m.el.querySelector("#uaRole").value
          }).throwOnError();
          m.close(); Admin.go("universities");
        }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
      };
    };
  }
};

function openUniversityModal(university){
  const isEdit = !!university;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل جامعة":"جامعة جديدة"}</h3>
    <label>الاسم</label><input id="univName" value="${university?CodeUp.escapeHtml(university.name):""}" placeholder="اسم الجامعة">
    <label>الترتيب</label><input id="univOrder" type="number" value="${university?.order_index??0}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="univCancel">إلغاء</button><button class="btn dark" id="univSave">حفظ</button>
    </div><div id="univMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#univCancel").onclick = m.close;
  m.el.querySelector("#univSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#univMsg");
    const payload = {
      name: m.el.querySelector("#univName").value.trim(),
      order_index: Number(m.el.querySelector("#univOrder").value) || 0
    };
    if(!payload.name){ msgEl.style.display="block"; msgEl.textContent="الاسم مطلوب"; return; }
    try{
      if(isEdit) await db.from("universities").update(payload).eq("id", university.id).throwOnError();
      else await db.from("universities").insert(payload).throwOnError();
      m.close(); Admin.go(Admin.role==="super" ? "universities" : "university");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

// محتوى الجامعة (فصول/مواد/روابط) — الآن مقيّد بجامعة محدَّدة عبر Admin.currentUniversityId.
// لو المستخدم يدير أكثر من جامعة (سوبر أدمن، أو أدمن أكثر من جامعة)، يظهر منتقي بالأعلى.
Admin.sections.university = {
  label: "الجامعة",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
    let q = db.from("universities").select("*").order("order_index");
    if(Admin.role === "university_admin") q = q.in("id", Admin.universityAdminIds);
    const { data: universities, error } = await q;
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الجامعات.</span><button class="btn alertRetry" id="uAdminRetry">إعادة المحاولة</button></div>`; body.querySelector("#uAdminRetry").onclick=()=>Admin.go("university"); return; }
    if(!universities || !universities.length){
      body.innerHTML = `<div class="emptyStatePro"><h4>لا توجد جامعة مُدارة بعد</h4><p>${Admin.role==="super"?"أنشئ جامعة من صفحة \"الجامعات\" أولًا.":"لا تملك صلاحية إدارة أي جامعة حاليًا."}</p></div>`;
      return;
    }
    if(!Admin.currentUniversityId || !universities.some(u=>u.id===Admin.currentUniversityId)){
      Admin.currentUniversityId = universities[0].id;
    }

    const pickerHtml = universities.length > 1 ? `
      <div class="toolbar"><label style="margin:0">الجامعة:</label>
        <select id="univPicker">${universities.map(u=>`<option value="${u.id}" ${u.id===Admin.currentUniversityId?"selected":""}>${CodeUp.escapeHtml(u.name)}</option>`).join("")}</select>
      </div>` : `<p class="small" style="margin-bottom:10px">${CodeUp.escapeHtml(universities[0].name)}</p>`;

    body.innerHTML = pickerHtml + `<div id="uniContentRoot"></div>`;
    const contentRoot = body.querySelector("#uniContentRoot");
    const picker = body.querySelector("#univPicker");
    if(picker) picker.onchange = ()=>{ Admin.currentUniversityId = picker.value; Admin.go("university"); };

    await renderSemesters(contentRoot);
  }
};

async function renderSemesters(body){
  body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
  const { data: semesters, error } = await db.from("university_semesters").select("*").eq("university_id", Admin.currentUniversityId).order("order_index");
  if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الفصول الدراسية.</span><button class="btn alertRetry" id="uniRetry">إعادة المحاولة</button></div>`; body.querySelector("#uniRetry").onclick=()=>Admin.go("university"); return; }
  body.innerHTML = `
    <div class="toolbar"><button class="btn dark" id="newSemesterBtn">+ فصل دراسي جديد</button></div>
    <div class="card"><div class="tableScroll"><table>
      <thead><tr><th>الفصل الدراسي</th><th>الترتيب</th><th></th></tr></thead>
      <tbody>${(semesters||[]).map(s=>`
        <tr>
          <td>${CodeUp.escapeHtml(s.title)}</td>
          <td>${s.order_index}</td>
          <td>
            <button class="btn" data-subjects="${s.id}">المواد</button>
            <button class="btn" data-edit="${s.id}">تعديل</button>
            <button class="btn danger" data-del="${s.id}">حذف</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><h4>لا توجد فصول دراسية بعد</h4><p>أضف أول فصل لتنظيم مواد قسم الجامعة.</p></div></td></tr>`}
      </tbody></table></div></div>`;

  body.querySelector("#newSemesterBtn").onclick = ()=> openSemesterModal(null, body);
  body.querySelectorAll("[data-edit]").forEach(b=>{
    b.onclick = ()=> openSemesterModal(semesters.find(s=>s.id===b.dataset.edit), body);
  });
  body.querySelectorAll("[data-subjects]").forEach(b=>{
    b.onclick = ()=> renderSubjects(body, semesters.find(s=>s.id===b.dataset.subjects));
  });
  body.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm("حذف الفصل الدراسي بالكامل مع كل مواده وروابطه؟ لا يمكن التراجع.")) return;
      const { error } = await db.from("university_semesters").delete().eq("id", b.dataset.del);
      if(error){ CodeUp.toast(error.message, "error"); return; }
      renderSemesters(body);
    };
  });
}

function openSemesterModal(semester, body){
  const isEdit = !!semester;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل فصل دراسي":"فصل دراسي جديد"}</h3>
    <label>العنوان</label><input id="semTitle" value="${semester?CodeUp.escapeHtml(semester.title):""}" placeholder="الفصل الدراسي الأول">
    <label>الترتيب</label><input id="semOrder" type="number" value="${semester?.order_index??0}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="semCancel">إلغاء</button><button class="btn dark" id="semSave">حفظ</button>
    </div>`);
  m.el.querySelector("#semCancel").onclick = m.close;
  m.el.querySelector("#semSave").onclick = async ()=>{
    const payload = {
      title: m.el.querySelector("#semTitle").value.trim(),
      order_index: Number(m.el.querySelector("#semOrder").value) || 0,
      university_id: Admin.currentUniversityId
    };
    if(!payload.title){ CodeUp.toast("العنوان مطلوب", "error"); return; }
    const { error } = isEdit
      ? await db.from("university_semesters").update(payload).eq("id", semester.id)
      : await db.from("university_semesters").insert(payload);
    if(error){ CodeUp.toast(error.message, "error"); return; }
    m.close();
    renderSemesters(body);
  };
}

async function renderSubjects(body, semester){
  const { data: subjects } = await db.from("university_subjects").select("*").eq("semester_id", semester.id).order("order_index");
  body.innerHTML = `
    <button class="btn" id="backToSemesters" style="margin-bottom:10px">← رجوع للفصول الدراسية</button>
    <div class="toolbar"><b>${CodeUp.escapeHtml(semester.title)}</b><button class="btn dark" id="newSubjectBtn">+ مادة جديدة</button></div>
    <div class="card"><div class="tableScroll"><table>
      <thead><tr><th>المادة</th><th>الترتيب</th><th></th></tr></thead>
      <tbody>${(subjects||[]).map(s=>`
        <tr>
          <td>${CodeUp.escapeHtml(s.title)}</td>
          <td>${s.order_index}</td>
          <td>
            <button class="btn" data-materials="${s.id}">الروابط/الفيديوهات</button>
            <button class="btn" data-edit="${s.id}">تعديل</button>
            <button class="btn danger" data-del="${s.id}">حذف</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا توجد مواد بهذا الفصل بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;

  body.querySelector("#backToSemesters").onclick = ()=> renderSemesters(body);
  body.querySelector("#newSubjectBtn").onclick = ()=> openSubjectModal(null, semester, body);
  body.querySelectorAll("[data-edit]").forEach(b=>{
    b.onclick = ()=> openSubjectModal(subjects.find(s=>s.id===b.dataset.edit), semester, body);
  });
  body.querySelectorAll("[data-materials]").forEach(b=>{
    b.onclick = ()=> renderMaterials(body, subjects.find(s=>s.id===b.dataset.materials), semester);
  });
  body.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm("حذف المادة بالكامل مع كل روابطها؟ لا يمكن التراجع.")) return;
      const { error } = await db.from("university_subjects").delete().eq("id", b.dataset.del);
      if(error){ CodeUp.toast(error.message, "error"); return; }
      renderSubjects(body, semester);
    };
  });
}

function openSubjectModal(subject, semester, body){
  const isEdit = !!subject;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل مادة":"مادة جديدة"}</h3>
    <label>العنوان</label><input id="subjTitle" value="${subject?CodeUp.escapeHtml(subject.title):""}" placeholder="الرياضيات">
    <label>الترتيب</label><input id="subjOrder" type="number" value="${subject?.order_index??0}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="subjCancel">إلغاء</button><button class="btn dark" id="subjSave">حفظ</button>
    </div>`);
  m.el.querySelector("#subjCancel").onclick = m.close;
  m.el.querySelector("#subjSave").onclick = async ()=>{
    const payload = {
      title: m.el.querySelector("#subjTitle").value.trim(),
      order_index: Number(m.el.querySelector("#subjOrder").value) || 0
    };
    if(!payload.title){ CodeUp.toast("العنوان مطلوب", "error"); return; }
    const { error } = isEdit
      ? await db.from("university_subjects").update(payload).eq("id", subject.id)
      : await db.from("university_subjects").insert({...payload, semester_id: semester.id});
    if(error){ CodeUp.toast(error.message, "error"); return; }
    m.close();
    renderSubjects(body, semester);
  };
}

async function renderMaterials(body, subject, semester){
  const { data: materials } = await db.from("university_materials").select("*").eq("subject_id", subject.id).order("order_index");
  body.innerHTML = `
    <button class="btn" id="backToSubjects" style="margin-bottom:10px">← رجوع لمواد ${CodeUp.escapeHtml(semester.title)}</button>
    <div class="toolbar"><b>${CodeUp.escapeHtml(subject.title)}</b><button class="btn dark" id="newMaterialBtn">+ رابط جديد</button></div>
    <div class="card"><div class="tableScroll"><table>
      <thead><tr><th>العنوان</th><th>النوع</th><th>الرابط</th><th>الترتيب</th><th></th></tr></thead>
      <tbody>${(materials||[]).map(m=>`
        <tr>
          <td>${CodeUp.escapeHtml(m.title)}</td>
          <td>${MATERIAL_TYPE_LABEL[m.material_type]||m.material_type}</td>
          <td><a href="${CodeUp.escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">فتح ↗</a></td>
          <td>${m.order_index}</td>
          <td>
            <button class="btn" data-edit="${m.id}">تعديل</button>
            <button class="btn danger" data-del="${m.id}">حذف</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="5"><div class="emptyStatePro"><p style="margin:0">لا توجد روابط بهذه المادة بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;

  body.querySelector("#backToSubjects").onclick = ()=> renderSubjects(body, semester);
  body.querySelector("#newMaterialBtn").onclick = ()=> openMaterialModal(null, subject, body, semester);
  body.querySelectorAll("[data-edit]").forEach(b=>{
    b.onclick = ()=> openMaterialModal(materials.find(m=>m.id===b.dataset.edit), subject, body, semester);
  });
  body.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm("حذف هذا الرابط؟")) return;
      const { error } = await db.from("university_materials").delete().eq("id", b.dataset.del);
      if(error){ CodeUp.toast(error.message, "error"); return; }
      renderMaterials(body, subject, semester);
    };
  });
}

function openMaterialModal(material, subject, body, semester){
  const isEdit = !!material;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل رابط":"رابط جديد"}</h3>
    <label>العنوان</label><input id="matTitle" value="${material?CodeUp.escapeHtml(material.title):""}" placeholder="مثلاً: محاضرة 1 — المقدمة">
    <label>الرابط</label><input id="matUrl" type="url" value="${material?CodeUp.escapeHtml(material.url):""}" placeholder="https://...">
    <label>النوع</label>
    <select id="matType">
      <option value="video" ${material?.material_type==="video"?"selected":""}>فيديو (يوتيوب وغيره)</option>
      <option value="telegram" ${material?.material_type==="telegram"?"selected":""}>تيليجرام</option>
      <option value="link" ${!material||material.material_type==="link"?"selected":""}>رابط عام</option>
    </select>
    <label>الترتيب</label><input id="matOrder" type="number" value="${material?.order_index??0}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="matCancel">إلغاء</button><button class="btn dark" id="matSave">حفظ</button>
    </div>`);
  m.el.querySelector("#matCancel").onclick = m.close;
  m.el.querySelector("#matSave").onclick = async ()=>{
    const url = m.el.querySelector("#matUrl").value.trim();
    const payload = {
      title: m.el.querySelector("#matTitle").value.trim(),
      url,
      material_type: m.el.querySelector("#matType").value,
      order_index: Number(m.el.querySelector("#matOrder").value) || 0
    };
    if(!payload.title || !url){ CodeUp.toast("العنوان والرابط مطلوبان", "error"); return; }
    if(!/^https?:\/\/.+/i.test(url)){ CodeUp.toast("الرابط لازم يبدأ بـ http:// أو https://", "error"); return; }
    const { error } = isEdit
      ? await db.from("university_materials").update(payload).eq("id", material.id)
      : await db.from("university_materials").insert({...payload, subject_id: subject.id, created_by: Admin.ctx.user.id});
    if(error){ CodeUp.toast(error.message, "error"); return; }
    m.close();
    renderMaterials(body, subject, semester);
  };
}
