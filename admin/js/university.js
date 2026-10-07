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
    const [{data: universities, error}, {data: admins}, {data: profiles}, {data: dests}] = await Promise.all([
      db.from("universities").select("*").order("order_index"),
      db.from("university_admins").select("*, universities(name), profiles(full_name)").order("created_at",{ascending:false}),
      db.from("profiles").select("id,full_name").order("full_name"),
      db.from("archive_destinations").select("*, university_years(year_number, title, university_programs(name, universities(name)))").order("created_at")
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
      </div>

      <div class="card" style="margin-top:14px">
        <div class="toolbar"><b>مجموعات Telegram</b><button class="btn dark" id="newDestBtn">+ إضافة مجموعة</button></div>
        <p class="small" style="margin:0 0 10px">لكل سنة دراسية مجموعة مستقلة (Forum). أنشئ المجموعة في تيليجرام، أضف البوت مشرفًا (إدارة المواضيع + حذف + تثبيت)، ثم أدخل Chat ID هنا واضغط «اختبار». ينشئ النظام موضوعًا لكل مادة تلقائيًا.</p>
        <div class="tableScroll"><table><thead><tr><th>الاسم</th><th>الكود</th><th>Chat ID</th><th>مرتبطة بـ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${(dests||[]).map(d=>{
          const y = d.university_years;
          const link = y ? `${CodeUp.escapeHtml(y.university_programs?.universities?.name||"")} › ${CodeUp.escapeHtml(y.university_programs?.name||"")} › ${CodeUp.escapeHtml(yearLabel(y))}` : `<span class="small">عامة / احتياطية</span>`;
          return `<tr>
            <td>${CodeUp.escapeHtml(d.title)}</td>
            <td dir="ltr">${CodeUp.escapeHtml(d.serial_code||"—")}</td>
            <td dir="ltr">${CodeUp.escapeHtml(d.telegram_chat_id)}</td>
            <td>${link}</td>
            <td><span class="pill ${d.is_active?"":"muted"}">${d.is_active?"Active":"Inactive"}</span></td>
            <td style="white-space:nowrap">
              <button class="btn" data-testdest="${d.id}">اختبار</button>
              <button class="btn" data-editdest="${d.id}">تعديل</button>
              <button class="btn danger" data-deldest="${d.id}">حذف</button>
            </td></tr>`; }).join("") || `<tr><td colspan="6"><div class="emptyStatePro"><p style="margin:0">لا توجد مجموعات تيليجرام بعد.</p></div></td></tr>`}
        </tbody></table></div>
      </div>`;

    body.querySelector("#newDestBtn").onclick = ()=> openDestinationModal(null);
    body.querySelectorAll("[data-editdest]").forEach(b=>{ b.onclick = ()=> openDestinationModal(dests.find(d=>d.id===b.dataset.editdest)); });
    body.querySelectorAll("[data-testdest]").forEach(b=>{ b.onclick = ()=> testDestination(dests.find(d=>d.id===b.dataset.testdest)); });
    body.querySelectorAll("[data-deldest]").forEach(b=>{
      b.onclick = async ()=>{
        const d = dests.find(x=>x.id===b.dataset.deldest);
        if(!await Admin.confirmDialog({title:`حذف المجموعة "${d.title}"`, message:"يُحذف ربطها وربط مواضيع المواد فقط. لا يُحذف شيء من تيليجرام نفسه، وبعدها تُرفع الملفات الجديدة للمجموعة العامة.", confirmLabel:"حذف", danger:true})) return;
        const { error } = await db.from("archive_destinations").delete().eq("id", d.id);
        if(error){ CodeUp.toast(error.message,"error"); return; }
        Admin.go("universities");
      };
    });

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
        if(dests && dests.length){ CodeUp.toast("لهذه الجامعة مجموعات تيليجرام مرتبطة بها. احذفها أولًا من بطاقة «مجموعات Telegram» ثم أعد المحاولة.", "error"); return; }
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

async function callEdgeFn(fn, body){
  const { data } = await db.auth.getSession();
  const token = data?.session?.access_token;
  if(!token) throw new Error("انتهت الجلسة، أعد تسجيل الدخول");
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`}, body: JSON.stringify(body) });
  return r.json().catch(()=>({error:"رد غير صالح من الخادم"}));
}

async function testDestination(dest){
  const m = Admin.modal(`<h3>اختبار: ${CodeUp.escapeHtml(dest.title)}</h3><div id="tdBox" class="small">جارِ الفحص…</div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn dark" id="tdDone">تم</button></div>`);
  m.el.querySelector("#tdDone").onclick = m.close;
  const box = m.el.querySelector("#tdBox");
  try{
    const r = await callEdgeFn("telegram-group-check", { chat_id: dest.telegram_chat_id });
    if(r.error){ box.innerHTML = `<span style="color:#F2555F">${CodeUp.escapeHtml(r.error)}</span>`; return; }
    box.innerHTML = `<p style="margin:0 0 8px"><b>${r.ok?"✅ المجموعة جاهزة":"⚠️ تحتاج إلى تعديل"}</b></p>` +
      (r.checks||[]).map(c=>`<div style="margin:4px 0">${c.ok?"✅":"❌"} ${CodeUp.escapeHtml(c.label)}${c.ok||!c.hint?"":`<div class="small" style="margin-inline-start:22px">${CodeUp.escapeHtml(c.hint)}</div>`}</div>`).join("");
  }catch(e){ box.innerHTML = `<span style="color:#F2555F">${CodeUp.escapeHtml(e.message)}</span>`; }
}

async function openDestinationModal(dest){
  const isEdit = !!dest;
  const { data: years } = await db.from("university_years").select("id, year_number, title, university_programs(name, university_id, universities(name))").order("year_number");
  const opts = (years||[]).map(y=>`<option value="${y.id}" ${dest&&dest.year_id===y.id?"selected":""}>${CodeUp.escapeHtml(`${y.university_programs?.universities?.name||""} › ${y.university_programs?.name||""} › ${yearLabel(y)}`)}</option>`).join("");
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل مجموعة Telegram":"مجموعة Telegram جديدة"}</h3>
    <label>الاسم</label><input id="dName" value="${dest?CodeUp.escapeHtml(dest.title):""}" placeholder="IT — Year 1">
    <label>الكود التعريفي (الرقم التسلسلي)</label><input id="dSerial" dir="ltr" value="${dest?CodeUp.escapeHtml(dest.serial_code||""):""}" placeholder="مثال: OIU-IT-Y1">
    <label>Chat ID</label><input id="dChat" dir="ltr" value="${dest?CodeUp.escapeHtml(dest.telegram_chat_id):""}" placeholder="-1001234567890" ${isEdit?"disabled":""}>
    ${isEdit?`<div class="small">لا يمكن تغيير Chat ID بعد الإنشاء (مواضيع المواد مرتبطة به). لمجموعة مختلفة أضف مجموعة جديدة.</div>`:""}
    <label>السنة الدراسية المرتبطة</label>
    <select id="dYear"><option value="">— عامة / احتياطية (بلا سنة) —</option>${opts}</select>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input id="dActive" type="checkbox" ${(!dest||dest.is_active)?"checked":""} style="width:auto"> Active</label>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="dCancel">إلغاء</button><button class="btn dark" id="dSave">حفظ</button>
    </div><div id="dMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>`);
  m.el.querySelector("#dCancel").onclick = m.close;
  m.el.querySelector("#dSave").onclick = async ()=>{
    const msg = m.el.querySelector("#dMsg");
    const fail = t=>{ msg.style.display="block"; msg.textContent=t; };
    const title = m.el.querySelector("#dName").value.trim();
    const chat = m.el.querySelector("#dChat").value.trim();
    const yearId = m.el.querySelector("#dYear").value || null;
    if(!title) return fail("الاسم مطلوب");
    if(!isEdit && !/^-?\d+$/.test(chat)) return fail("Chat ID أرقام فقط، مثل -1001234567890");
    const yr = (years||[]).find(y=>y.id===yearId);
    const payload = {
      title, serial_code: m.el.querySelector("#dSerial").value.trim() || null,
      year_id: yearId, university_id: yr ? yr.university_programs?.university_id : null,
      is_active: m.el.querySelector("#dActive").checked
    };
    if(!isEdit) payload.telegram_chat_id = chat;
    const { error } = isEdit ? await db.from("archive_destinations").update(payload).eq("id", dest.id) : await db.from("archive_destinations").insert(payload);
    if(error){
      if(/archive_destinations_year_active_key/.test(error.message)) return fail("هذه السنة لها مجموعة نشطة بالفعل. عطّل القديمة أو احذفها أولًا.");
      if(/archive_destinations_serial_key/.test(error.message)) return fail("هذا الكود مستخدم لمجموعة أخرى.");
      return fail(error.message);
    }
    m.close(); Admin.go("universities");
  };
}

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

    await renderPrograms(contentRoot);
  }
};

// ---- التنقل: البرنامج ← السنة (سمستران تلقائيًا) ← المادة ← المصادر ----
let uniNav = { program: null, year: null };
const uniSkeleton = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
const yearLabel = y => (y && (y.title || `Year ${y.year_number}`)) || "";

async function renderPrograms(body){
  uniNav = { program: null, year: null };
  body.innerHTML = uniSkeleton;
  const { data: programs, error } = await db.from("university_programs").select("*").eq("university_id", Admin.currentUniversityId).order("order_index").order("created_at");
  if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل البرامج.</span><button class="btn alertRetry" id="uniRetry">إعادة المحاولة</button></div>`; body.querySelector("#uniRetry").onclick=()=>Admin.go("university"); return; }
  body.innerHTML = `
    <div class="toolbar"><button class="btn dark" id="newProgramBtn">+ برنامج جديد</button></div>
    <div class="card"><div class="tableScroll"><table>
      <thead><tr><th>البرنامج / المجموعة الدراسية</th><th>الترتيب</th><th></th></tr></thead>
      <tbody>${(programs||[]).map(pr=>`
        <tr>
          <td>${CodeUp.escapeHtml(pr.name)}</td>
          <td>${pr.order_index}</td>
          <td>
            <button class="btn dark" data-years="${pr.id}">السنوات</button>
            <button class="btn" data-editprog="${pr.id}">تعديل</button>
            <button class="btn danger" data-delprog="${pr.id}">حذف</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><h4>لا توجد برامج بعد</h4><p>أضف أول برنامج (مثل: Information Technology) ثم أضف له السنوات.</p></div></td></tr>`}
      </tbody></table></div></div>`;
  body.querySelector("#newProgramBtn").onclick = ()=> openProgramModal(null, body);
  body.querySelectorAll("[data-editprog]").forEach(b=>{ b.onclick = ()=> openProgramModal(programs.find(x=>x.id===b.dataset.editprog), body); });
  body.querySelectorAll("[data-years]").forEach(b=>{ b.onclick = ()=> renderYears(body, programs.find(x=>x.id===b.dataset.years)); });
  body.querySelectorAll("[data-delprog]").forEach(b=>{
    b.onclick = async ()=>{
      const pr = programs.find(x=>x.id===b.dataset.delprog);
      const typed = await Admin.promptDialog({title:`حذف البرنامج "${pr.name}"`, message:"سيُحذف بكل سنواته وسمسترته ومواده ومصادره (وملفات ومواضيع تيليجرام المرتبطة بالمواد). لا يمكن التراجع.\nاكتب اسم البرنامج بالضبط للتأكيد:", placeholder:pr.name, confirmLabel:"حذف نهائيًا", danger:true});
      if(typed===null) return;
      if(typed.trim()!==pr.name.trim()){ CodeUp.toast("الاسم غير مطابق، لم يُحذف شيء","error"); return; }
      const { error } = await db.from("university_programs").delete().eq("id", pr.id);
      if(error){ CodeUp.toast(error.message, "error"); return; }
      Admin.kickTelegramCleanup();
      CodeUp.toast("تم حذف البرنامج","success");
      renderPrograms(body);
    };
  });
}

function openProgramModal(program, body){
  const isEdit = !!program;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل برنامج":"برنامج جديد"}</h3>
    <label>الاسم</label><input id="progName" value="${program?CodeUp.escapeHtml(program.name):""}" placeholder="Information Technology">
    <label>الترتيب</label><input id="progOrder" type="number" value="${program?.order_index??0}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="progCancel">إلغاء</button><button class="btn dark" id="progSave">حفظ</button>
    </div>`);
  m.el.querySelector("#progCancel").onclick = m.close;
  m.el.querySelector("#progSave").onclick = async ()=>{
    const payload = { name: m.el.querySelector("#progName").value.trim(), order_index: Number(m.el.querySelector("#progOrder").value)||0 };
    if(!payload.name){ CodeUp.toast("الاسم مطلوب","error"); return; }
    const { error } = isEdit
      ? await db.from("university_programs").update(payload).eq("id", program.id)
      : await db.from("university_programs").insert({ ...payload, university_id: Admin.currentUniversityId });
    if(error){ CodeUp.toast(error.message,"error"); return; }
    m.close(); renderPrograms(body);
  };
}

async function renderYears(body, program){
  uniNav = { program, year: null };
  body.innerHTML = uniSkeleton;
  const { data: years, error } = await db.from("university_years").select("*, university_semesters(id,title,semester_number,order_index,university_id,year_id)").eq("program_id", program.id).order("year_number");
  if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل السنوات.</span><button class="btn alertRetry" id="uniRetry">إعادة المحاولة</button></div>`; body.querySelector("#uniRetry").onclick=()=>renderYears(body, program); return; }
  // مجموعات تيليجرام المرتبطة بالسنوات (تقرأها القاعدة للسوبر أدمن فقط؛ لغيره تظهر الخانة فارغة)
  let groups = null;
  const ids = (years||[]).map(y=>y.id);
  if(ids.length && Admin.role === "super"){
    const g = await db.from("archive_destinations").select("year_id,title,is_active").in("year_id", ids);
    if(!g.error){ groups = {}; (g.data||[]).forEach(x=>{ groups[x.year_id] = x; }); }
  }
  const nextNum = Math.max(0, ...(years||[]).map(y=>y.year_number)) + 1;
  body.innerHTML = `
    <button class="btn" id="backToPrograms" style="margin-bottom:10px">← رجوع للبرامج</button>
    <div class="toolbar"><b>${CodeUp.escapeHtml(program.name)}</b><button class="btn dark" id="newYearBtn">+ إضافة سنة (Year ${nextNum})</button></div>
    <div class="card"><div class="tableScroll"><table>
      <thead><tr><th>السنة</th><th>السمسترات</th>${groups?`<th>مجموعة Telegram</th>`:""}<th></th></tr></thead>
      <tbody>${(years||[]).map(y=>{
        const sems = (y.university_semesters||[]).slice().sort((a,b)=>a.semester_number-b.semester_number);
        const g = groups && groups[y.id];
        return `<tr>
          <td><b>${CodeUp.escapeHtml(yearLabel(y))}</b></td>
          <td>${sems.map(sm=>`<span style="white-space:nowrap"><button class="btn dark" data-sem="${sm.id}">${CodeUp.escapeHtml(sm.title)} · المواد</button><button class="btn" data-renamesem="${sm.id}" title="تعديل العنوان">✎</button></span>`).join(" ")}</td>
          ${groups?`<td>${g?`<span class="pill">${CodeUp.escapeHtml(g.title)}${g.is_active?"":" (متوقفة)"}</span>`:`<span class="small">بلا مجموعة</span>`}</td>`:""}
          <td>
            <button class="btn" data-edityear="${y.id}">العنوان</button>
            <button class="btn danger" data-delyear="${y.id}">حذف</button>
          </td>
        </tr>`; }).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><h4>لا توجد سنوات بعد</h4><p>اضغط «إضافة سنة» وسيُنشأ لها سمستران تلقائيًا.</p></div></td></tr>`}
      </tbody></table></div></div>`;
  body.querySelector("#backToPrograms").onclick = ()=> renderPrograms(body);
  body.querySelector("#newYearBtn").onclick = async ()=>{
    const { error } = await db.from("university_years").insert({ program_id: program.id, year_number: nextNum });
    if(error){ CodeUp.toast(error.message,"error"); return; }
    CodeUp.toast(`تمت إضافة Year ${nextNum} مع سمسترَيها`,"success");
    renderYears(body, program);
  };
  body.querySelectorAll("[data-sem]").forEach(b=>{
    b.onclick = ()=>{
      const y = years.find(x=>(x.university_semesters||[]).some(sm=>sm.id===b.dataset.sem));
      uniNav = { program, year: y };
      renderSubjects(body, y.university_semesters.find(sm=>sm.id===b.dataset.sem));
    };
  });
  body.querySelectorAll("[data-renamesem]").forEach(b=>{
    b.onclick = async ()=>{
      const sm = years.flatMap(y=>y.university_semesters||[]).find(x=>x.id===b.dataset.renamesem);
      const t = await Admin.promptDialog({title:"عنوان السمستر", defaultValue:sm.title, confirmLabel:"حفظ"});
      if(t===null) return;
      if(!t.trim()){ CodeUp.toast("العنوان مطلوب","error"); return; }
      const { error } = await db.from("university_semesters").update({ title: t.trim() }).eq("id", sm.id);
      if(error){ CodeUp.toast(error.message,"error"); return; }
      renderYears(body, program);
    };
  });
  body.querySelectorAll("[data-edityear]").forEach(b=>{
    b.onclick = async ()=>{
      const y = years.find(x=>x.id===b.dataset.edityear);
      const t = await Admin.promptDialog({title:"عنوان السنة", message:`اتركه فارغًا ليظهر "Year ${y.year_number}".`, defaultValue:y.title||"", confirmLabel:"حفظ"});
      if(t===null) return;
      const { error } = await db.from("university_years").update({ title: t.trim()||null }).eq("id", y.id);
      if(error){ CodeUp.toast(error.message,"error"); return; }
      renderYears(body, program);
    };
  });
  body.querySelectorAll("[data-delyear]").forEach(b=>{
    b.onclick = async ()=>{
      const y = years.find(x=>x.id===b.dataset.delyear);
      if(!await Admin.confirmDialog({title:`حذف ${yearLabel(y)}`, message:"سيُحذف بسمستريه وكل موادها ومصادرها (وملفات ومواضيع تيليجرام المرتبطة بالمواد). لا يمكن التراجع.", confirmLabel:"حذف نهائيًا", danger:true})) return;
      const { error } = await db.from("university_years").delete().eq("id", y.id);
      if(error){ CodeUp.toast(error.message,"error"); return; }
      Admin.kickTelegramCleanup();
      renderYears(body, program);
    };
  });
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
    <button class="btn" id="backToSemesters" style="margin-bottom:10px">← رجوع للسنوات</button>
    <div class="toolbar"><b>${CodeUp.escapeHtml([uniNav.program?.name, uniNav.year?yearLabel(uniNav.year):"", semester.title].filter(Boolean).join(" › "))}</b><button class="btn dark" id="newSubjectBtn">+ مادة جديدة</button></div>
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
        </tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا توجد مواد بهذا السمستر بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;

  body.querySelector("#backToSemesters").onclick = ()=> uniNav.program ? renderYears(body, uniNav.program) : renderPrograms(body);
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
      const {data: ins} = await thr(db.from("university_materials").insert({...toCols(p), role, order_index: idx, subject_id: subjectId, created_by: Admin.ctx?.user?.id || null}).select("id").single());
      return ins.id;   // معرّف المصدر (يُستخدم لنشر رسالة الرابط في تيليجرام)
    },
    async update(row, p, role, newIdx){
      const patch = toCols(p);
      if(newIdx!==null){ patch.role = role; patch.order_index = newIdx; }
      await thr(db.from("university_materials").update(patch).eq("id", row.id));
      return row.id;
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
