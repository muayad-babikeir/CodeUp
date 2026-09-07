// admin/js/university.js
// إدارة قسم "الجامعة" — مستقل تمامًا عن نظام الكورسات. صلاحية التعديل
// فعليًا مقصورة على سوبر أدمن عبر RLS (is_super_admin)، هذا الملف فقط
// يبني الواجهة؛ أي محاولة تعديل من غير سوبر أدمن سترجع خطأ من القاعدة.

const MATERIAL_TYPE_LABEL = {video:"فيديو", telegram:"تيليجرام", link:"رابط عام"};

Admin.sections.university = {
  label: "الجامعة",
  async render(body){
    await renderSemesters(body);
  }
};

async function renderSemesters(body){
  const { data: semesters } = await db.from("university_semesters").select("*").order("order_index");
  body.innerHTML = `
    <div class="toolbar"><button class="btn dark" id="newSemesterBtn">+ فصل دراسي جديد</button></div>
    <div class="card"><table>
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
        </tr>`).join("") || `<tr><td colspan="3" class="emptyState">لا توجد فصول دراسية بعد.</td></tr>`}
      </tbody></table></div>`;

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
      order_index: Number(m.el.querySelector("#semOrder").value) || 0
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
    <div class="card"><table>
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
        </tr>`).join("") || `<tr><td colspan="3" class="emptyState">لا توجد مواد بهذا الفصل بعد.</td></tr>`}
      </tbody></table></div>`;

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
    <div class="card"><table>
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
        </tr>`).join("") || `<tr><td colspan="5" class="emptyState">لا توجد روابط بهذه المادة بعد.</td></tr>`}
      </tbody></table></div>`;

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
