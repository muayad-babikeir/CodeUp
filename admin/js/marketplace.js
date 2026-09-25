// admin/js/marketplace.js — إدارة CodeUp Marketplace (نظام مستقل تمامًا عن الكورسات/الجامعة)

const MP_TYPE_LABEL = {sale:"للبيع", exchange:"للاستبدال", borrow:"للإعارة", free:"مجاني"};
const MP_STATUS_LABEL = {pending_review:"بانتظار المراجعة", active:"متاح", reserved:"محجوز", sold:"تم البيع",
  borrowed:"معار حاليًا", exchanged:"تم الاستبدال", given_away:"تم الإهداء", cancelled:"ملغى", rejected:"مرفوض"};
// نفس فئات pill (neutral/pending/approved/rejected/info) المستخدمة أصلًا بقسم الأرشفة (audit.js) — بدون Emoji
const MP_STATUS_PILL = {pending_review:"pending", active:"approved", reserved:"pending", sold:"info",
  borrowed:"info", exchanged:"info", given_away:"info", cancelled:"neutral", rejected:"rejected"};
function mpStatusBadge(l){
  const label = (l.listing_type==='sale' && l.status==='reserved') ? "تم الاتفاق" : (MP_STATUS_LABEL[l.status]||l.status);
  return `<span class="pill ${MP_STATUS_PILL[l.status]||'neutral'}">${label}</span>`;
}

// ---------------- Settings (مدة احتفاظ صور Marketplace بـSupabase Storage قبل الأرشفة الكاملة) ----------------
Admin.sections.marketplace_settings = {
  label: "إعدادات Marketplace",
  async render(body){
    body.innerHTML = `<div class="card">${Array(1).fill(`<div class="skeleton skeleton-line w60" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;

    const draw = async ()=>{
      const { data: setting, error } = await db.from("archive_settings").select("*").eq("scope_type","marketplace").is("scope_id",null).maybeSingle();
      if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الإعدادات.</span><button class="btn alertRetry" id="mpsRetry">إعادة المحاولة</button></div>`; body.querySelector("#mpsRetry").onclick=()=>Admin.go("marketplace_settings"); return; }

      body.innerHTML = `
        <div class="card">
          <b>مدة بقاء صور الإعلانات في Supabase Storage</b>
          <p class="small" style="margin:6px 0 10px">
            بعد رفع أي صورة لإعلان، تُرسل نسخة فورية لتيليجرام (موضوع STORE) كأرشيف دائم. النسخة الأصلية تبقى
            متاحة للمعاينة المباشرة داخل التطبيق (بدون فتح تيليجرام) لهذه المدة فقط، ثم تُحذف تلقائيًا من
            Storage لتوفير المساحة — بعدها تصير الصورة رابط تيليجرام خارجي بدل معاينة داخل التطبيق. نفس
            الآلية المستخدمة بالضبط لملفات الواجبات والرسائل.
          </p>
          <div class="row" style="gap:8px;align-items:center">
            <input id="mpsDays" type="number" min="1" value="${setting?.retention_days ?? 1}" style="width:100px">
            <span class="small">يوم</span>
          </div>
          <button class="btn dark" id="mpsSaveBtn" style="margin-top:10px">حفظ</button>
          <p class="small" style="margin-top:8px;color:var(--ink60)">القيمة الافتراضية الحالية: يوم واحد (24 ساعة).</p>
        </div>
      `;

      body.querySelector("#mpsSaveBtn").onclick = async ()=>{
        const days = Number(body.querySelector("#mpsDays").value);
        if(!(days >= 1)){ CodeUp.toast("أدخل رقم أيام صحيح (1 على الأقل)", "error"); return; }
        try{
          await db.from("archive_settings").upsert(
            {scope_type:"marketplace", scope_id:null, retention_days:days, created_by:Admin.ctx.user.id},
            {onConflict:"scope_type,scope_id"}
          ).throwOnError();
          CodeUp.toast("تم حفظ المدة", "success");
          draw();
        }catch(e){ CodeUp.toast(e.message || "تعذّر الحفظ", "error"); }
      };
    };
    draw();
  }
};

// ---------------- Dashboard ----------------
Admin.sections.marketplace_dashboard = {
  label: "لوحة Marketplace",
  async render(body){
    body.innerHTML = `<div class="statGrid">${Array(6).fill(`<div class="stat skeleton skeleton-line w60" style="height:60px"></div>`).join("")}</div>`;

    const countBy = async (filters)=>{
      let q = db.from("marketplace_listings").select("id",{count:"exact",head:true});
      Object.entries(filters).forEach(([k,v])=> q = q.eq(k,v));
      const { count } = await q;
      return count || 0;
    };
    const [total, active, pending, sold, borrowed, exchanged, givenAway, reported, categoriesCount, pendingReports] = await Promise.all([
      db.from("marketplace_listings").select("id",{count:"exact",head:true}).then(r=>r.count||0),
      countBy({status:"active"}),
      countBy({status:"pending_review"}),
      countBy({status:"sold"}),
      countBy({status:"borrowed"}),
      countBy({status:"exchanged"}),
      countBy({status:"given_away"}),
      countBy({status:"rejected"}),
      db.from("marketplace_categories").select("id",{count:"exact",head:true}).then(r=>r.count||0),
      db.from("marketplace_reports").select("id",{count:"exact",head:true}).eq("status","pending").then(r=>r.count||0)
    ]);

    body.innerHTML = `
      <div class="statGrid">
        ${statCard("إجمالي الإعلانات", total, "", "marketplace_listings")}
        ${statCard("بانتظار المراجعة", pending, pending ? `<span class="trend up">يحتاج إجراء</span>` : "", "marketplace_listings")}
        ${statCard("نشطة الآن", active, "", "marketplace_listings")}
        ${statCard("تم البيع", sold, "", null)}
        ${statCard("معارة حاليًا", borrowed, "", null)}
        ${statCard("تم الاستبدال", exchanged, "", null)}
        ${statCard("تم الإهداء", givenAway, "", null)}
        ${statCard("إعلانات مرفوضة", reported, "", null)}
        ${statCard("التصنيفات", categoriesCount, "", "marketplace_categories")}
        ${statCard("بلاغات بانتظار المراجعة", pendingReports, pendingReports ? `<span class="trend up">يحتاج إجراء</span>` : "", "marketplace_reports")}
      </div>
    `;
    body.querySelectorAll("[data-goto]").forEach(el=>{
      el.onclick = ()=> Admin.go(el.dataset.goto);
    });
  }
};

// ---------------- Listings (المراجعة الأساسية) ----------------
Admin.sections.marketplace_listings = {
  label: "إعلانات Marketplace",
  async render(body){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;

    const draw = async (statusFilter)=>{
      let q = db.from("marketplace_listings")
        .select("*, marketplace_categories(name), owner:profiles!marketplace_listings_owner_id_fkey(full_name,email)")
        .order("created_at",{ascending:false}).limit(100);
      if(statusFilter) q = q.eq("status", statusFilter);
      const { data: listings, error } = await q;
      if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الإعلانات.</span><button class="btn alertRetry" id="mplRetry">إعادة المحاولة</button></div>`; body.querySelector("#mplRetry").onclick=()=>Admin.go("marketplace_listings"); return; }

      body.innerHTML = `
        <div class="card" style="margin-bottom:12px">
          <label>تصفية حسب الحالة</label>
          <select id="mplStatusFilter">
            <option value="">كل الحالات</option>
            ${Object.entries(MP_STATUS_LABEL).map(([k,v])=>`<option value="${k}" ${statusFilter===k?"selected":""}>${v}</option>`).join("")}
          </select>
        </div>
        <div class="card"><div class="tableScroll"><table><thead><tr>
          <th>العنوان</th><th>النوع</th><th>الحالة</th><th>المالك</th><th>التصنيف</th><th></th>
        </tr></thead><tbody>
          ${listings.length ? listings.map(l=>`
            <tr>
              <td>${CodeUp.escapeHtml(l.title)}</td>
              <td>${MP_TYPE_LABEL[l.listing_type]||l.listing_type}</td>
              <td>${mpStatusBadge(l)}</td>
              <td>${CodeUp.escapeHtml(l.owner?.full_name || l.owner?.email || "")}</td>
              <td>${CodeUp.escapeHtml(l.marketplace_categories?.name || "—")}</td>
              <td style="white-space:nowrap">
                <button class="btn" data-viewlisting="${l.id}">عرض</button>
                ${l.status==='pending_review' ? `
                  <button class="btn dark" data-approvelisting="${l.id}">اعتماد</button>
                  <button class="btn" data-rejectlisting="${l.id}">رفض</button>
                `:""}
                <button class="btn" data-deletelisting="${l.id}" style="color:#F2555F">حذف</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="6"><div class="emptyStatePro"><h4>لا توجد إعلانات</h4></div></td></tr>`}
        </tbody></table></div></div>
      `;

      body.querySelector("#mplStatusFilter").onchange = (e)=> draw(e.target.value || null);

      body.querySelectorAll("[data-viewlisting]").forEach(b=>{
        b.onclick = ()=> openListingDrawer(listings.find(l=>l.id===b.dataset.viewlisting));
      });
      body.querySelectorAll("[data-approvelisting]").forEach(b=>{
        b.onclick = async ()=>{
          b.disabled = true;
          try{
            await db.rpc("marketplace_admin_review_listing", {p_listing_id: b.dataset.approvelisting, p_decision:"active"}).throwOnError();
            CodeUp.toast("تم اعتماد الإعلان", "success");
            draw(statusFilter);
          }catch(e){ CodeUp.toast(e.message || "تعذّر الاعتماد", "error"); b.disabled=false; }
        };
      });
      body.querySelectorAll("[data-rejectlisting]").forEach(b=>{
        b.onclick = async ()=>{
          if(!confirm("رفض هذا الإعلان؟")) return;
          b.disabled = true;
          try{
            await db.rpc("marketplace_admin_review_listing", {p_listing_id: b.dataset.rejectlisting, p_decision:"rejected"}).throwOnError();
            CodeUp.toast("تم رفض الإعلان", "success");
            draw(statusFilter);
          }catch(e){ CodeUp.toast(e.message || "تعذّر الرفض", "error"); b.disabled=false; }
        };
      });
      body.querySelectorAll("[data-deletelisting]").forEach(b=>{
        b.onclick = async ()=>{
          const l = listings.find(x=>x.id===b.dataset.deletelisting);
          const ok = confirm(`حذف إعلان Marketplace\n\nأنت على وشك حذف هذا الإعلان من النظام.\n\nالإعلان: ${l.title}\nالمالك: ${l.owner?.full_name || l.owner?.email || ""}\nالحالة: ${MP_STATUS_LABEL[l.status]||l.status}\n\nهل أنت متأكد؟`);
          if(!ok) return;
          b.disabled = true;
          try{
            const { data: paths, error } = await db.rpc("marketplace_delete_listing", {p_listing_id: l.id});
            if(error) throw error;
            if(paths && paths.length){
              try{ await db.storage.from("submissions").remove(paths); }catch(se){}
            }
            CodeUp.toast("تم حذف الإعلان نهائيًا", "success");
            draw(statusFilter);
          }catch(e){ CodeUp.toast(e.message || "تعذّر حذف الإعلان", "error"); b.disabled=false; }
        };
      });
    };
    draw(null);
  }
};

async function openListingDrawer(l){
  const { data: files } = await db.from("file_uploads").select("id,storage_path").eq("related_type","marketplace_listing").eq("related_id", l.id);
  const d = Admin.drawer(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <b>${CodeUp.escapeHtml(l.title)}</b>
      <button class="iconBtn" id="mplDrawerClose" aria-label="إغلاق">${Icon("x")}</button>
    </div>
    <p class="small">${MP_TYPE_LABEL[l.listing_type]||l.listing_type} — ${mpStatusBadge(l)}</p>
    ${l.description ? `<p>${CodeUp.escapeHtml(l.description)}</p>` : ""}
    <p class="small">المالك: ${CodeUp.escapeHtml(l.owner?.full_name || l.owner?.email || "")}</p>
    ${l.listing_type==='sale' && l.price!=null ? `<p class="small">السعر: ${l.price} ج.س</p>` : ""}
    ${l.listing_type==='exchange' ? `<p class="small">مرغوب استبداله بـ: ${CodeUp.escapeHtml(l.exchange_wanted_for||"")}</p>` : ""}
    ${l.listing_type==='borrow' ? `<p class="small">مدة الإعارة: ${l.borrow_duration_days} يوم</p>` : ""}
    ${files && files.length ? `<p class="small">${files.length} صورة مرفوعة</p>` : `<p class="small">بدون صور</p>`}
  `);
  d.el.querySelector("#mplDrawerClose").onclick = d.close;
}

// ---------------- Categories ----------------
Admin.sections.marketplace_categories = {
  label: "تصنيفات Marketplace",
  async render(body){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w60" style="height:30px;margin-bottom:10px"></div>`).join("")}</div>`;

    const draw = async ()=>{
      const { data: cats, error } = await db.from("marketplace_categories").select("*").order("order_index");
      if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل التصنيفات.</span><button class="btn alertRetry" id="mpcRetry">إعادة المحاولة</button></div>`; body.querySelector("#mpcRetry").onclick=()=>Admin.go("marketplace_categories"); return; }

      body.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
          <button class="btn dark" id="mpcAddBtn">+ تصنيف جديد</button>
        </div>
        <div class="card"><div class="tableScroll"><table><thead><tr><th>الاسم</th><th>Slug</th><th>الترتيب</th><th></th></tr></thead>
        <tbody>${cats.length ? cats.map(c=>`
          <tr><td>${CodeUp.escapeHtml(c.name)}</td><td>${CodeUp.escapeHtml(c.slug)}</td><td>${c.order_index}</td>
          <td style="white-space:nowrap"><button class="btn" data-editcat="${c.id}">تعديل</button><button class="btn" data-delcat="${c.id}">حذف</button></td></tr>
        `).join("") : `<tr><td colspan="4"><div class="emptyStatePro"><h4>لا توجد تصنيفات بعد</h4></div></td></tr>`}
        </tbody></table></div></div>
      `;

      const openForm = (cat)=>{
        const m = Admin.modal(`
          <h3 style="margin-top:0">${cat?"تعديل التصنيف":"تصنيف جديد"}</h3>
          <label>الاسم</label><input id="mpcName" value="${cat?CodeUp.escapeHtml(cat.name):""}">
          <label>Slug (بالإنجليزية، بدون مسافات)</label><input id="mpcSlug" value="${cat?CodeUp.escapeHtml(cat.slug):""}">
          <label>ترتيب العرض</label><input id="mpcOrder" type="number" value="${cat?cat.order_index:0}">
          <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
            <button class="btn" id="mpcCancel">إلغاء</button><button class="btn dark" id="mpcSave">${cat?"حفظ":"إضافة"}</button>
          </div>
          <div id="mpcMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
        `);
        m.el.querySelector("#mpcCancel").onclick = m.close;
        m.el.querySelector("#mpcSave").onclick = async ()=>{
          const msgEl = m.el.querySelector("#mpcMsg");
          const payload = {
            name: m.el.querySelector("#mpcName").value.trim(),
            slug: m.el.querySelector("#mpcSlug").value.trim(),
            order_index: Number(m.el.querySelector("#mpcOrder").value || 0)
          };
          if(!payload.name || !payload.slug){ msgEl.style.display="block"; msgEl.textContent = "الاسم والـSlug مطلوبان"; return; }
          try{
            if(cat) await db.from("marketplace_categories").update(payload).eq("id", cat.id).throwOnError();
            else await db.from("marketplace_categories").insert(payload).throwOnError();
            m.close(); draw();
          }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
        };
      };

      body.querySelector("#mpcAddBtn").onclick = ()=> openForm(null);
      body.querySelectorAll("[data-editcat]").forEach(b=>{
        b.onclick = ()=> openForm(cats.find(c=>c.id===b.dataset.editcat));
      });
      body.querySelectorAll("[data-delcat]").forEach(b=>{
        b.onclick = async ()=>{
          if(!confirm("حذف هذا التصنيف؟ الإعلانات المرتبطة به تبقى موجودة بدون تصنيف.")) return;
          const { error } = await db.from("marketplace_categories").delete().eq("id", b.dataset.delcat);
          if(error){ CodeUp.toast(error.message, "error"); return; }
          draw();
        };
      });
    };
    draw();
  }
};

// ---------------- Reports ----------------
Admin.sections.marketplace_reports = {
  label: "بلاغات Marketplace",
  async render(body){
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w80" style="height:34px;margin-bottom:10px"></div>`).join("")}</div>`;

    const draw = async ()=>{
      const { data: reports, error } = await db.from("marketplace_reports")
        .select("*, marketplace_listings(title), reporter:profiles!marketplace_reports_reported_by_fkey(full_name,email)")
        .order("created_at",{ascending:false});
      if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل البلاغات.</span><button class="btn alertRetry" id="mprRetry">إعادة المحاولة</button></div>`; body.querySelector("#mprRetry").onclick=()=>Admin.go("marketplace_reports"); return; }

      if(!reports.length){ body.innerHTML = `<div class="emptyStatePro"><h4>لا توجد بلاغات</h4><p>أي بلاغ يرسله الأعضاء عن إعلان أو عضو مخالف يظهر هنا.</p></div>`; return; }

      body.innerHTML = `<div class="card"><div class="tableScroll"><table><thead><tr>
        <th>الإعلان</th><th>المُبلِّغ</th><th>السبب</th><th>الحالة</th><th></th>
      </tr></thead><tbody>
        ${reports.map(r=>`
          <tr>
            <td>${CodeUp.escapeHtml(r.marketplace_listings?.title || "—")}</td>
            <td>${CodeUp.escapeHtml(r.reporter?.full_name || r.reporter?.email || "")}</td>
            <td>${CodeUp.escapeHtml(r.reason)}</td>
            <td>${{pending:"بانتظار المراجعة",under_review:"قيد المراجعة",resolved:"تمت المعالجة",rejected:"مرفوض"}[r.status]||r.status}</td>
            <td style="white-space:nowrap">
              ${r.status!=='resolved' ? `<button class="btn dark" data-resolvereport="${r.id}">معالجة</button>`:""}
              ${r.status!=='rejected' ? `<button class="btn" data-rejectreport="${r.id}">تجاهل</button>`:""}
            </td>
          </tr>`).join("")}
      </tbody></table></div></div>`;

      body.querySelectorAll("[data-resolvereport]").forEach(b=>{
        b.onclick = async ()=>{
          const { error } = await db.from("marketplace_reports").update({status:"resolved"}).eq("id", b.dataset.resolvereport);
          if(error){ CodeUp.toast(error.message, "error"); return; }
          draw();
        };
      });
      body.querySelectorAll("[data-rejectreport]").forEach(b=>{
        b.onclick = async ()=>{
          const { error } = await db.from("marketplace_reports").update({status:"rejected"}).eq("id", b.dataset.rejectreport);
          if(error){ CodeUp.toast(error.message, "error"); return; }
          draw();
        };
      });
    };
    draw();
  }
};
