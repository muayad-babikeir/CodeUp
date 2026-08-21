// admin/js/requests.js

Admin.sections.join_requests = {
  label: "طلبات الانضمام",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data } = await db.from("squad_join_requests")
      .select("*, profiles(full_name,email), squads!inner(name,course_id)")
      .eq("squads.course_id", cid).order("created_at",{ascending:false});
    renderRequestQueue(body, data||[], {
      title: (r)=> `${CodeUp.escapeHtml(r.profiles?.full_name||r.profiles?.email||"")} → ${CodeUp.escapeHtml(r.squads?.name||"")}`,
      subtitle: (r)=> r.message ? CodeUp.escapeHtml(r.message) : "بدون رسالة",
      onApprove: async (r)=> CodeUp.rpc.approveJoinRequest(r.id),
      onReject: async (r, reason)=> CodeUp.rpc.rejectJoinRequest(r.id, reason),
      afterAction: ()=> Admin.go("join_requests")
    });
  }
};

Admin.sections.leader_applications = {
  label: "طلبات القيادة",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data } = await db.from("leader_applications")
      .select("*, profiles(full_name,email)")
      .eq("course_id", cid).order("created_at",{ascending:false});
    const { data: squads } = await db.from("squads").select("id,name").eq("course_id", cid).eq("status","active");

    renderRequestQueue(body, data||[], {
      title: (r)=> `${CodeUp.escapeHtml(r.profiles?.full_name||r.profiles?.email||"")}`,
      subtitle: (r)=> `${r.message?CodeUp.escapeHtml(r.message):""}${r.experience?" — خبرة: "+CodeUp.escapeHtml(r.experience):""}`,
      onApprove: async (r)=>{
        const squadId = await pickSquadForApproval(squads||[]);
        if(!squadId) return "cancelled";
        return CodeUp.rpc.approveLeaderApplication(r.id, squadId);
      },
      onReject: async (r, reason)=> CodeUp.rpc.rejectLeaderApplication(r.id, reason),
      afterAction: ()=> Admin.go("leader_applications")
    });
  }
};

function pickSquadForApproval(squads){
  return new Promise(resolve=>{
    if(!squads.length){ CodeUp.toast("لا توجد مجموعات نشطة لتعيين القائد عليها", "error"); resolve(null); return; }
    const m = Admin.modal(`
      <h3>اختر المجموعة التي سيقودها</h3>
      <select id="pickSquad">${squads.map(s=>`<option value="${s.id}">${CodeUp.escapeHtml(s.name)}</option>`).join("")}</select>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="btn" id="pCancel">إلغاء</button><button class="btn dark" id="pOk">تأكيد</button>
      </div>`);
    m.el.querySelector("#pCancel").onclick = ()=>{ m.close(); resolve(null); };
    m.el.querySelector("#pOk").onclick = ()=>{ const v = m.el.querySelector("#pickSquad").value; m.close(); resolve(v); };
  });
}

// مكون عام لأي قائمة مراجعة (Pending / Approved / Rejected) مع أزرار قبول/رفض
function renderRequestQueue(body, items, opts){
  const pending = items.filter(i=>i.status==="pending");
  const others = items.filter(i=>i.status!=="pending");

  body.innerHTML = `
    <div class="card"><b>بانتظار المراجعة (${pending.length})</b>
      <table><thead><tr><th>الطلب</th><th>ملاحظة</th><th>التاريخ</th><th></th></tr></thead>
      <tbody id="pendingBody">${pending.map(r=>`
        <tr data-id="${r.id}">
          <td>${opts.title(r)}</td>
          <td>${opts.subtitle(r)}</td>
          <td>${CodeUp.timeAgo(r.created_at)}</td>
          <td>
            <button class="btn ok" data-approve="${r.id}">قبول</button>
            <button class="btn danger" data-reject="${r.id}">رفض</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="4" class="emptyState">لا توجد طلبات قيد المراجعة.</td></tr>`}
      </tbody></table></div>

    <div class="card"><b>السجل</b>
      <table><thead><tr><th>الطلب</th><th>الحالة</th><th>التاريخ</th></tr></thead>
      <tbody>${others.map(r=>`
        <tr><td>${opts.title(r)}</td><td><span class="pill ${r.status}">${statusAr(r.status)}</span></td><td>${CodeUp.timeAgo(r.reviewed_at||r.created_at)}</td></tr>
      `).join("") || `<tr><td colspan="3" class="emptyState">لا يوجد سجل بعد.</td></tr>`}
      </tbody></table></div>`;

  body.querySelectorAll("[data-approve]").forEach(b=>{
    b.onclick = async ()=>{
      b.disabled = true;
      const item = items.find(i=>i.id===b.dataset.approve);
      try{
        const r = await opts.onApprove(item);
        if(r === "cancelled"){ b.disabled=false; return; }
        CodeUp.toast("تمت الموافقة", "success");
        opts.afterAction();
      }catch(e){ CodeUp.toast(e.message, "error"); b.disabled = false; }
    };
  });
  body.querySelectorAll("[data-reject]").forEach(b=>{
    b.onclick = ()=>{
      const item = items.find(i=>i.id===b.dataset.reject);
      const m = Admin.modal(`
        <h3>سبب الرفض</h3>
        <textarea id="rejReason" rows="3" placeholder="اكتب سببًا واضحًا…"></textarea>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="rCancel">إلغاء</button><button class="btn danger" id="rOk">تأكيد الرفض</button>
        </div><div id="rMsg" class="emptyState" style="display:none;padding:8px;color:#b42318"></div>`);
      m.el.querySelector("#rCancel").onclick = m.close;
      m.el.querySelector("#rOk").onclick = async ()=>{
        const reason = m.el.querySelector("#rejReason").value.trim();
        const msgEl = m.el.querySelector("#rMsg");
        if(!reason){ msgEl.style.display="block"; msgEl.textContent="سبب الرفض إلزامي"; return; }
        try{
          await opts.onReject(item, reason);
          CodeUp.toast("تم الرفض", "success"); m.close(); opts.afterAction();
        }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
      };
    };
  });
}

function statusAr(s){ return {pending:"قيد المراجعة",approved:"مقبول",rejected:"مرفوض",cancelled:"ملغى"}[s]||s; }
