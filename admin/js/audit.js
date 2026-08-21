// admin/js/audit.js

Admin.sections.files = {
  label: "الملفات",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data } = await db.from("file_uploads").select("*, profiles(full_name)").eq("course_id", cid).order("created_at",{ascending:false}).limit(80);
    body.innerHTML = `<div class="card"><table><thead><tr><th>الملف</th><th>رفعه</th><th>النوع</th><th>التاريخ</th></tr></thead>
      <tbody>${(data||[]).map(f=>`
        <tr><td>${CodeUp.escapeHtml(f.file_name||"—")}</td><td>${CodeUp.escapeHtml(f.profiles?.full_name||"")}</td><td>${CodeUp.escapeHtml(f.related_type||"")}</td><td>${CodeUp.timeAgo(f.created_at)}</td></tr>
      `).join("") || `<tr><td colspan="4" class="emptyState">لا توجد ملفات مرفوعة بعد.</td></tr>`}
      </tbody></table></div>`;
  }
};

Admin.sections.audit_log = {
  label: "سجل التدقيق",
  async render(body){
    let q = db.from("activity_log").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(150);
    if(Admin.role !== "super") q = q.eq("course_id", Admin.currentCourseId);
    const { data } = await q;
    body.innerHTML = `<div class="card"><table><thead><tr><th>المستخدم</th><th>الحدث</th><th>الوقت</th></tr></thead>
      <tbody>${(data||[]).map(a=>`
        <tr><td>${CodeUp.escapeHtml(a.profiles?.full_name||"—")}</td><td>${CodeUp.escapeHtml(a.action_text)}</td><td>${CodeUp.timeAgo(a.created_at)}</td></tr>
      `).join("") || `<tr><td colspan="3" class="emptyState">لا يوجد سجل بعد.</td></tr>`}
      </tbody></table></div>`;
  }
};

/* ============================================================
   LEADER PANEL — كل استعلام هنا مقيّد صراحة بـ Admin.currentSquadId
   ضمن Admin.ctx.leaderSquads (لا يعتمد على RLS فقط؛ دفاع مزدوج)
   ============================================================ */
async function renderLeaderSection(section, body){
  const mySquads = Admin.ctx.leaderSquads.map(s=>s.squad_id);
  if(!mySquads.length){ body.innerHTML = `<div class="emptyState">لا تقود أي مجموعة حاليًا.</div>`; return; }

  if(mySquads.length > 1 && !document.getElementById("squadSwitcherLeader")){
    const nav = document.getElementById("navRoot");
    const sw = document.createElement("select");
    sw.id = "squadSwitcherLeader";
    sw.style.cssText = "width:100%;margin:0 0 10px;padding:8px;border-radius:8px;border:1px solid #333;background:#1f2740;color:#fff";
    sw.innerHTML = Admin.ctx.leaderSquads.map(s=>`<option value="${s.squad_id}">${CodeUp.escapeHtml(s.squads?.name||"")}</option>`).join("");
    sw.onchange = ()=>{ Admin.currentSquadId = sw.value; Admin.go(Admin.section); };
    nav.prepend(sw);
  }
  const squadId = Admin.currentSquadId || mySquads[0];
  if(!mySquads.includes(squadId)){ body.innerHTML = `<div class="emptyState">لا تملك صلاحية على هذه المجموعة.</div>`; return; }

  const { data: squad } = await db.from("squads").select("*, courses(id,name)").eq("id", squadId).single();
  document.getElementById("pageTitle").textContent = squad?.name || "";

  if(section==="mysquad" || section==="members"){
    const { data: members } = await db.from("enrollments").select("*, profiles(full_name,email)").eq("squad_id", squadId);
    body.innerHTML = `<div class="card"><table><thead><tr><th>الطالب</th><th>الحالة</th><th>التقدم</th><th>XP</th></tr></thead>
      <tbody>${(members||[]).map(m=>`
        <tr><td>${CodeUp.escapeHtml(m.profiles?.full_name||m.profiles?.email||"")}</td><td><span class="pill ${m.status==='on_track'?'approved':m.status==='behind'?'rejected':'pending'}">${m.status}</span></td><td>${m.progress}%</td><td>${m.xp}</td></tr>
      `).join("") || `<tr><td colspan="4" class="emptyState">لا يوجد أعضاء في مجموعتك بعد.</td></tr>`}
      </tbody></table></div>`;
    return;
  }

  if(section==="ljoin"){
    const { data } = await db.from("squad_join_requests").select("*, profiles(full_name,email)").eq("squad_id", squadId).order("created_at",{ascending:false});
    renderRequestQueue(body, data||[], {
      title:(r)=>CodeUp.escapeHtml(r.profiles?.full_name||r.profiles?.email||""),
      subtitle:(r)=> r.message?CodeUp.escapeHtml(r.message):"بدون رسالة",
      onApprove: async (r)=> CodeUp.rpc.approveJoinRequest(r.id),
      onReject: async (r, reason)=> CodeUp.rpc.rejectJoinRequest(r.id, reason),
      afterAction: ()=> Admin.go("ljoin")
    });
    return;
  }

  if(section==="lassignments"){
    const { data } = await db.from("assignments").select("*").eq("course_id", squad.courses.id).order("deadline");
    body.innerHTML = `<div class="card"><table><thead><tr><th>العنوان</th><th>الموعد النهائي</th></tr></thead>
      <tbody>${(data||[]).map(a=>`<tr><td>${CodeUp.escapeHtml(a.title)}</td><td>${CodeUp.formatDate(a.deadline)}</td></tr>`).join("")||`<tr><td colspan="2" class="emptyState">لا توجد واجبات بعد.</td></tr>`}</tbody></table></div>`;
    return;
  }

  if(section==="lsubmissions"){
    const { data: members } = await db.from("enrollments").select("profile_id").eq("squad_id", squadId);
    const memberIds = (members||[]).map(m=>m.profile_id);
    if(!memberIds.length){ body.innerHTML = `<div class="emptyState">لا يوجد أعضاء بعد.</div>`; return; }
    const { data: subs } = await db.from("submissions").select("*, assignments(title), profiles(full_name)").in("profile_id", memberIds).order("submitted_at",{ascending:false}).limit(60);
    body.innerHTML = `<div class="card"><table><thead><tr><th>الطالب</th><th>الواجب</th><th>الحالة</th></tr></thead>
      <tbody>${(subs||[]).map(s=>`<tr><td>${CodeUp.escapeHtml(s.profiles?.full_name||"")}</td><td>${CodeUp.escapeHtml(s.assignments?.title||"")}</td><td><span class="pill">${subStatusAr(s.status)}</span></td></tr>`).join("")||`<tr><td colspan="3" class="emptyState">لا توجد تسليمات بعد.</td></tr>`}</tbody></table></div>`;
    return;
  }

  if(section==="ltimeline"){
    const { data } = await db.from("submissions").select("*, profiles(full_name)").eq("visibility","squad").order("created_at",{ascending:false}).limit(30);
    body.innerHTML = `<div class="card">${(data||[]).map(p=>`<div style="padding:8px 0;border-top:1px dashed #eee"><b>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</b> — ${CodeUp.escapeHtml(p.content||"")}</div>`).join("")||`<div class="emptyState">لا توجد منشورات بعد.</div>`}</div>`;
    return;
  }

  if(section==="lactivity"){
    const { data } = await db.from("activity_log").select("*, profiles(full_name)").eq("course_id", squad.courses.id).order("created_at",{ascending:false}).limit(40);
    body.innerHTML = `<div class="card"><table><thead><tr><th>المستخدم</th><th>الحدث</th><th>الوقت</th></tr></thead>
      <tbody>${(data||[]).map(a=>`<tr><td>${CodeUp.escapeHtml(a.profiles?.full_name||"—")}</td><td>${CodeUp.escapeHtml(a.action_text)}</td><td>${CodeUp.timeAgo(a.created_at)}</td></tr>`).join("")||`<tr><td colspan="3" class="emptyState">لا يوجد نشاط بعد.</td></tr>`}</tbody></table></div>`;
    return;
  }

  if(section==="lprogress"){
    const { data } = await db.from("enrollments").select("*, profiles(full_name)").eq("squad_id", squadId).order("xp",{ascending:false});
    body.innerHTML = `<div class="card"><table><thead><tr><th>الطالب</th><th>التقدم</th><th>XP</th><th>Streak</th></tr></thead>
      <tbody>${(data||[]).map(e=>`<tr><td>${CodeUp.escapeHtml(e.profiles?.full_name||"")}</td><td>${e.progress}%</td><td>${e.xp}</td><td>${e.streak}</td></tr>`).join("")||`<tr><td colspan="4" class="emptyState">لا يوجد أعضاء بعد.</td></tr>`}</tbody></table></div>`;
    return;
  }

  body.innerHTML = `<div class="emptyState">القسم غير متاح.</div>`;
}
