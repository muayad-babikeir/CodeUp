// admin/js/techweek.js — إدارة الأسبوع التقني (نظام مستقل تمامًا عن الكورسات/الجامعة)

const TW_TYPE_LABEL = {workshop:"ورشة", course:"دورة", competition:"مسابقة", talk:"جلسة نقاشية"};
const TW_STATUS_LABEL = {draft:"مسودة", published:"منشورة", cancelled:"ملغاة"};

Admin.sections.tech_week_events = {
  label: "فعاليات الأسبوع التقني",
  async render(body){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:40px;margin-bottom:10px"></div>`).join("")}</div>`;
    const [{ data: events, error }, { data: regs }] = await Promise.all([
      db.from("tech_week_events").select("*").order("starts_at",{ascending:true,nullsFirst:false}),
      db.from("tech_week_registrations").select("event_id,status")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الفعاليات.</span><button class="btn alertRetry" id="twRetry">إعادة المحاولة</button></div>`; body.querySelector("#twRetry").onclick=()=>Admin.go("tech_week_events"); return; }

    const regCount = {};
    (regs||[]).forEach(r=>{ if(r.status==="registered") regCount[r.event_id] = (regCount[r.event_id]||0)+1; });

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newEventBtn">+ فعالية جديدة</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>الفعالية</th><th>النوع</th><th>الموعد</th><th>الحالة</th><th>المسجّلون</th><th></th></tr></thead>
      <tbody>${(events||[]).map(e=>`
        <tr>
          <td><b>${CodeUp.escapeHtml(e.title)}</b>${e.location?`<div class="small">${CodeUp.escapeHtml(e.location)}</div>`:""}</td>
          <td>${TW_TYPE_LABEL[e.type]||e.type}</td>
          <td class="small">${e.starts_at?CodeUp.formatDate(e.starts_at):"—"}</td>
          <td><span class="pill ${e.status==='published'?'approved':e.status==='cancelled'?'rejected':'pending'}">${TW_STATUS_LABEL[e.status]}</span></td>
          <td>${regCount[e.id]||0}${e.capacity?` / ${e.capacity}`:""}</td>
          <td><button class="btn" data-edit="${e.id}">تعديل</button></td>
        </tr>`).join("") || `<tr><td colspan="6"><div class="emptyStatePro"><h4>لا توجد فعاليات بعد</h4><p>أضف أول فعالية بالأسبوع التقني (ورشة، دورة، مسابقة، أو جلسة نقاشية).</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelector("#newEventBtn").onclick = ()=> openEventModal();
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openEventModal(events.find(e=>e.id===b.dataset.edit));
    });
  }
};

function openEventModal(event){
  const isEdit = !!event;
  const toLocalInput = (iso)=> iso ? new Date(iso).toISOString().slice(0,16) : "";
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل فعالية":"فعالية جديدة"}</h3>
    <label>العنوان</label><input id="evTitle" value="${event?CodeUp.escapeHtml(event.title):""}">
    <label>النوع</label>
    <select id="evType">${Object.entries(TW_TYPE_LABEL).map(([k,l])=>`<option value="${k}" ${event?.type===k?"selected":""}>${l}</option>`).join("")}</select>
    <label>الوصف (اختياري)</label><textarea id="evDesc" rows="3">${event?CodeUp.escapeHtml(event.description||""):""}</textarea>
    <label>المتحدث/المدرّب (اختياري)</label><input id="evSpeaker" value="${event?CodeUp.escapeHtml(event.speaker||""):""}">
    <label>المكان (اختياري)</label><input id="evLocation" value="${event?CodeUp.escapeHtml(event.location||""):""}">
    <label>يبدأ</label><input id="evStart" type="datetime-local" value="${toLocalInput(event?.starts_at)}">
    <label>ينتهي (اختياري)</label><input id="evEnd" type="datetime-local" value="${toLocalInput(event?.ends_at)}">
    <label>السعة القصوى (اختياري — اتركه فاضي لبدون حد)</label><input id="evCapacity" type="number" min="1" value="${event?.capacity??""}">
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px">
      <input type="checkbox" id="evRegOpen" ${event?.registration_open!==false?"checked":""}> التسجيل مفتوح حاليًا
    </label>
    <label>الحالة</label>
    <select id="evStatus">
      <option value="draft" ${(!event||event.status==='draft')?"selected":""}>مسودة (غير ظاهرة للطلاب)</option>
      <option value="published" ${event?.status==='published'?"selected":""}>منشورة</option>
      <option value="cancelled" ${event?.status==='cancelled'?"selected":""}>ملغاة</option>
    </select>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between">
      ${isEdit?`<button class="btn danger" id="evDelete">حذف الفعالية</button>`:"<span></span>"}
      <div style="display:flex;gap:8px">
        <button class="btn" id="evCancel">إلغاء</button><button class="btn dark" id="evSave">حفظ</button>
      </div>
    </div>
    <div id="evMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#evCancel").onclick = m.close;
  m.el.querySelector("#evSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#evMsg");
    const payload = {
      title: m.el.querySelector("#evTitle").value.trim(),
      type: m.el.querySelector("#evType").value,
      description: m.el.querySelector("#evDesc").value.trim() || null,
      speaker: m.el.querySelector("#evSpeaker").value.trim() || null,
      location: m.el.querySelector("#evLocation").value.trim() || null,
      starts_at: m.el.querySelector("#evStart").value ? new Date(m.el.querySelector("#evStart").value).toISOString() : null,
      ends_at: m.el.querySelector("#evEnd").value ? new Date(m.el.querySelector("#evEnd").value).toISOString() : null,
      capacity: m.el.querySelector("#evCapacity").value ? Number(m.el.querySelector("#evCapacity").value) : null,
      registration_open: m.el.querySelector("#evRegOpen").checked,
      status: m.el.querySelector("#evStatus").value
    };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان مطلوب"; return; }
    try{
      if(isEdit){ payload.updated_at = new Date().toISOString(); await db.from("tech_week_events").update(payload).eq("id", event.id).throwOnError(); }
      else await db.from("tech_week_events").insert({...payload, created_by: Admin.ctx.user.id}).throwOnError();
      m.close(); Admin.go("tech_week_events");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
  const delBtn = m.el.querySelector("#evDelete");
  if(delBtn) delBtn.onclick = async ()=>{
    if(!confirm(`حذف "${event.title}" نهائيًا؟\n\nسيُحذف كل تسجيلات الطلاب فيها معها، ولا يمكن التراجع.`)) return;
    const { error } = await db.from("tech_week_events").delete().eq("id", event.id);
    if(error){ CodeUp.toast(error.message, "error"); return; }
    m.close(); Admin.go("tech_week_events");
  };
}

Admin.sections.tech_week_registrations = {
  label: "تسجيلات الأسبوع التقني",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: events, error } = await db.from("tech_week_events").select("id,title,type,capacity").order("starts_at",{ascending:true,nullsFirst:false});
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الفعاليات.</span><button class="btn alertRetry" id="twrRetry">إعادة المحاولة</button></div>`; body.querySelector("#twrRetry").onclick=()=>Admin.go("tech_week_registrations"); return; }
    if(!events || !events.length){ body.innerHTML = `<div class="emptyStatePro"><h4>لا توجد فعاليات بعد</h4><p>أضف فعالية أولًا من صفحة الفعاليات.</p></div>`; return; }

    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>الفعالية</th><th>النوع</th><th></th></tr></thead>
      <tbody>${events.map(e=>`
        <tr><td>${CodeUp.escapeHtml(e.title)}</td><td>${TW_TYPE_LABEL[e.type]||e.type}</td>
        <td><button class="btn" data-viewregs="${e.id}">عرض المسجّلين</button></td></tr>`).join("")}
      </tbody></table></div></div>`;

    body.querySelectorAll("[data-viewregs]").forEach(b=>{
      b.onclick = ()=> openRegistrationsDrawer(events.find(e=>e.id===b.dataset.viewregs));
    });
  }
};

async function openRegistrationsDrawer(event){
  const d = Admin.drawer(`<div class="emptyState">جارِ التحميل…</div>`);
  const { data: regs, error } = await db.from("tech_week_registrations").select("*, profiles(full_name,email)").eq("event_id", event.id).order("created_at");
  if(error){ d.el.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المسجّلين.</span></div>`; return; }

  const draw = ()=>{
    d.el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <b>${CodeUp.escapeHtml(event.title)}</b>
        <button class="iconBtn" id="regsDrawerClose" aria-label="إغلاق">${Icon("x")}</button>
      </div>
      <p class="small">${regs.filter(r=>r.status==='registered').length} مسجّل${event.capacity?` من أصل ${event.capacity}`:""}</p>
      ${regs.map(r=>`
        <div class="attentionItem">
          <div class="aiBody">${CodeUp.escapeHtml(r.profiles?.full_name||r.profiles?.email||"")}
            <div class="aiMeta">${r.status==='registered'?'مسجّل':r.status==='attended'?'حضر':'ألغى التسجيل'}</div>
          </div>
          ${r.status==='registered'?`<button class="btn" data-markattended="${r.id}">تم الحضور</button>`:""}
        </div>`).join("") || `<div class="emptyStatePro"><p style="margin:0">لا يوجد تسجيلات بعد.</p></div>`}
    `;
    d.el.querySelector("#regsDrawerClose").onclick = d.close;
    d.el.querySelectorAll("[data-markattended]").forEach(b=>{
      b.onclick = async ()=>{
        await db.from("tech_week_registrations").update({status:"attended"}).eq("id", b.dataset.markattended);
        const row = regs.find(r=>r.id===b.dataset.markattended);
        if(row) row.status = "attended";
        draw();
      };
    });
  };
  draw();
}

Admin.sections.tech_week_announcements = {
  label: "إعلانات الأسبوع التقني",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: anns, error } = await db.from("tech_week_announcements").select("*").order("created_at",{ascending:false});
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الإعلانات.</span><button class="btn alertRetry" id="twaRetry">إعادة المحاولة</button></div>`; body.querySelector("#twaRetry").onclick=()=>Admin.go("tech_week_announcements"); return; }

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newTwAnnBtn">+ إعلان جديد</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>العنوان</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${(anns||[]).map(a=>`
        <tr><td>${CodeUp.escapeHtml(a.title)}</td><td class="small">${CodeUp.timeAgo(a.created_at)}</td>
        <td><button class="btn danger" data-del="${a.id}">حذف</button></td></tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا توجد إعلانات بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelector("#newTwAnnBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>إعلان جديد — الأسبوع التقني</h3>
        <label>العنوان</label><input id="twaTitle">
        <label>المحتوى</label><textarea id="twaContent" rows="4"></textarea>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="twaCancel">إلغاء</button><button class="btn dark" id="twaSave">نشر</button>
        </div><div id="twaMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
      `);
      m.el.querySelector("#twaCancel").onclick = m.close;
      m.el.querySelector("#twaSave").onclick = async ()=>{
        const msgEl = m.el.querySelector("#twaMsg");
        const title = m.el.querySelector("#twaTitle").value.trim();
        if(!title){ msgEl.style.display="block"; msgEl.textContent="العنوان مطلوب"; return; }
        try{
          await db.from("tech_week_announcements").insert({
            title, content: m.el.querySelector("#twaContent").value.trim() || null, created_by: Admin.ctx.user.id
          }).throwOnError();
          m.close(); Admin.go("tech_week_announcements");
        }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
      };
    };
    body.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("حذف هذا الإعلان نهائيًا؟")) return;
        const { error } = await db.from("tech_week_announcements").delete().eq("id", b.dataset.del);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("tech_week_announcements");
      };
    });
  }
};

// إدارة فريق الأسبوع التقني — سوبر أدمن فقط (نفس نمط أدمن الكورسات/الجامعات بالحرف)
Admin.sections.tech_week_team = {
  label: "فريق الأسبوع التقني",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const [{ data: admins, error }, { data: profiles }] = await Promise.all([
      db.from("tech_week_admins").select("*, profiles(full_name,email)").order("created_at",{ascending:false}),
      db.from("profiles").select("id,full_name,email").order("full_name")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الفريق.</span><button class="btn alertRetry" id="twtRetry">إعادة المحاولة</button></div>`; body.querySelector("#twtRetry").onclick=()=>Admin.go("tech_week_team"); return; }

    body.innerHTML = `
      <p class="small" style="margin-bottom:10px">صلاحية واحدة مرنة حاليًا (تصل لكل محتوى الأسبوع التقني) — يمكن تقسيمها لاحقًا حسب الحاجة.</p>
      <div class="toolbar"><button class="btn dark" id="assignTwAdminBtn">+ إضافة عضو للفريق</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>العضو</th><th>الدور</th><th></th></tr></thead>
      <tbody>${(admins||[]).map(a=>`
        <tr><td>${CodeUp.escapeHtml(a.profiles?.full_name||a.profiles?.email||"")}</td>
        <td><span class="pill ${a.role}">${a.role==='owner'?'مالك':'أدمن'}</span></td>
        <td><button class="btn danger" data-remove="${a.id}">إزالة</button></td></tr>`).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><p style="margin:0">لا يوجد أعضاء بالفريق بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelector("#assignTwAdminBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>إضافة عضو لفريق الأسبوع التقني</h3>
        <label>المستخدم</label>
        <select id="twaUser">${(profiles||[]).map(p=>`<option value="${p.id}">${CodeUp.escapeHtml(p.full_name||p.email)}</option>`).join("")}</select>
        <label>الدور</label>
        <select id="twaRole"><option value="admin">أدمن</option><option value="owner">مالك</option></select>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="twaCancel">إلغاء</button><button class="btn dark" id="twaSave">إضافة</button>
        </div><div id="twaMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
      `);
      m.el.querySelector("#twaCancel").onclick = m.close;
      m.el.querySelector("#twaSave").onclick = async ()=>{
        const msgEl = m.el.querySelector("#twaMsg");
        try{
          await db.from("tech_week_admins").insert({
            profile_id: m.el.querySelector("#twaUser").value,
            role: m.el.querySelector("#twaRole").value
          }).throwOnError();
          m.close(); Admin.go("tech_week_team");
        }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
      };
    };
    body.querySelectorAll("[data-remove]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("إزالة هذا العضو من فريق الأسبوع التقني؟")) return;
        const { error } = await db.from("tech_week_admins").delete().eq("id", b.dataset.remove);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("tech_week_team");
      };
    });
  }
};
