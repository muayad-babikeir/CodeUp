// admin/js/university.js
// إدارة قسم "University" — مستقل تمامًا عن نظام الكورسات. صلاحية التعديل
// فعليًا مقصورة على سوبر أدمن عبر RLS (is_super_admin)، هذا الملف فقط
// يبني الواجهة؛ أي محاولة تعديل من غير سوبر أدمن سترجع خطأ من القاعدة.

// أنواع الروابط المتاحة لمصادر المادة (القديمة video/telegram/link تبقى صالحة)
const UNI_RESOURCE_TYPES = {video:"فيديو (يوتيوب وغيره)", telegram:"تيليجرام", link:"رابط عام", article:"مقال", pdf:"PDF", docs:"توثيق", github:"GitHub"};

// إدارة قائمة الجامعات نفسها + تعيين أدمن لكل جامعة — سوبر أدمن فقط (نفس نمط
// صفحة "أدمن الكورسات" بالحرف، لكن لجدول universities/university_admins الجديدين)
Admin.sections.universities = {
  label: "إدارة University",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
    const [{data: universities, error}, {data: admins}, {data: profiles}] = await Promise.all([
      db.from("universities").select("*").order("order_index"),
      db.from("university_admins").select("*, universities(name), profiles(full_name)").order("created_at",{ascending:false}),
      db.from("profiles").select("id,full_name").order("full_name")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الجامعات.</span><button class="btn alertRetry" id="univsRetry">إعادة المحاولة</button></div>`; body.querySelector("#univsRetry").onclick=()=>Admin.go("universities"); return; }
    const uaIds = [...new Set([...(admins||[]).map(a=>a.profile_id), ...(profiles||[]).map(p=>p.id)])];
    const { data: uaEmailRows } = uaIds.length ? await db.rpc("get_profile_emails", { p_user_ids: uaIds }) : { data: [] };
    const uaEmailById = {}; (uaEmailRows||[]).forEach(e=> uaEmailById[e.id]=e.email);

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newUnivBtn">+ جامعة جديدة</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>الجامعة</th><th>الترتيب</th><th></th></tr></thead>
      <tbody>${(universities||[]).map(u=>`
        <tr>
          <td>${CodeUp.escapeHtml(u.name)}</td>
          <td>${u.order_index}</td>
          <td><button class="btn" data-edit="${u.id}">تعديل</button> <button class="btn danger" data-deluniv="${u.id}">حذف</button></td>
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا توجد جامعات بعد.</p></div></td></tr>`}
      </tbody></table></div></div>

      <div class="card" style="margin-top:14px">
        <div class="toolbar"><b>أدمن University</b><button class="btn dark" id="assignUnivAdminBtn">+ تعيين أدمن University</button></div>
        <div class="tableScroll"><table><thead><tr><th>المستخدم</th><th>الجامعة</th><th>الدور</th><th></th></tr></thead>
        <tbody>${(admins||[]).map(a=>`
          <tr>
            <td>${CodeUp.escapeHtml(a.profiles?.full_name||uaEmailById[a.profile_id]||"")}</td>
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
    body.querySelectorAll("[data-deluniv]").forEach(b=>{
      b.onclick = async ()=>{
        const u = universities.find(x=>x.id===b.dataset.deluniv);
        if(!u) return;
        // وجهة أرشفة تيليجرام خاصة بهذه الجامعة تُحذف بحذفها (حذف متسلسل)، فنمنع الحذف بدل أن تضيع إعدادات الأرشفة بصمت
        const { data: dests } = await db.from("archive_destinations").select("id").eq("university_id", u.id).limit(1);
        if(dests && dests.length){ CodeUp.toast("لهذه الجامعة وجهة أرشفة تيليجرام خاصة بها. أزِلها أولًا قبل الحذف.", "error"); return; }
        const typed = await Admin.promptDialog({title:`حذف الجامعة "${u.name}"`, message:"سيُحذف معها كل فصولها ومواد المقررات ومصادرها وأدمنها، وملفات تيليجرام التي رُفعت عبر الموقع. لا يمكن التراجع.\nاكتب اسم الجامعة بالضبط للتأكيد:", placeholder:u.name, confirmLabel:"حذف نهائيًا", danger:true});
        if(typed===null) return;
        if(typed.trim()!==u.name.trim()){ CodeUp.toast("الاسم غير مطابق، لم يُحذف شيء","error"); return; }
        const { error } = await db.from("universities").delete().eq("id", u.id);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.kickTelegramCleanup();
        CodeUp.toast("تم حذف الجامعة","success");
        Admin.go("universities");
      };
    });
    body.querySelectorAll("[data-removeadmin]").forEach(b=>{
      b.onclick = async ()=>{
        if(!await Admin.confirmDialog({title:"إزالة صلاحية الإدارة", message:"سيفقد هذا المستخدم صلاحية إدارة هذه الجامعة.", confirmLabel:"إزالة", danger:true})) return;
        const { error } = await db.from("university_admins").delete().eq("id", b.dataset.removeadmin);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("universities");
      };
    });
    body.querySelector("#assignUnivAdminBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>تعيين أدمن University</h3>
        <label>الجامعة</label>
        <select id="uaUniv">${(universities||[]).map(u=>`<option value="${u.id}">${CodeUp.escapeHtml(u.name)}</option>`).join("")}</select>
        <label>المستخدم</label>
        <select id="uaUser">${(profiles||[]).map(p=>`<option value="${p.id}">${CodeUp.escapeHtml(p.full_name||uaEmailById[p.id]||p.id)}</option>`).join("")}</select>
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
  label: "محتوى University",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
    let q = db.from("universities").select("*").order("order_index");
    if(Admin.role === "university_admin") q = q.in("id", Admin.universityAdminIds);
    const { data: universities, error } = await q;
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الجامعات.</span><button class="btn alertRetry" id="uAdminRetry">إعادة المحاولة</button></div>`; body.querySelector("#uAdminRetry").onclick=()=>Admin.go("university"); return; }
    if(!universities || !universities.length){
      body.innerHTML = `<div class="emptyStatePro"><h4>لا توجد جامعة مُدارة بعد</h4><p>${Admin.role==="super"?"أنشئ جامعة من صفحة «إدارة University» أولًا.":"لا تملك صلاحية إدارة أي جامعة حاليًا."}</p></div>`;
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
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><h4>لا توجد فصول دراسية بعد</h4><p>أضف أول فصل لتنظيم مواد قسم University.</p></div></td></tr>`}
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
      if(!await Admin.confirmDialog({title:"حذف الفصل الدراسي", message:"سيُحذف بكل مواده وروابطه. لا يمكن التراجع.", confirmLabel:"حذف نهائيًا", danger:true})) return;
      const { error } = await db.from("university_semesters").delete().eq("id", b.dataset.del);
      if(error){ CodeUp.toast(error.message, "error"); return; }
      Admin.kickTelegramCleanup();
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
  // عدد مصادر كل مادة (patch_58)
  const resCount = {};
  const subjectIds = (subjects||[]).map(x=>x.id);
  if(subjectIds.length){
    const rc = await db.from("university_materials").select("subject_id").in("subject_id", subjectIds);
    (rc.data||[]).forEach(x=>{ resCount[x.subject_id] = (resCount[x.subject_id]||0)+1; });
  }
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
            <button class="btn dark" data-materials="${s.id}">المصادر${resCount[s.id]?` (${resCount[s.id]})`:""}</button>
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
    b.onclick = ()=> openSubjectResourcesModal(subjects.find(s=>s.id===b.dataset.materials), semester, body);
  });
  body.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick = async ()=>{
      if(!await Admin.confirmDialog({title:"حذف المادة", message:"سيُحذف بكل روابطه. لا يمكن التراجع.", confirmLabel:"حذف نهائيًا", danger:true})) return;
      const { error } = await db.from("university_subjects").delete().eq("id", b.dataset.del);
      if(error){ CodeUp.toast(error.message, "error"); return; }
      Admin.kickTelegramCleanup();
      renderSubjects(body, semester);
    };
  });
}

function openSubjectModal(subject, semester, body){
  const isEdit = !!subject;
  const esc = CodeUp.escapeHtml;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل مادة":"مادة جديدة"}</h3>
    <label>العنوان</label><input id="subjTitle" value="${subject?esc(subject.title):""}" placeholder="الرياضيات">
    <label>الشرح المكتوب (اختياري)</label><textarea id="subjText" rows="4">${esc(subject?.text_content||"")}</textarea>
    <label>رابط ملف PDF للمراجعة (اختياري)</label><input id="subjPdf" dir="ltr" placeholder="https://..." value="${esc(subject?.pdf_url||"")}">
    <label>رابط بطاقات Anki — العربية (اختياري)</label><input id="subjAnkiAr" dir="ltr" placeholder="https://..." value="${esc(subject?.anki_ar_url||"")}">
    <label>رابط بطاقات Anki — English (اختياري)</label><input id="subjAnkiEn" dir="ltr" placeholder="https://..." value="${esc(subject?.anki_en_url||"")}">
    <label>الترتيب</label><input id="subjOrder" type="number" value="${subject?.order_index??0}">
    <div class="small" style="margin-top:10px">المصدر الأساسي والبدائل والتعمّق تُضاف من زر «المصادر» في جدول المواد. PDF وAnki أعلاه تظهر للطالب في «للمذاكرة».</div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="subjCancel">إلغاء</button><button class="btn dark" id="subjSave">حفظ</button>
    </div>`);
  m.el.querySelector("#subjCancel").onclick = m.close;
  m.el.querySelector("#subjSave").onclick = async ()=>{
    const v = id=>m.el.querySelector(id).value.trim();
    const payload = {
      title: v("#subjTitle"),
      text_content: v("#subjText") || null,
      pdf_url: v("#subjPdf") || null,
      anki_ar_url: v("#subjAnkiAr") || null,
      anki_en_url: v("#subjAnkiEn") || null,
      order_index: Number(v("#subjOrder")) || 0
    };
    if(!payload.title){ CodeUp.toast("العنوان مطلوب", "error"); return; }
    for(const k of ["pdf_url","anki_ar_url","anki_en_url"]){
      if(payload[k] && !/^https?:\/\/.+/i.test(payload[k])){ CodeUp.toast("الروابط لازم تبدأ بـ http:// أو https://", "error"); return; }
    }
    const { error } = isEdit
      ? await db.from("university_subjects").update(payload).eq("id", subject.id)
      : await db.from("university_subjects").insert({...payload, semester_id: semester.id});
    if(error){ CodeUp.toast(error.message, "error"); return; }
    m.close();
    renderSubjects(body, semester);
  };
}

// مصادر المادة: نفس لوحة مصادر الدروس (resource_panel.js) لكن على جدول university_materials
function subjectResourceAdapter(subjectId){
  const thr = q=>q.throwOnError();
  const toRow = x=>({id:x.id, role:x.role||"alternative", order_index:x.order_index, title:x.title, url:x.url, type:x.material_type, publisher:x.publisher, language:x.language, duration_minutes:x.duration_minutes});
  const toCols = p=>({material_type:p.type, title:p.title, url:p.url, publisher:p.publisher, language:p.language, duration_minutes:p.duration_minutes});
  return {
    pageName:"المادة", fileCtx:{kind:"subject", id:subjectId}, types:UNI_RESOURCE_TYPES, defaultType:"video", hasStart:false,
    studyHelp:"ملخصات وبطاقات للمراجعة. ملف PDF وبطاقات Anki من «تعديل المادة» تظهر هنا تلقائيًا.",
    setupHint:"تأكد من تشغيل patch_58 في Supabase.",
    async load(){
      const {data, error} = await db.from("university_materials").select("*").eq("subject_id", subjectId);
      if(error) throw new Error(error.message);
      return (data||[]).map(toRow);
    },
    async create(p, role, idx){
      await thr(db.from("university_materials").insert({...toCols(p), role, order_index: idx, subject_id: subjectId, created_by: Admin.ctx?.user?.id || null}));
    },
    async update(row, p, role, newIdx){
      const patch = toCols(p);
      if(newIdx!==null){ patch.role = role; patch.order_index = newIdx; }
      await thr(db.from("university_materials").update(patch).eq("id", row.id));
    },
    async remove(row){ await thr(db.from("university_materials").delete().eq("id", row.id)); },
    async setOrder(row, idx){ await thr(db.from("university_materials").update({order_index: idx}).eq("id", row.id)); },
    async demoteRecommended(exceptId){
      let q = db.from("university_materials").update({role:"alternative"}).eq("subject_id", subjectId).eq("role","recommended");
      if(exceptId) q = q.neq("id", exceptId);
      await thr(q);
    }
  };
}

function openSubjectResourcesModal(subject, semester, body){
  const m = Admin.modal(`
    <h3>مصادر المادة: ${CodeUp.escapeHtml(subject.title)}</h3>
    <div id="srBox"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn dark" id="srDone">تم</button></div>`);
  renderResourcePanel(m.el.querySelector("#srBox"), subjectResourceAdapter(subject.id));
  m.el.querySelector("#srDone").onclick = ()=>{ m.close(); renderSubjects(body, semester); };
}
