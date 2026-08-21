// admin/js/people.js

Admin.sections.users = {
  label: "المستخدمون", icon: "👤",
  async render(body){
    const { data: profiles } = await db.from("profiles").select("*").order("created_at",{ascending:false}).limit(200);
    body.innerHTML = `
      <div class="toolbar"><input id="userSearch" placeholder="بحث بالاسم أو البريد…"></div>
      <div class="card"><table><thead><tr><th>الاسم</th><th>البريد</th><th>سوبر أدمن</th><th>تاريخ الانضمام</th><th></th></tr></thead>
      <tbody id="usersBody"></tbody></table></div>`;
    const tbody = body.querySelector("#usersBody");
    const draw = (list)=>{
      tbody.innerHTML = list.map(p=>`
        <tr>
          <td>${CodeUp.escapeHtml(p.full_name||"—")}</td>
          <td>${CodeUp.escapeHtml(p.email||"")}</td>
          <td>${p.is_super_admin?'<span class="pill approved">نعم</span>':'<span class="pill">لا</span>'}</td>
          <td>${CodeUp.formatDate(p.created_at)}</td>
          <td>${p.id===Admin.ctx.user.id?'':`<button class="btn" data-toggle="${p.id}" data-val="${!p.is_super_admin}">${p.is_super_admin?'إزالة الصلاحية':'ترقية لسوبر أدمن'}</button>`}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="emptyState">لا يوجد مستخدمون.</td></tr>`;
      tbody.querySelectorAll("[data-toggle]").forEach(b=>{
        b.onclick = async ()=>{
          if(!confirm("تأكيد تغيير صلاحية هذا المستخدم؟")) return;
          const { error } = await db.from("profiles").update({ is_super_admin: b.dataset.val==="true" }).eq("id", b.dataset.toggle);
          if(error) CodeUp.toast(error.message, "error"); else Admin.go("users");
        };
      });
    };
    draw(profiles||[]);
    body.querySelector("#userSearch").oninput = CodeUp.debounce(e=>{
      const q = e.target.value.trim().toLowerCase();
      draw((profiles||[]).filter(p=>(p.full_name||"").toLowerCase().includes(q)||(p.email||"").toLowerCase().includes(q)));
    }, 200);
  }
};

Admin.sections.squads = {
  label: "المجموعات", icon: "👥",
  async render(body){
    const cid = Admin.currentCourseId;
    if(!cid){ body.innerHTML = `<div class="emptyState">اختر كورسًا أولًا.</div>`; return; }
    const { data: squads } = await db.from("squads").select("*, squad_leaders(profile_id, profiles(full_name))").eq("course_id", cid).order("created_at");
    const { data: counts } = await db.from("enrollments").select("squad_id").eq("course_id", cid);
    const memberCount = {};
    (counts||[]).forEach(e=>{ if(e.squad_id) memberCount[e.squad_id] = (memberCount[e.squad_id]||0)+1; });

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newSquadBtn">+ مجموعة جديدة</button></div>
      <div class="card"><table><thead><tr><th>المجموعة</th><th>القادة</th><th>الأعضاء</th><th>السعة</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${(squads||[]).map(sq=>`
        <tr>
          <td>${sq.emoji||"🏆"} ${CodeUp.escapeHtml(sq.name)}</td>
          <td>${(sq.squad_leaders||[]).map(l=>CodeUp.escapeHtml(l.profiles?.full_name||"")).join("، ")||"—"}</td>
          <td>${memberCount[sq.id]||0}</td>
          <td>${sq.capacity??"—"}</td>
          <td><span class="pill ${sq.status==='active'?'approved':'rejected'}">${sq.status==='active'?'نشطة':'مؤرشفة'}</span></td>
          <td><button class="btn" data-edit="${sq.id}">تعديل</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="emptyState">لا توجد مجموعات بعد.</td></tr>`}
      </tbody></table></div>`;

    body.querySelector("#newSquadBtn").onclick = ()=> openSquadModal(cid);
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openSquadModal(cid, squads.find(s=>s.id===b.dataset.edit));
    });
  }
};

function openSquadModal(courseId, squad){
  const isEdit = !!squad;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل المجموعة":"مجموعة جديدة"}</h3>
    <label>الاسم</label><input id="sqName" value="${squad?CodeUp.escapeHtml(squad.name):""}">
    <label>الإيموجي</label><input id="sqEmoji" value="${squad?CodeUp.escapeHtml(squad.emoji||"🏆"):"🏆"}">
    <label>الوصف</label><textarea id="sqDesc" rows="2">${squad?CodeUp.escapeHtml(squad.description||""):""}</textarea>
    <label>السعة (اختياري)</label><input id="sqCap" type="number" min="1" value="${squad?.capacity??""}">
    <label>الحالة</label>
    <select id="sqStatus"><option value="active" ${!squad||squad.status==='active'?'selected':''}>نشطة</option><option value="archived" ${squad?.status==='archived'?'selected':''}>مؤرشفة</option></select>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="sqCancel">إلغاء</button><button class="btn dark" id="sqSave">حفظ</button>
    </div><div id="sqMsg" class="emptyState" style="display:none;padding:8px;color:#b42318"></div>
  `);
  m.el.querySelector("#sqCancel").onclick = m.close;
  m.el.querySelector("#sqSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#sqMsg");
    const payload = {
      name: m.el.querySelector("#sqName").value.trim(),
      emoji: m.el.querySelector("#sqEmoji").value.trim() || "🏆",
      description: m.el.querySelector("#sqDesc").value.trim(),
      capacity: m.el.querySelector("#sqCap").value ? Number(m.el.querySelector("#sqCap").value) : null,
      status: m.el.querySelector("#sqStatus").value
    };
    if(!payload.name){ msgEl.style.display="block"; msgEl.textContent="الاسم إلزامي"; return; }
    try{
      if(isEdit) await db.from("squads").update(payload).eq("id", squad.id).throwOnError();
      else await db.from("squads").insert({...payload, course_id: courseId}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); Admin.go("squads");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

Admin.sections.leaders = {
  label: "القادة", icon: "👑",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data: leaders } = await db.from("squad_leaders").select("*, profiles(full_name,email), squads!inner(name,course_id)").eq("squads.course_id", cid);
    body.innerHTML = `<div class="card"><table><thead><tr><th>القائد</th><th>المجموعة</th><th></th></tr></thead>
      <tbody>${(leaders||[]).map(l=>`
        <tr>
          <td>${CodeUp.escapeHtml(l.profiles?.full_name||l.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(l.squads?.name||"")}</td>
          <td><button class="btn danger" data-remove="${l.id}">إزالة القيادة</button></td>
        </tr>`).join("") || `<tr><td colspan="3" class="emptyState">لا يوجد قادة بعد. يُعيَّن القائد تلقائيًا عند الموافقة على طلب قيادة.</td></tr>`}
      </tbody></table></div>`;
    body.querySelectorAll("[data-remove]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("تأكيد إزالة صلاحية القيادة؟")) return;
        await db.from("squad_leaders").delete().eq("id", b.dataset.remove);
        Admin.go("leaders");
      };
    });
  }
};
