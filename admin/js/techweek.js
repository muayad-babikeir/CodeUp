// admin/js/techweek.js — إدارة الأسبوع التقني (نظام مستقل تمامًا عن الكورسات/الجامعة)

const TW_TYPE_LABEL = {workshop:"ورشة", course:"دورة", competition:"مسابقة", talk:"جلسة نقاشية"};
const TW_STATUS_LABEL = {draft:"مسودة", published:"منشورة", cancelled:"ملغاة"};

// إعدادات عامة للفعالية نفسها (مو إعدادات صفحة) — التعريف العام، التفعيل،
// وتواريخ الأسبوع. صف واحد ثابت بجدول tech_week_settings.
Admin.sections.tech_week_settings = {
  label: "إعدادات الأسبوع التقني",
  async render(body){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w60" style="height:30px;margin-bottom:12px"></div>`).join("")}</div>`;
    const { data: settings, error } = await db.from("tech_week_settings").select("*").eq("id", true).single();
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الإعدادات.</span><button class="btn alertRetry" id="twsRetry">إعادة المحاولة</button></div>`; body.querySelector("#twsRetry").onclick=()=>Admin.go("tech_week_settings"); return; }

    const toLocalInput = (iso)=> iso ? new Date(iso).toISOString().slice(0,16) : "";
    body.innerHTML = `
      <div class="card">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="twsEnabled" ${settings.is_enabled?"checked":""}> تفعيل الأسبوع التقني على المنصة
        </label>
        <p class="small" style="margin-top:6px">عند الإيقاف يختفي قسم الأسبوع التقني بالكامل عن الطلاب بتطبيق الطالب. صفحات إدارته هنا تبقى متاحة لكم دائمًا بغض النظر عن هذا المفتاح.</p>

        <label style="margin-top:14px">العنوان العام</label>
        <input id="twsTitle" value="${CodeUp.escapeHtml(settings.title||"")}" placeholder="مثال: الأسبوع التقني 2026">

        <label>الوصف</label>
        <textarea id="twsDesc" rows="4" placeholder="نبذة تعريفية عن الأسبوع التقني تظهر للطلاب...">${CodeUp.escapeHtml(settings.description||"")}</textarea>

        <label>يبدأ</label><input id="twsStart" type="datetime-local" value="${toLocalInput(settings.starts_at)}">
        <label>ينتهي</label><input id="twsEnd" type="datetime-local" value="${toLocalInput(settings.ends_at)}">

        <button class="btn dark" id="twsSave" style="margin-top:16px">حفظ الإعدادات</button>
      </div>
      <div id="twsMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>`;

    body.querySelector("#twsSave").onclick = async ()=>{
      const msgEl = body.querySelector("#twsMsg");
      msgEl.style.display = "none";
      const payload = {
        is_enabled: body.querySelector("#twsEnabled").checked,
        title: body.querySelector("#twsTitle").value.trim() || null,
        description: body.querySelector("#twsDesc").value.trim() || null,
        starts_at: body.querySelector("#twsStart").value ? new Date(body.querySelector("#twsStart").value).toISOString() : null,
        ends_at: body.querySelector("#twsEnd").value ? new Date(body.querySelector("#twsEnd").value).toISOString() : null,
        updated_by: Admin.ctx.user.id,
        updated_at: new Date().toISOString()
      };
      try{
        await db.from("tech_week_settings").update(payload).eq("id", true).throwOnError();
        CodeUp.toast("تم حفظ الإعدادات", "success");
      }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
    };
  }
};

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
  const mode = event?.registration_mode || "individual";
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

    <label>نمط التسجيل</label>
    <select id="evRegMode">
      <option value="individual" ${mode==="individual"?"selected":""}>فردي — كل طالب يسجّل بنفسه</option>
      <option value="team" ${mode==="team"?"selected":""}>فرق — الطلاب يسجّلون كفرق (مسابقات مثلًا)</option>
    </select>

    <div id="evIndivWrap" style="display:${mode==="individual"?"block":"none"}">
      <label>السعة القصوى (اختياري — اتركه فاضي لبدون حد)</label><input id="evCapacity" type="number" min="1" value="${event?.capacity??""}">
    </div>

    <div id="evTeamWrap" style="display:${mode==="team"?"block":"none"}">
      <label>الحد الأقصى لعدد الفرق (اختياري — اتركه فاضي لبدون حد)</label><input id="evTeamCapacity" type="number" min="1" value="${event?.capacity??""}">
      <label>أقل عدد أعضاء بالفريق (اختياري)</label><input id="evTeamMin" type="number" min="1" value="${event?.team_min_size??""}">
      <label>أعلى عدد أعضاء بالفريق (اختياري)</label><input id="evTeamMax" type="number" min="1" value="${event?.team_max_size??""}">
    </div>

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
  m.el.querySelector("#evRegMode").onchange = (e)=>{
    const isTeam = e.target.value === "team";
    m.el.querySelector("#evIndivWrap").style.display = isTeam?"none":"block";
    m.el.querySelector("#evTeamWrap").style.display = isTeam?"block":"none";
  };
  m.el.querySelector("#evCancel").onclick = m.close;
  m.el.querySelector("#evSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#evMsg");
    const regMode = m.el.querySelector("#evRegMode").value;
    const payload = {
      title: m.el.querySelector("#evTitle").value.trim(),
      type: m.el.querySelector("#evType").value,
      description: m.el.querySelector("#evDesc").value.trim() || null,
      speaker: m.el.querySelector("#evSpeaker").value.trim() || null,
      location: m.el.querySelector("#evLocation").value.trim() || null,
      starts_at: m.el.querySelector("#evStart").value ? new Date(m.el.querySelector("#evStart").value).toISOString() : null,
      ends_at: m.el.querySelector("#evEnd").value ? new Date(m.el.querySelector("#evEnd").value).toISOString() : null,
      registration_mode: regMode,
      capacity: regMode==="team"
        ? (m.el.querySelector("#evTeamCapacity").value ? Number(m.el.querySelector("#evTeamCapacity").value) : null)
        : (m.el.querySelector("#evCapacity").value ? Number(m.el.querySelector("#evCapacity").value) : null),
      team_min_size: regMode==="team" && m.el.querySelector("#evTeamMin").value ? Number(m.el.querySelector("#evTeamMin").value) : null,
      team_max_size: regMode==="team" && m.el.querySelector("#evTeamMax").value ? Number(m.el.querySelector("#evTeamMax").value) : null,
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
    const { data: events, error } = await db.from("tech_week_events").select("id,title,type,capacity,registration_mode").order("starts_at",{ascending:true,nullsFirst:false});
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الفعاليات.</span><button class="btn alertRetry" id="twrRetry">إعادة المحاولة</button></div>`; body.querySelector("#twrRetry").onclick=()=>Admin.go("tech_week_registrations"); return; }
    if(!events || !events.length){ body.innerHTML = `<div class="emptyStatePro"><h4>لا توجد فعاليات بعد</h4><p>أضف فعالية أولًا من صفحة الفعاليات.</p></div>`; return; }

    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>الفعالية</th><th>النوع</th><th>نمط التسجيل</th><th></th></tr></thead>
      <tbody>${events.map(e=>`
        <tr><td>${CodeUp.escapeHtml(e.title)}</td><td>${TW_TYPE_LABEL[e.type]||e.type}</td>
        <td>${e.registration_mode==='team'?'فرق':'فردي'}</td>
        <td><button class="btn" data-viewregs="${e.id}">عرض المسجّلين</button></td></tr>`).join("")}
      </tbody></table></div></div>`;

    body.querySelectorAll("[data-viewregs]").forEach(b=>{
      b.onclick = ()=> openRegistrationsDrawer(events.find(e=>e.id===b.dataset.viewregs));
    });
  }
};

async function openRegistrationsDrawer(event){
  const d = Admin.drawer(`<div class="emptyState">جارِ التحميل…</div>`);
  const isTeamMode = event.registration_mode === "team";
  const [{ data: regs, error }, teamsRes] = await Promise.all([
    db.from("tech_week_registrations").select("*, profiles(full_name,email)").eq("event_id", event.id).order("created_at"),
    isTeamMode ? db.from("tech_week_teams").select("*").eq("event_id", event.id).order("created_at") : Promise.resolve({data:[]})
  ]);
  if(error){ d.el.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المسجّلين.</span></div>`; return; }
  const teams = teamsRes.data || [];

  const markAttendedBtn = (r)=> r.status==='registered'?`<button class="btn" data-markattended="${r.id}">تم الحضور</button>`:"";
  const memberLine = (r)=>`
        <div class="attentionItem">
          <div class="aiBody">${CodeUp.escapeHtml(r.profiles?.full_name||r.profiles?.email||"")}
            <div class="aiMeta">${r.status==='registered'?'مسجّل':r.status==='attended'?'حضر':'ألغى التسجيل'}</div>
          </div>
          ${markAttendedBtn(r)}
        </div>`;

  const draw = ()=>{
    let listHtml;
    if(isTeamMode){
      listHtml = teams.map(t=>{
        const members = regs.filter(r=>r.team_id===t.id);
        const activeCount = members.filter(r=>r.status!=='cancelled').length;
        return `<div class="card2" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b>${CodeUp.escapeHtml(t.name)}</b>
            <span class="small">${activeCount}${event.team_max_size?` / ${event.team_max_size}`:""} عضو</span>
          </div>
          <div style="margin-top:8px">${members.map(memberLine).join("") || `<p class="small" style="margin:0">لا يوجد أعضاء بعد.</p>`}</div>
        </div>`;
      }).join("") || `<div class="emptyStatePro"><p style="margin:0">لا توجد فرق مسجّلة بعد.</p></div>`;
    }else{
      listHtml = regs.map(memberLine).join("") || `<div class="emptyStatePro"><p style="margin:0">لا يوجد تسجيلات بعد.</p></div>`;
    }
    d.el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <b>${CodeUp.escapeHtml(event.title)}</b>
        <button class="iconBtn" id="regsDrawerClose" aria-label="إغلاق">${Icon("x")}</button>
      </div>
      <p class="small">${isTeamMode
        ? `${teams.length} فريق${event.capacity?` من أصل ${event.capacity}`:""}`
        : `${regs.filter(r=>r.status==='registered').length} مسجّل${event.capacity?` من أصل ${event.capacity}`:""}`}</p>
      ${listHtml}
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

    const isSuper = Admin.role === "super" || !!Admin.ctx?.profile?.is_super_admin;

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newTwAnnBtn">+ إعلان جديد</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>العنوان</th><th>التاريخ</th><th>بالرئيسية العامة؟</th><th></th></tr></thead>
      <tbody>${(anns||[]).map(a=>`
        <tr><td>${CodeUp.escapeHtml(a.title)}</td><td class="small">${CodeUp.timeAgo(a.created_at)}</td>
        <td>${a.posted_to_home?`<span class="pill approved">نعم</span>`:`<span class="pill pending">لا</span>`}</td>
        <td><button class="btn danger" data-del="${a.id}">حذف</button></td></tr>`).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><p style="margin:0">لا توجد إعلانات بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelector("#newTwAnnBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>إعلان جديد — الأسبوع التقني</h3>
        <label>العنوان</label><input id="twaTitle">
        <label>المحتوى</label><textarea id="twaContent" rows="4"></textarea>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px${isSuper?"":";opacity:.5"}">
          <input type="checkbox" id="twaPostHome" ${isSuper?"":"disabled"}> انشر أيضًا بتبويب الرئيسية العام (يظهر لكل مستخدمي المنصة)
        </label>
        ${isSuper?"":`<p class="small" style="margin-top:4px">النشر بالرئيسية العامة يتطلب صلاحية المشرف العام.</p>`}
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="twaCancel">إلغاء</button><button class="btn dark" id="twaSave">نشر</button>
        </div><div id="twaMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
      `);
      m.el.querySelector("#twaCancel").onclick = m.close;
      m.el.querySelector("#twaSave").onclick = async ()=>{
        const msgEl = m.el.querySelector("#twaMsg");
        msgEl.style.display = "none";
        const title = m.el.querySelector("#twaTitle").value.trim();
        const content = m.el.querySelector("#twaContent").value.trim() || null;
        const postHome = isSuper && m.el.querySelector("#twaPostHome").checked;
        if(!title){ msgEl.style.display="block"; msgEl.textContent="العنوان مطلوب"; return; }
        try{
          await db.from("tech_week_announcements").insert({
            title, content, created_by: Admin.ctx.user.id, posted_to_home: postHome
          }).throwOnError();
          if(postHome){
            try{ await CodeUp.rpc.createAnnouncement(null, `[الأسبوع التقني] ${title}`, content, null); }
            catch(e){ CodeUp.toast("تم نشر إعلان الأسبوع التقني، لكن تعذّر نشره بالرئيسية العامة: "+e.message, "error"); }
          }
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
