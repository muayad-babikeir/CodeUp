// admin/js/community.js

Admin.sections.timeline = {
  label: "المستجدات",
  async render(body){
    const cid = Admin.currentCourseId;
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: posts, error } = await db.from("submissions")
      .select("*, assignments!inner(title,course_id), profiles(full_name)")
      .eq("assignments.course_id", cid).in("visibility",["course","squad"])
      .order("created_at",{ascending:false}).limit(50);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المستجدات.</span><button class="btn alertRetry" id="tlRetry">إعادة المحاولة</button></div>`; body.querySelector("#tlRetry").onclick=()=>Admin.go("timeline"); return; }

    body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr><th>الطالب</th><th>الواجب</th><th>المحتوى</th><th>الظهور</th><th></th></tr></thead>
      <tbody>${(posts||[]).map(p=>`
        <tr>
          <td>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</td>
          <td>${CodeUp.escapeHtml(p.assignments?.title||"")}</td>
          <td>${CodeUp.escapeHtml((p.content||"").slice(0,60))}</td>
          <td>${p.visibility==='course'?'الكورس كله':'مجموعته'}</td>
          <td><button class="btn danger" data-hide="${p.id}">إخفاء من المستجدات</button></td>
        </tr>`).join("") || `<tr><td colspan="5"><div class="emptyStatePro"><h4>لا توجد منشورات ظاهرة</h4><p>ستظهر هنا التسليمات المشاركة مع الكورس أو المجموعة.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelectorAll("[data-hide]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("سيتم إخفاء هذا المنشور من المستجدات (لن يُحذف التسليم نفسه). متابعة؟")) return;
        const { error } = await db.from("submissions").update({ visibility: "private" }).eq("id", b.dataset.hide);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("timeline");
      };
    });
  }
};

Admin.sections.moderation = {
  label: "الإشراف",
  async render(body){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: comments, error } = await db.from("comments").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(50);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل التعليقات.</span><button class="btn alertRetry" id="modRetry">إعادة المحاولة</button></div>`; body.querySelector("#modRetry").onclick=()=>Admin.go("moderation"); return; }
    body.innerHTML = `<div class="card"><b>أحدث التعليقات على المنصة</b>
      <div class="tableScroll"><table><thead><tr><th>الكاتب</th><th>التعليق</th><th>الوقت</th><th></th></tr></thead>
      <tbody>${(comments||[]).map(c=>`
        <tr>
          <td>${CodeUp.escapeHtml(c.profiles?.full_name||"")}</td>
          <td>${CodeUp.escapeHtml(c.content)}</td>
          <td class="small">${CodeUp.timeAgo(c.created_at)}</td>
          <td><button class="btn danger" data-del="${c.id}">حذف</button></td>
        </tr>`).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><p style="margin:0">لا توجد تعليقات بعد.</p></div></td></tr>`}
      </tbody></table></div></div>`;
    body.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("تأكيد حذف هذا التعليق؟")) return;
        const { error } = await db.from("comments").delete().eq("id", b.dataset.del);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("moderation");
      };
    });
  }
};

Admin.sections.home_announcements = {
  label: "إعلانات الصفحة الرئيسية (عامة لكل المنصة)",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: anns, error } = await db.from("announcements").select("*").is("course_id", null).order("created_at",{ascending:false});
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الإعلانات.</span><button class="btn alertRetry" id="haRetry">إعادة المحاولة</button></div>`; body.querySelector("#haRetry").onclick=()=>Admin.go("home_announcements"); return; }
    body.innerHTML = `
      <p class="small" style="margin-bottom:10px">هذي الإعلانات تظهر لكل مستخدمي CodeUp بالصفحة الرئيسية، بغض النظر عن تسجيلهم بأي كورس.</p>
      <div class="toolbar"><button class="btn dark" id="newHomeAnnBtn">+ إعلان عام جديد</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>العنوان</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${(anns||[]).map(a=>`
        <tr><td>${CodeUp.escapeHtml(a.title)}</td><td class="small">${CodeUp.timeAgo(a.created_at)}</td>
          <td><button class="btn" data-view="${a.id}">عرض</button> <button class="btn danger" data-delann="${a.id}">حذف</button></td></tr>
      `).join("") || `<tr><td colspan="3"><div class="emptyStatePro"><h4>لا توجد إعلانات عامة بعد</h4><p>انشر أول إعلان يظهر لكل مستخدمي المنصة.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelectorAll("[data-view]").forEach(b=>{
      b.onclick = ()=>{
        const a = (anns||[]).find(x=>x.id===b.dataset.view);
        Admin.modal(`<h3>${CodeUp.escapeHtml(a.title)}</h3><p class="small">${CodeUp.timeAgo(a.created_at)}</p>
          <div style="margin-top:10px;white-space:pre-wrap">${CodeUp.escapeHtml(a.content||"بدون محتوى إضافي")}</div>`);
      };
    });
    body.querySelectorAll("[data-delann]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("حذف هذا الإعلان نهائيًا من الصفحة الرئيسية لكل المستخدمين؟")) return;
        try{ await db.from("announcements").delete().eq("id", b.dataset.delann).throwOnError(); CodeUp.toast("تم الحذف","success"); Admin.go("home_announcements"); }
        catch(e){ CodeUp.toast(e.message,"error"); }
      };
    });

    body.querySelector("#newHomeAnnBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>إعلان عام جديد</h3>
        <label>العنوان</label><input id="haTitle">
        <label>المحتوى</label><textarea id="haContent" rows="4"></textarea>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="haCancel">إلغاء</button><button class="btn dark" id="haSave">نشر للجميع</button>
        </div>`);
      m.el.querySelector("#haCancel").onclick = m.close;
      m.el.querySelector("#haSave").onclick = async ()=>{
        const title = m.el.querySelector("#haTitle").value.trim();
        if(!title) return;
        const saveBtn = m.el.querySelector("#haSave");
        saveBtn.disabled = true;
        try{
          await CodeUp.rpc.createAnnouncement(null, title, m.el.querySelector("#haContent").value.trim(), null);
          CodeUp.toast("تم النشر لكل المستخدمين", "success"); m.close(); Admin.go("home_announcements");
        }catch(e){ CodeUp.toast(e.message || "تعذّر النشر", "error"); saveBtn.disabled = false; }
      };
    };
  }
};

Admin.sections.home_posts = {
  label: "منشورات المستجدات (إشراف عام)",
  async render(body){
    body.innerHTML = `<div class="card">${Array(4).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const { data: posts, error } = await db.from("posts").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(100);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المنشورات.</span><button class="btn alertRetry" id="hpRetry">إعادة المحاولة</button></div>`; body.querySelector("#hpRetry").onclick=()=>Admin.go("home_posts"); return; }

    body.innerHTML = `
      <p class="small" style="margin-bottom:10px">كل المنشورات الحرة اللي ينشرها الطلاب بالصفحة الرئيسية (تايم لاين المنصة) — تقدر تحذف أي منشور غير مناسب.</p>
      <div class="toolbar">
        <div class="searchBox">
          <span class="searchIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <input id="postSearch" placeholder="بحث بالكاتب أو المحتوى…">
        </div>
      </div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>الكاتب</th><th>المحتوى</th><th>التاريخ</th><th></th></tr></thead>
      <tbody id="postsBody"></tbody></table></div></div>`;

    const tbody = body.querySelector("#postsBody");
    const draw = (list)=>{
      tbody.innerHTML = list.map(p=>`
        <tr>
          <td>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${CodeUp.escapeHtml(p.content||"")}</td>
          <td class="small">${CodeUp.timeAgo(p.created_at)}</td>
          <td><button class="btn danger" data-delpost="${p.id}">حذف</button></td>
        </tr>
      `).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><h4>لا توجد منشورات مطابقة</h4><p>جرّب تعديل كلمة البحث.</p></div></td></tr>`;
      tbody.querySelectorAll("[data-delpost]").forEach(b=>{
        b.onclick = async ()=>{
          if(!confirm("حذف هذا المنشور نهائيًا؟\n\nلا يمكن التراجع عن هذا الإجراء.")) return;
          try{ await db.from("posts").delete().eq("id", b.dataset.delpost).throwOnError(); CodeUp.toast("تم الحذف","success"); Admin.go("home_posts"); }
          catch(e){ CodeUp.toast(e.message,"error"); }
        };
      });
    };
    draw(posts||[]);
    body.querySelector("#postSearch").oninput = CodeUp.debounce(e=>{
      const q = e.target.value.trim().toLowerCase();
      draw(!q ? (posts||[]) : (posts||[]).filter(p=>(p.profiles?.full_name||"").toLowerCase().includes(q) || (p.content||"").toLowerCase().includes(q)));
    }, 200);
  }
};

Admin.sections.announcements = {
  label: "الإعلانات",
  async render(body){
    const cid = Admin.currentCourseId;
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;
    const [{ data: anns, error }, { data: squads }] = await Promise.all([
      db.from("announcements").select("*, squads(name)").eq("course_id", cid).order("created_at",{ascending:false}),
      db.from("squads").select("id,name").eq("course_id", cid).eq("status","active")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الإعلانات.</span><button class="btn alertRetry" id="anRetry">إعادة المحاولة</button></div>`; body.querySelector("#anRetry").onclick=()=>Admin.go("announcements"); return; }
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newAnnBtn">+ إعلان جديد</button></div>
      <div class="card"><div class="tableScroll"><table><thead><tr><th>العنوان</th><th>الجهة المستهدفة</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${(anns||[]).map(a=>`
        <tr>
          <td>${CodeUp.escapeHtml(a.title)}</td>
          <td>${a.target_squad_id ? `مجموعة: ${CodeUp.escapeHtml(a.squads?.name||"")}` : "عام (كل الكورس)"}</td>
          <td class="small">${CodeUp.timeAgo(a.created_at)}</td>
          <td><button class="btn" data-view="${a.id}">عرض</button></td>
        </tr>
      `).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><h4>لا توجد إعلانات بعد</h4><p>انشر أول إعلان لطلاب هذا الكورس.</p></div></td></tr>`}
      </tbody></table></div></div>`;

    body.querySelectorAll("[data-view]").forEach(b=>{
      b.onclick = ()=>{
        const a = (anns||[]).find(x=>x.id===b.dataset.view);
        Admin.modal(`
          <h3>${CodeUp.escapeHtml(a.title)}</h3>
          <p class="small">${a.target_squad_id ? `موجّه لمجموعة: ${CodeUp.escapeHtml(a.squads?.name||"")}` : "إعلان عام لكل الكورس"} · ${CodeUp.timeAgo(a.created_at)}</p>
          <div style="margin-top:10px;white-space:pre-wrap">${CodeUp.escapeHtml(a.content||"بدون محتوى إضافي")}</div>
        `);
      };
    });

    body.querySelector("#newAnnBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>إعلان جديد</h3>
        <label>العنوان</label><input id="anTitle">
        <label>المحتوى</label><textarea id="anContent" rows="4"></textarea>
        <label>الجهة المستهدفة</label>
        <select id="anTarget">
          <option value="">عام — يشوفه كل طلاب الكورس</option>
          ${(squads||[]).map(s=>`<option value="${s.id}">مجموعة: ${CodeUp.escapeHtml(s.name)} فقط</option>`).join("")}
        </select>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="anCancel">إلغاء</button><button class="btn dark" id="anSave">نشر</button>
        </div>`);
      m.el.querySelector("#anCancel").onclick = m.close;
      m.el.querySelector("#anSave").onclick = async ()=>{
        const title = m.el.querySelector("#anTitle").value.trim();
        if(!title) return;
        const saveBtn = m.el.querySelector("#anSave");
        saveBtn.disabled = true;
        try{
          const targetSquadId = m.el.querySelector("#anTarget").value || null;
          await CodeUp.rpc.createAnnouncement(cid, title, m.el.querySelector("#anContent").value.trim(), targetSquadId);
          CodeUp.toast("تم النشر", "success"); m.close(); Admin.go("announcements");
        }catch(e){
          CodeUp.toast(e.message || "تعذّر نشر الإعلان", "error"); saveBtn.disabled = false;
        }
      };
    };
  }
};

Admin.sections.message_settings = {
  label: "مدة الاحتفاظ بالرسائل الخاصة",
  async render(body){
    const { data: setting } = await db.from("app_settings").select("*").eq("key","message_retention_days").single();
    const current = parseInt(setting?.value || "5");
    const OPTIONS = [1,3,5,7,14,30];
    body.innerHTML = `
      <div class="card">
        <b>مدة الاحتفاظ بالرسائل الخاصة قبل الحذف التلقائي</b>
        <p class="small" style="margin-top:6px">أي رسالة أقدم من المدة المحددة تُحذف تلقائيًا يوميًا (مهمة مجدولة، بدون أي تدخل من المستخدمين).</p>
        <select id="retentionSelect" style="margin-top:10px">
          ${OPTIONS.map(d=>`<option value="${d}" ${d===current?"selected":""}>${d} ${d===1?"يوم":"أيام"}</option>`).join("")}
        </select>
        <button class="btn dark" id="retentionSaveBtn" style="margin-top:10px">حفظ</button>
      </div>`;
    body.querySelector("#retentionSaveBtn").onclick = async ()=>{
      const val = body.querySelector("#retentionSelect").value;
      try{
        await db.from("app_settings").upsert({key:"message_retention_days", value:val, updated_by:Admin.ctx.user.id, updated_at:new Date().toISOString()}, {onConflict:"key"}).throwOnError();
        CodeUp.toast("تم الحفظ — يُطبَّق تلقائيًا من الآن", "success");
      }catch(e){ CodeUp.toast(e.message,"error"); }
    };
  }
};
