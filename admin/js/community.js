// admin/js/community.js

Admin.sections.timeline = {
  label: "المستجدات",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data: posts } = await db.from("submissions")
      .select("*, assignments!inner(title,course_id), profiles(full_name)")
      .eq("assignments.course_id", cid).in("visibility",["course","squad"])
      .order("created_at",{ascending:false}).limit(50);

    body.innerHTML = `<div class="card"><table><thead><tr><th>الطالب</th><th>الواجب</th><th>المحتوى</th><th>الظهور</th><th></th></tr></thead>
      <tbody>${(posts||[]).map(p=>`
        <tr>
          <td>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</td>
          <td>${CodeUp.escapeHtml(p.assignments?.title||"")}</td>
          <td>${CodeUp.escapeHtml((p.content||"").slice(0,60))}</td>
          <td>${p.visibility==='course'?'الكورس كله':'مجموعته'}</td>
          <td><button class="btn danger" data-hide="${p.id}">إخفاء من المستجدات</button></td>
        </tr>`).join("") || `<tr><td colspan="5" class="emptyState">لا توجد منشورات ظاهرة في المستجدات.</td></tr>`}
      </tbody></table></div>`;

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
    const { data: comments } = await db.from("comments").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(50);
    body.innerHTML = `<div class="card"><b>أحدث التعليقات على المنصة</b>
      <table><thead><tr><th>الكاتب</th><th>التعليق</th><th>الوقت</th><th></th></tr></thead>
      <tbody>${(comments||[]).map(c=>`
        <tr>
          <td>${CodeUp.escapeHtml(c.profiles?.full_name||"")}</td>
          <td>${CodeUp.escapeHtml(c.content)}</td>
          <td>${CodeUp.timeAgo(c.created_at)}</td>
          <td><button class="btn danger" data-del="${c.id}">حذف</button></td>
        </tr>`).join("") || `<tr><td colspan="4" class="emptyState">لا توجد تعليقات بعد.</td></tr>`}
      </tbody></table></div>`;
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
    const { data: anns } = await db.from("announcements").select("*").is("course_id", null).order("created_at",{ascending:false});
    body.innerHTML = `
      <p class="small" style="margin-bottom:10px">هذي الإعلانات تظهر لكل مستخدمي CodeUp بالصفحة الرئيسية، بغض النظر عن تسجيلهم بأي كورس.</p>
      <div class="toolbar"><button class="btn dark" id="newHomeAnnBtn">+ إعلان عام جديد</button></div>
      <div class="card"><table><thead><tr><th>العنوان</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${(anns||[]).map(a=>`
        <tr><td>${CodeUp.escapeHtml(a.title)}</td><td>${CodeUp.timeAgo(a.created_at)}</td>
          <td><button class="btn" data-view="${a.id}">عرض</button> <button class="btn danger" data-delann="${a.id}">حذف</button></td></tr>
      `).join("") || `<tr><td colspan="3" class="emptyState">لا توجد إعلانات عامة بعد.</td></tr>`}
      </tbody></table></div>`;

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
    const { data: posts } = await db.from("posts").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(100);
    body.innerHTML = `
      <p class="small" style="margin-bottom:10px">كل المنشورات الحرة اللي ينشرها الطلاب بالصفحة الرئيسية (تايم لاين المنصة) — تقدر تحذف أي منشور غير مناسب.</p>
      <div class="card"><table><thead><tr><th>الكاتب</th><th>المحتوى</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${(posts||[]).map(p=>`
        <tr>
          <td>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${CodeUp.escapeHtml(p.content||"")}</td>
          <td>${CodeUp.timeAgo(p.created_at)}</td>
          <td><button class="btn danger" data-delpost="${p.id}">حذف</button></td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="emptyState">لا توجد منشورات بعد.</td></tr>`}
      </tbody></table></div>`;

    body.querySelectorAll("[data-delpost]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("حذف هذا المنشور نهائيًا؟")) return;
        try{ await db.from("posts").delete().eq("id", b.dataset.delpost).throwOnError(); CodeUp.toast("تم الحذف","success"); Admin.go("home_posts"); }
        catch(e){ CodeUp.toast(e.message,"error"); }
      };
    });
  }
};

Admin.sections.announcements = {
  label: "الإعلانات",
  async render(body){
    const cid = Admin.currentCourseId;
    const { data: anns } = await db.from("announcements").select("*, squads(name)").eq("course_id", cid).order("created_at",{ascending:false});
    const { data: squads } = await db.from("squads").select("id,name").eq("course_id", cid).eq("status","active");
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newAnnBtn">+ إعلان جديد</button></div>
      <div class="card"><table><thead><tr><th>العنوان</th><th>الجهة المستهدفة</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${(anns||[]).map(a=>`
        <tr>
          <td>${CodeUp.escapeHtml(a.title)}</td>
          <td>${a.target_squad_id ? `مجموعة: ${CodeUp.escapeHtml(a.squads?.name||"")}` : "عام (كل الكورس)"}</td>
          <td>${CodeUp.timeAgo(a.created_at)}</td>
          <td><button class="btn" data-view="${a.id}">عرض</button></td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="emptyState">لا توجد إعلانات بعد.</td></tr>`}
      </tbody></table></div>`;

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
