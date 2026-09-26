// admin/js/people.js

Admin.sections.users = {
  label: "المستخدمون",
  async render(body){
    body.innerHTML = `<div class="card">${Array(5).fill(`<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><div class="skeleton skeleton-avatar"></div><div style="flex:1"><div class="skeleton skeleton-line w60"></div></div></div>`).join("")}</div>`;
    const { data: profiles, error } = await db.from("profiles").select("*").order("created_at",{ascending:false}).limit(200);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المستخدمين.</span><button class="btn alertRetry" id="usersRetry">إعادة المحاولة</button></div>`; body.querySelector("#usersRetry").onclick=()=>Admin.go("users"); return; }

    // حالة Google Wallet لكل مستخدم — استعلام واحد مجمّع بدل استعلام لكل صف
    const { data: walletPasses } = await db.from("membership_wallet_passes").select("user_id, status");
    const walletByUser = {};
    (walletPasses||[]).forEach(w=>{ walletByUser[w.user_id] = w.status; });
    const walletLabel = { not_created:"—", syncing:"قيد الإنشاء", active:"نشطة", sync_failed:"فشلت المزامنة" };
    const walletPillClass = { syncing:"pending", active:"approved", sync_failed:"rejected", not_created:"neutral" };

    const state = { q:"", roleFilter:"", sortKey:"created_at", sortDir:"desc", page:1, pageSize:20 };
    const PAGE_SIZE = state.pageSize;

    body.innerHTML = `
      <div class="toolbar" style="gap:10px;flex-wrap:wrap">
        <div class="searchBox">
          <span class="searchIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <input id="userSearch" placeholder="بحث بالاسم أو البريد…">
        </div>
        <select id="roleFilter">
          <option value="">كل المستخدمين</option>
          <option value="super">سوبر أدمن فقط</option>
          <option value="normal">بدون صلاحية سوبر أدمن</option>
        </select>
      </div>
      <div class="card">
        <div class="tableScroll"><table>
          <thead><tr>
            <th class="sortable" data-sort="full_name">الاسم <span class="sortArrow">▾</span></th>
            <th>البريد</th>
            <th>سوبر أدمن</th>
            <th>Google Wallet</th>
            <th class="sortable sorted" data-sort="created_at">تاريخ الانضمام <span class="sortArrow">▾</span></th>
            <th></th>
          </tr></thead>
          <tbody id="usersBody"></tbody>
        </table></div>
        <div class="pagination" id="usersPagination"></div>
      </div>`;

    const tbody = body.querySelector("#usersBody");
    const pager = body.querySelector("#usersPagination");

    function getFiltered(){
      let list = profiles||[];
      if(state.q){
        list = list.filter(p=>(p.full_name||"").toLowerCase().includes(state.q)||(p.email||"").toLowerCase().includes(state.q));
      }
      if(state.roleFilter==="super") list = list.filter(p=>p.is_super_admin);
      if(state.roleFilter==="normal") list = list.filter(p=>!p.is_super_admin);
      list = [...list].sort((a,b)=>{
        let va = a[state.sortKey], vb = b[state.sortKey];
        if(state.sortKey==="created_at"){ va = new Date(va||0).getTime(); vb = new Date(vb||0).getTime(); }
        else { va = (va||"").toString().toLowerCase(); vb = (vb||"").toString().toLowerCase(); }
        if(va < vb) return state.sortDir==="asc" ? -1 : 1;
        if(va > vb) return state.sortDir==="asc" ? 1 : -1;
        return 0;
      });
      return list;
    }

    function draw(){
      const filtered = getFiltered();
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if(state.page > totalPages) state.page = totalPages;
      const pageItems = filtered.slice((state.page-1)*PAGE_SIZE, state.page*PAGE_SIZE);

      tbody.innerHTML = pageItems.map(p=>`
        <tr data-row="${p.id}" style="cursor:pointer">
          <td><div class="metaWithAvatar">${CodeUp.avatarHtml(p.full_name, null, 30)}<span>${CodeUp.escapeHtml(p.full_name||"—")}</span></div></td>
          <td>${CodeUp.escapeHtml(p.email||"")}</td>
          <td>${p.is_super_admin?'<span class="pill approved">نعم</span>':'<span class="pill neutral">لا</span>'}</td>
          <td>
            <span class="pill ${walletPillClass[walletByUser[p.id]||"not_created"]}">${walletLabel[walletByUser[p.id]||"not_created"]}</span>
            ${walletByUser[p.id] ? `<button class="btn" style="margin-inline-start:6px;padding:4px 10px;font-size:12px" data-walletsync="${p.id}">مزامنة</button>` : ""}
          </td>
          <td class="small">${CodeUp.formatDate(p.created_at)}</td>
          <td>${p.id===Admin.ctx.user.id?'':`<button class="btn" data-toggle="${p.id}" data-val="${!p.is_super_admin}">${p.is_super_admin?'إزالة الصلاحية':'ترقية لسوبر أدمن'}</button>`}</td>
        </tr>`).join("") || `<tr><td colspan="6"><div class="emptyStatePro"><h4>لا يوجد مستخدمون مطابقون</h4><p>جرّب تعديل البحث أو الفلتر.</p></div></td></tr>`;

      pager.innerHTML = filtered.length ? `
        <button id="pgPrev" ${state.page<=1?"disabled":""}>‹</button>
        <span class="pageInfo">صفحة ${state.page} من ${totalPages} (${filtered.length})</span>
        <button id="pgNext" ${state.page>=totalPages?"disabled":""}>›</button>` : "";

      tbody.querySelectorAll("[data-toggle]").forEach(b=>{
        b.onclick = async (ev)=>{
          ev.stopPropagation();
          if(!confirm("تأكيد تغيير صلاحية هذا المستخدم؟")) return;
          const { error } = await db.from("profiles").update({ is_super_admin: b.dataset.val==="true" }).eq("id", b.dataset.toggle);
          if(error) CodeUp.toast(error.message, "error"); else Admin.go("users");
        };
      });
      tbody.querySelectorAll("[data-row]").forEach(tr=>{
        tr.onclick = ()=> openStudentDrawer(profiles.find(p=>p.id===tr.dataset.row));
      });
      tbody.querySelectorAll("[data-walletsync]").forEach(b=>{
        b.onclick = async (ev)=>{
          ev.stopPropagation();
          const targetId = b.dataset.walletsync;
          b.disabled = true; b.textContent = "جارِ المزامنة...";
          try{
            const {data:{session}} = await db.auth.getSession();
            const res = await fetch(`${SUPABASE_URL}/functions/v1/google-wallet`, {
              method:"POST",
              headers:{"Authorization":`Bearer ${session.access_token}`, "Content-Type":"application/json"},
              body: JSON.stringify({action:"sync", target_user_id: targetId})
            });
            const out = await res.json();
            if(!res.ok || out.error) throw new Error(out.error || "فشلت المزامنة");
            CodeUp.toast("تمت مزامنة البطاقة", "success");
            Admin.go("users");
          }catch(e){
            CodeUp.toast(e.message||"فشلت المزامنة", "error");
            b.disabled = false; b.textContent = "مزامنة";
          }
        };
      });
      const prevBtn = pager.querySelector("#pgPrev"); if(prevBtn) prevBtn.onclick = ()=>{ state.page--; draw(); };
      const nextBtn = pager.querySelector("#pgNext"); if(nextBtn) nextBtn.onclick = ()=>{ state.page++; draw(); };
    }

    body.querySelector("#userSearch").oninput = CodeUp.debounce(e=>{ state.q = e.target.value.trim().toLowerCase(); state.page = 1; draw(); }, 200);
    body.querySelector("#roleFilter").onchange = (e)=>{ state.roleFilter = e.target.value; state.page = 1; draw(); };
    body.querySelectorAll("th.sortable").forEach(th=>{
      th.onclick = ()=>{
        const key = th.dataset.sort;
        if(state.sortKey === key) state.sortDir = state.sortDir==="asc" ? "desc" : "asc";
        else { state.sortKey = key; state.sortDir = "asc"; }
        body.querySelectorAll("th.sortable").forEach(t=>t.classList.remove("sorted"));
        th.classList.add("sorted");
        draw();
      };
    });

    draw();
  }
};

// لوحة تفاصيل الطالب — بيانات حقيقية فقط: تسجيلاته الفعلية عبر الكورسات (تقدّم/XP/Streak/المجموعة)
// لا تُعرض أي معلومات حساسة غير ضرورية (لا كلمات مرور، لا بيانات دفع أو ما شابه — غير موجودة أصلًا هنا)
async function openStudentDrawer(p){
  if(!p) return;
  const d = Admin.drawer(`<div class="emptyState">جارِ التحميل…</div>`);
  const { data: enrollments } = await db.from("enrollments").select("*, courses(name,slug), squads(name)").eq("profile_id", p.id);

  d.el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div class="metaWithAvatar">${CodeUp.avatarHtml(p.full_name, null, 44)}
        <div class="metaTextCol"><b style="font-size:15px">${CodeUp.escapeHtml(p.full_name||"—")}</b><span class="small">${CodeUp.escapeHtml(p.email||"")}</span></div>
      </div>
      <button class="iconBtn" id="drawerClose" aria-label="إغلاق">${Icon("x")}</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      ${p.is_super_admin?'<span class="pill approved">سوبر أدمن</span>':""}
      <span class="pill neutral">انضم ${CodeUp.formatDate(p.created_at)}</span>
    </div>
    <b style="font-size:13.5px">التسجيلات في الكورسات</b>
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:12px">
      ${(enrollments||[]).map(e=>`
        <div class="card2" style="padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <b style="font-size:13px">${CodeUp.escapeHtml(e.courses?.name||"—")}</b>
            <span class="pill ${e.status==='on_track'?'approved':e.status==='behind'?'rejected':'pending'}">${enrollmentStatusLabel(e.status)}</span>
          </div>
          <div class="progressTrack" style="margin-bottom:6px"><div class="progressFill" style="width:${e.progress??0}%"></div></div>
          <div class="small">${e.progress??0}% تقدّم · ${e.xp??0} XP · ${e.streak??0} يوم متتالي${e.squads?.name?` · مجموعة: ${CodeUp.escapeHtml(e.squads.name)}`:""}</div>
        </div>`).join("") || `<div class="emptyStatePro"><p style="margin:0">غير مسجّل بأي كورس بعد.</p></div>`}
    </div>
  `;
  d.el.querySelector("#drawerClose").onclick = d.close;
}

Admin.sections.squads = {
  label: "المجموعات",
  async render(body){
    const cid = Admin.currentCourseId;
    if(!cid){ body.innerHTML = `<div class="emptyStatePro"><h4>لا يوجد كورس محدد</h4><p>اختر كورسًا من القائمة الجانبية أولًا.</p></div>`; return; }
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:38px;margin-bottom:10px"></div>`).join("")}</div>`;

    const [{ data: squads, error }, { data: counts }, { data: joinReqs }] = await Promise.all([
      db.from("squads").select("*, squad_leaders(profile_id, profiles(full_name))").eq("course_id", cid).order("created_at"),
      db.from("enrollments").select("squad_id").eq("course_id", cid),
      db.from("squad_join_requests").select("squad_id, squads!inner(course_id)").eq("squads.course_id", cid).eq("status","pending")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المجموعات.</span><button class="btn alertRetry" id="sqRetry">إعادة المحاولة</button></div>`; body.querySelector("#sqRetry").onclick=()=>Admin.go("squads"); return; }

    const memberCount = {};
    (counts||[]).forEach(e=>{ if(e.squad_id) memberCount[e.squad_id] = (memberCount[e.squad_id]||0)+1; });
    const pendingCount = {};
    (joinReqs||[]).forEach(r=>{ if(r.squad_id) pendingCount[r.squad_id] = (pendingCount[r.squad_id]||0)+1; });
    const isSuper = Admin.role === "super"; // تعيين القائد: سوبر أدمن فقط (محمي أيضًا بـRPC/RLS، مو بس إخفاء الزر)

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newSquadBtn">+ مجموعة جديدة</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>المجموعة</th><th>القادة</th><th>الأعضاء</th><th>السعة</th><th>طلبات انضمام</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${(squads||[]).map(sq=>`
        <tr>
          <td>${CodeUp.escapeHtml(sq.name)}</td>
          <td>${(sq.squad_leaders||[]).map(l=>CodeUp.escapeHtml(l.profiles?.full_name||"")).join("، ")||"—"}</td>
          <td>${memberCount[sq.id]||0}${sq.capacity?` / ${sq.capacity}`:""}</td>
          <td>${sq.capacity??"—"}</td>
          <td>${pendingCount[sq.id]?`<span class="pill pending" style="cursor:pointer" data-viewreqs="1">${pendingCount[sq.id]}</span>`:'<span class="pill neutral">0</span>'}</td>
          <td><span class="pill ${sq.status==='active'?'approved':'rejected'}">${sq.status==='active'?'نشطة':'مؤرشفة'}</span></td>
          <td>
            <button class="btn" data-edit="${sq.id}">تعديل</button>
            ${isSuper?`<button class="btn" data-assignleader="${sq.id}">تعيين قائد</button>`:""}
          </td>
        </tr>`).join("") || `<tr><td colspan="7"><div class="emptyStatePro"><h4>لا توجد مجموعات بعد</h4><p>أنشئ أول مجموعة لتنظيم طلاب هذا الكورس.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelector("#newSquadBtn").onclick = ()=> openSquadModal(cid);
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openSquadModal(cid, squads.find(s=>s.id===b.dataset.edit));
    });
    body.querySelectorAll("[data-assignleader]").forEach(b=>{
      b.onclick = ()=> openAssignLeaderModal(squads.find(s=>s.id===b.dataset.assignleader));
    });
    body.querySelectorAll("[data-viewreqs]").forEach(b=>{
      b.onclick = ()=> Admin.go("join_requests");
    });
  }
};

async function openAssignLeaderModal(squad){
  const { data: members } = await db.from("enrollments").select("profile_id, profiles(full_name,email)").eq("squad_id", squad.id);
  if(!members || !members.length){ CodeUp.toast("لا يوجد أعضاء بهذه المجموعة بعد", "error"); return; }
  const m = Admin.modal(`
    <h3>تعيين قائد — ${CodeUp.escapeHtml(squad.name)}</h3>
    <p class="small">اختيار قائد جديد يُنزل القائد الحالي (إن وُجد) لعضو عادي تلقائيًا.</p>
    <label>العضو</label>
    <select id="newLeaderSelect">${members.map(mm=>`<option value="${mm.profile_id}">${CodeUp.escapeHtml(mm.profiles?.full_name||mm.profiles?.email||"")}</option>`).join("")}</select>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="alCancel">إلغاء</button><button class="btn dark" id="alSave">تعيين</button>
    </div><div id="alMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#alCancel").onclick = m.close;
  m.el.querySelector("#alSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#alMsg");
    const newLeaderId = m.el.querySelector("#newLeaderSelect").value;
    try{
      await db.rpc("assign_squad_leader", {p_squad_id: squad.id, p_new_leader_id: newLeaderId}).throwOnError();
      CodeUp.toast("تم تعيين القائد الجديد", "success");
      m.close(); Admin.go("squads");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

function openSquadModal(courseId, squad){
  const isEdit = !!squad;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل المجموعة":"مجموعة جديدة"}</h3>
    <label>الاسم</label><input id="sqName" value="${squad?CodeUp.escapeHtml(squad.name):""}">
    <label>الوصف</label><textarea id="sqDesc" rows="2">${squad?CodeUp.escapeHtml(squad.description||""):""}</textarea>
    <label>السعة (اختياري)</label><input id="sqCap" type="number" min="1" value="${squad?.capacity??""}">
    <label>الحالة</label>
    <select id="sqStatus"><option value="active" ${!squad||squad.status==='active'?'selected':''}>نشطة</option><option value="archived" ${squad?.status==='archived'?'selected':''}>مؤرشفة</option></select>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="sqCancel">إلغاء</button><button class="btn dark" id="sqSave">حفظ</button>
    </div><div id="sqMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#sqCancel").onclick = m.close;
  m.el.querySelector("#sqSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#sqMsg");
    const payload = {
      name: m.el.querySelector("#sqName").value.trim(),
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
  label: "القادة",
  async render(body){
    const cid = Admin.currentCourseId;
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:38px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: leaders, error } = await db.from("squad_leaders").select("*, profiles(full_name,email), squads!inner(name,course_id)").eq("squads.course_id", cid);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل القادة.</span><button class="btn alertRetry" id="ldRetry">إعادة المحاولة</button></div>`; body.querySelector("#ldRetry").onclick=()=>Admin.go("leaders"); return; }
    const PERMS = [
      {key:"can_add_assignment", label:"إضافة واجب"},
      {key:"can_add_content", label:"إضافة محتوى (وحدات/دروس)"},
      {key:"can_post_announcement", label:"نشر إعلان"}
    ];
    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>القائد</th><th>المجموعة</th><th>الصلاحيات</th><th></th></tr></thead>
      <tbody>${(leaders||[]).map(l=>{
        const perms = l.permissions||{};
        return `
        <tr>
          <td>${CodeUp.escapeHtml(l.profiles?.full_name||l.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(l.squads?.name||"")}</td>
          <td>${PERMS.map(p=>`
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px">
              <input type="checkbox" data-perm="${l.id}" data-key="${p.key}" ${perms[p.key]?"checked":""}>
              ${p.label}
            </label>`).join("")}
          </td>
          <td><button class="btn danger" data-remove="${l.id}">إزالة القيادة</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><h4>لا يوجد قادة بعد</h4><p>يُعيَّن القائد تلقائيًا عند الموافقة على طلب قيادة، أو يدويًا من صفحة المجموعات.</p></div></td></tr>`}
      </tbody></table></div></div>`;
    body.querySelectorAll("[data-perm]").forEach(cb=>{
      cb.onchange = async ()=>{
        const leaderId = cb.dataset.perm;
        const leader = (leaders||[]).find(l=>l.id===leaderId);
        const newPerms = {...(leader?.permissions||{}), [cb.dataset.key]: cb.checked};
        const { error } = await db.from("squad_leaders").update({permissions:newPerms}).eq("id", leaderId);
        if(error){ CodeUp.toast(error.message, "error"); cb.checked = !cb.checked; return; }
        if(leader) leader.permissions = newPerms;
        CodeUp.toast("تم تحديث الصلاحية", "success");
      };
    });
    body.querySelectorAll("[data-remove]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("تأكيد إزالة صلاحية القيادة؟")) return;
        const { error } = await db.from("squad_leaders").delete().eq("id", b.dataset.remove);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("leaders");
      };
    });
  }
};
