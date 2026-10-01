// admin/js/content.js

Admin.sections.content = {
  label: "المحتوى التعليمي",
  async render(body){
    const cid = Admin.currentCourseId;
    if(!cid){ body.innerHTML = `<div class="emptyStatePro"><h4>لا يوجد كورس محدد</h4><p>اختر كورسًا من القائمة الجانبية أولًا.</p></div>`; return; }
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w60" style="height:20px;margin-bottom:14px"></div>`).join("")}</div>`;
    const { data: units, error } = await db.from("units").select("*, lessons(*)").eq("course_id", cid).order("order_index");
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المحتوى.</span><button class="btn alertRetry" id="ctRetry">إعادة المحاولة</button></div>`; body.querySelector("#ctRetry").onclick=()=>Admin.go("content"); return; }

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newUnitBtn">+ وحدة جديدة</button></div>
      ${(units||[]).map(u=>`
        <div class="card">
          <div class="row" style="display:flex;justify-content:space-between;align-items:center">
            <b>${CodeUp.escapeHtml(u.title)}</b> <span class="small mono" style="color:var(--ink60)">(ترتيب: ${u.order_index})</span>
            <div>
              <button class="btn" data-editunit="${u.id}">تعديل</button>
              <button class="btn danger" data-delunit="${u.id}">حذف الوحدة</button>
            </div>
          </div>
          <div class="tableScroll"><table style="margin-top:10px"><thead><tr><th></th><th>الدرس</th><th>رابط الفيديو</th><th>ترتيب</th><th></th></tr></thead>
          <tbody data-lessonsof="${u.id}">${(u.lessons||[]).sort((a,b)=>a.order_index-b.order_index).map(l=>`
            <tr data-lessonrow="${l.id}" draggable="true">
              <td class="dragHandle" title="اسحب لإعادة الترتيب">${Icon("grip")}</td>
              <td>${CodeUp.escapeHtml(l.title)}</td>
              <td>${l.video_url?`<a href="${l.video_url}" target="_blank">رابط ↗</a>`:"—"}</td>
              <td>${l.order_index}</td>
              <td>
                <button class="btn" data-editlesson="${l.id}" data-unit="${u.id}">تعديل</button>
                <button class="btn danger" data-dellesson="${l.id}">حذف</button>
              </td>
            </tr>`).join("") || `<tr><td colspan="5"><div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">لا توجد دروس في هذه الوحدة بعد.</p></div></td></tr>`}
          </tbody></table></div>
          ${(u.lessons||[]).length>1?`<p class="small" style="margin-top:6px">اسحب أي درس من المقبض لإعادة ترتيبه.</p>`:""}
          <button class="btn" style="margin-top:10px" data-addlesson="${u.id}">+ إضافة درس</button>
        </div>
      `).join("") || `<div class="emptyStatePro"><h4>لا توجد وحدات بعد</h4><p>ابدأ بإضافة أول وحدة لهذا الكورس.</p></div>`}
    `;

    body.querySelector("#newUnitBtn").onclick = ()=> openUnitModal(cid);
    body.querySelectorAll("[data-editunit]").forEach(b=>{
      b.onclick = ()=> openUnitModal(cid, units.find(u=>u.id===b.dataset.editunit));
    });
    body.querySelectorAll("[data-delunit]").forEach(b=>{
      b.onclick = async ()=>{
        if(!await Admin.confirmDialog({title:"حذف الوحدة", message:"سيتم حذف كل دروسها معها، ولا يمكن التراجع عن هذا الإجراء.", confirmLabel:"حذف", danger:true})) return;
        const { error } = await db.from("units").delete().eq("id", b.dataset.delunit);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("content");
      };
    });
    body.querySelectorAll("[data-addlesson]").forEach(b=>{
      b.onclick = ()=> openLessonModal(b.dataset.addlesson);
    });
    body.querySelectorAll("[data-editlesson]").forEach(b=>{
      const unit = units.find(u=>u.id===b.dataset.unit);
      const lesson = unit?.lessons?.find(l=>l.id===b.dataset.editlesson);
      b.onclick = ()=> openLessonModal(b.dataset.unit, lesson);
    });
    body.querySelectorAll("[data-dellesson]").forEach(b=>{
      b.onclick = async ()=>{
        if(!await Admin.confirmDialog({title:"حذف الدرس", message:"لا يمكن التراجع عن هذا الإجراء.", confirmLabel:"حذف", danger:true})) return;
        const { error } = await db.from("lessons").delete().eq("id", b.dataset.dellesson);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("content");
      };
    });
    body.querySelectorAll("[data-lessonsof]").forEach(tbody=>{
      wireLessonDragDrop(tbody);
    });
  }
};

// إعادة الترتيب بالسحب — تحدّث فقط عمود order_index الموجود أصلًا على lessons، بدون أي تغيير بالبنية
function wireLessonDragDrop(tbody){
  let draggedRow = null;
  tbody.querySelectorAll("tr[data-lessonrow]").forEach(row=>{
    row.addEventListener("dragstart", ()=>{ draggedRow = row; row.classList.add("dragging"); });
    row.addEventListener("dragend", ()=> row.classList.remove("dragging"));
    row.addEventListener("dragover", (e)=>{
      e.preventDefault();
      if(!draggedRow || draggedRow===row) return;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height/2;
      tbody.insertBefore(draggedRow, before ? row : row.nextSibling);
    });
    row.addEventListener("drop", async (e)=>{
      e.preventDefault();
      if(!draggedRow) return;
      const rows = Array.from(tbody.querySelectorAll("tr[data-lessonrow]"));
      const updates = rows.map((r,i)=>({ id:r.dataset.lessonrow, order_index:i }));
      draggedRow = null;
      try{
        await Promise.all(updates.map(u=> db.from("lessons").update({order_index:u.order_index}).eq("id",u.id).throwOnError()));
        CodeUp.toast("تم تحديث الترتيب", "success");
      }catch(err){ CodeUp.toast(err.message || "تعذّر حفظ الترتيب", "error"); }
      Admin.go("content");
    });
  });
}

function openUnitModal(courseId, unit, onDone){
  onDone = onDone || (()=>Admin.go("content"));
  const isEdit = !!unit;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الوحدة":"وحدة جديدة"}</h3>
    <label>العنوان</label><input id="uTitle" value="${unit?CodeUp.escapeHtml(unit.title):""}">
    <label>الترتيب</label><input id="uOrder" type="number" value="${unit?.order_index??0}">
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="uCancel">إلغاء</button><button class="btn dark" id="uSave">حفظ</button>
    </div><div id="uMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#uCancel").onclick = m.close;
  m.el.querySelector("#uSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#uMsg");
    const payload = { title: m.el.querySelector("#uTitle").value.trim(), order_index: Number(m.el.querySelector("#uOrder").value)||0 };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان إلزامي"; return; }
    try{
      if(isEdit) await db.from("units").update(payload).eq("id", unit.id).throwOnError();
      else await db.from("units").insert({...payload, course_id: courseId}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); onDone();
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

async function openLessonModal(unitId, lesson, onDone){
  onDone = onDone || (()=>Admin.go("content"));
  const isEdit = !!lesson;

  // بطاقات Anki: نفس فكرة رابط PDF بالضبط — رابط مباشر يُخزَّن كنص بجدول lessons
  // (anki_ar_url / anki_en_url)، بدون أي رفع ملفات وبدون Supabase Storage إطلاقًا.
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الدرس":"درس جديد"}</h3>
    <label>العنوان</label><input id="lTitle" value="${lesson?CodeUp.escapeHtml(lesson.title):""}">
    <label>رابط الفيديو (اختياري)</label><input id="lVideo" value="${lesson?CodeUp.escapeHtml(lesson.video_url||""):""}" placeholder="https://...">
    <label>محتوى نصي (اختياري)</label><textarea id="lText" rows="4" placeholder="شرح مكتوب يظهر بصفحة الدرس للطالب">${lesson?CodeUp.escapeHtml(lesson.text_content||""):""}</textarea>
    <label>رابط PDF (اختياري)</label><input id="lPdf" value="${lesson?CodeUp.escapeHtml(lesson.pdf_url||""):""}" placeholder="https://...">
    <label style="margin-top:14px;display:block">بطاقات Anki — النسخة العربية (رابط مباشر، اختياري)</label>
    <input id="lAnkiAr" value="${lesson?CodeUp.escapeHtml(lesson.anki_ar_url||""):""}" placeholder="https://...">
    <label style="margin-top:10px;display:block">بطاقات Anki — English Version (رابط مباشر، اختياري)</label>
    <input id="lAnkiEn" value="${lesson?CodeUp.escapeHtml(lesson.anki_en_url||""):""}" placeholder="https://...">
    <label>الترتيب</label><input id="lOrder" type="number" value="${lesson?.order_index??0}">
    <div id="lResBox"></div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="lCancel">إلغاء</button><button class="btn dark" id="lSave">حفظ</button>
    </div><div id="lMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#lCancel").onclick = m.close;
  const resBox = m.el.querySelector("#lResBox");
  if(isEdit) renderLessonResources(resBox, lesson.id);
  else resBox.innerHTML = `<div class="small" style="margin-top:14px">احفظ الدرس أولًا ثم أضف مصادر التعلّم.</div>`;
  m.el.querySelector("#lSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#lMsg");
    const payload = {
      title: m.el.querySelector("#lTitle").value.trim(),
      video_url: m.el.querySelector("#lVideo").value.trim() || null,
      text_content: m.el.querySelector("#lText").value.trim() || null,
      pdf_url: m.el.querySelector("#lPdf").value.trim() || null,
      anki_ar_url: m.el.querySelector("#lAnkiAr").value.trim() || null,
      anki_en_url: m.el.querySelector("#lAnkiEn").value.trim() || null,
      order_index: Number(m.el.querySelector("#lOrder").value)||0
    };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان إلزامي"; return; }
    try{
      if(isEdit) await db.from("lessons").update(payload).eq("id", lesson.id).throwOnError();
      else await db.from("lessons").insert({...payload, unit_id: unitId}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); onDone();
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}


// ===== مصادر التعلّم للدرس (patch_54/57) — جدولا resources / lesson_resources =====
// الأدوار تطابق أقسام صفحة الدرس عند الطالب
const LP_ROLE_LABEL = {recommended:"المصدر الأساسي", alternative:"مصدر بديل", deep_dive:"تعمّق", study:"للمذاكرة"};
const LP_ROLE_RANK = {recommended:0, alternative:1, deep_dive:2, study:3};
const LP_TYPE_LABEL = {youtube_video:"فيديو يوتيوب", youtube_course:"دورة يوتيوب", article:"مقال", docs:"توثيق", pdf:"PDF", website:"موقع", interactive:"تفاعلي", github:"GitHub", external_course:"دورة خارجية"};
const LP_LANG_LABEL = {ar:"عربي", en:"English", other:"أخرى"};

async function renderLessonResources(box, lessonId){
  const esc = CodeUp.escapeHtml;
  box.innerHTML = `<div class="small" style="margin-top:14px">جارِ تحميل المصادر…</div>`;
  const {data, error} = await db.from("lesson_resources").select("id, role, order_index, resource_id, resources(id,title,url,type,publisher,language,duration_minutes,start_at)").eq("lesson_id", lessonId);
  if(error){
    box.innerHTML = `<div class="small" style="margin-top:14px;color:#F2555F">تعذّر تحميل المصادر — تأكد من تشغيل patch_54 وpatch_57 في Supabase. (${esc(error.message)})</div>`;
    return;
  }
  const rows = (data||[]).sort((a,b)=>(LP_ROLE_RANK[a.role]-LP_ROLE_RANK[b.role]) || (a.order_index-b.order_index));
  const reports = {};
  if(rows.length){
    const r = await db.from("resource_reports").select("resource_id").in("resource_id", rows.map(x=>x.resource_id));
    (r.data||[]).forEach(x=>{ reports[x.resource_id] = (reports[x.resource_id]||0)+1; });
  }
  const meta = x=>[LP_TYPE_LABEL[x.resources?.type], x.resources?.publisher, LP_LANG_LABEL[x.resources?.language], x.resources?.duration_minutes?`${x.resources.duration_minutes} د`:""].filter(Boolean).join(" · ");
  const group = role=>rows.filter(x=>x.role===role);
  const sectionHtml = role=>{
    const g = group(role); if(!g.length) return "";
    return `<div class="small" style="margin:12px 0 4px;font-weight:700">${LP_ROLE_LABEL[role]}${role==="recommended"?" (واحد فقط)":""}</div>` + g.map((x,i)=>`
      <div style="display:flex;gap:6px;align-items:center;padding:8px 0;border-top:1px solid var(--line)">
        <div style="flex:1;min-width:0"><b style="font-size:13px">${esc(x.resources?.title||"")}</b>
          <div class="small">${esc(meta(x))}${reports[x.resource_id]?` · <span style="color:#F2555F">بلاغات: ${reports[x.resource_id]}</span>`:""}</div></div>
        <button class="btn" data-rup="${x.id}" ${i===0?"disabled":""} aria-label="تحريك للأعلى">↑</button>
        <button class="btn" data-rdown="${x.id}" ${i===g.length-1?"disabled":""} aria-label="تحريك للأسفل">↓</button>
        <button class="btn" data-redit="${x.id}">تعديل</button>
        <button class="btn danger" data-rdel="${x.id}">إزالة</button>
      </div>`).join("");
  };
  box.innerHTML = `
    <label style="margin-top:14px;display:block">مصادر التعلّم (المصدر الأساسي، البدائل، التعمّق، للمذاكرة)</label>
    <div class="small" style="margin-bottom:4px">رابط الفيديو وPDF وAnki في الحقول أعلاه تظهر للطالب تلقائيًا (الفيديو كمصدر أساسي إن لم تضف مصدرًا أساسيًا هنا، وPDF وAnki ضمن «للمذاكرة»).</div>
    ${["recommended","alternative","deep_dive","study"].map(sectionHtml).join("") || `<div class="small">لا توجد مصادر مضافة بعد.</div>`}
    <button class="btn" id="addResBtn" style="margin-top:10px">+ إضافة مصدر</button>`;

  const byId = Object.fromEntries(rows.map(x=>[x.id,x]));
  const reload = ()=>renderLessonResources(box, lessonId);
  const demoteRecommended = async (exceptId)=>{
    let q = db.from("lesson_resources").update({role:"alternative"}).eq("lesson_id", lessonId).eq("role","recommended");
    if(exceptId) q = q.neq("id", exceptId);
    await q.throwOnError();
  };
  // ترتيب: نبدّل مكان العنصر مع جاره داخل نفس القسم ثم نعيد ترقيم القسم كاملًا (0..n)
  const move = async (id, dir)=>{
    const x = byId[id]; const g = group(x.role); const i = g.findIndex(y=>y.id===id); const j = i+dir;
    if(j<0 || j>=g.length) return;
    [g[i], g[j]] = [g[j], g[i]];
    try{
      await Promise.all(g.map((y,k)=>db.from("lesson_resources").update({order_index:k}).eq("id", y.id).throwOnError()));
      reload();
    }catch(e){ CodeUp.toast(e.message,"error"); }
  };
  box.querySelectorAll("[data-rup]").forEach(b=>b.onclick=()=>move(b.dataset.rup,-1));
  box.querySelectorAll("[data-rdown]").forEach(b=>b.onclick=()=>move(b.dataset.rdown,1));
  box.querySelectorAll("[data-rdel]").forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm("إزالة هذا المصدر من الدرس؟")) return;
      try{ await db.from("lesson_resources").delete().eq("id", b.dataset.rdel).throwOnError(); reload(); }
      catch(e){ CodeUp.toast(e.message,"error"); }
    };
  });
  box.querySelectorAll("[data-redit]").forEach(b=>b.onclick=()=>openResourceModal(byId[b.dataset.redit]));
  box.querySelector("#addResBtn").onclick = ()=>openResourceModal(null);

  // نافذة إضافة/تعديل مصدر (نفس النموذج للحالتين)
  function openResourceModal(row){
    const edit = !!row, r = row?.resources || {};
    const opt = (map, cur)=>Object.keys(map).map(k=>`<option value="${k}" ${k===cur?"selected":""}>${map[k]}</option>`).join("");
    const m2 = Admin.modal(`
      <h3>${edit?"تعديل المصدر":"مصدر تعلّم جديد"}</h3>
      <label>القسم في صفحة الدرس</label><select id="rRole">${opt(LP_ROLE_LABEL, row?.role||"alternative")}</select>
      <label>النوع</label><select id="rType">${opt(LP_TYPE_LABEL, r.type||"youtube_video")}</select>
      <label>العنوان</label><input id="rTitle" value="${esc(r.title||"")}">
      <label>الرابط</label><input id="rUrl" dir="ltr" placeholder="https://..." value="${esc(r.url||"")}">
      <label>الناشر / القناة (اختياري)</label><input id="rPub" value="${esc(r.publisher||"")}">
      <label>اللغة</label><select id="rLang">${opt(LP_LANG_LABEL, r.language||"ar")}</select>
      <label>المدة بالدقائق (اختياري)</label><input id="rDur" type="number" min="1" max="1000" value="${r.duration_minutes??""}">
      <label>بداية الفيديو بالثواني (اختياري، ليوتيوب)</label><input id="rStart" type="number" min="0" value="${r.start_at??""}">
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button class="btn" id="rCancel">إلغاء</button><button class="btn dark" id="rSave">حفظ</button></div>
      <div id="rMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>`);
    m2.el.querySelector("#rCancel").onclick = m2.close;
    m2.el.querySelector("#rSave").onclick = async ()=>{
      const g = id=>m2.el.querySelector(id).value.trim();
      const msg = m2.el.querySelector("#rMsg");
      const fail = t=>{ msg.style.display="block"; msg.textContent=t; };
      if(!g("#rTitle")) return fail("العنوان إلزامي");
      if(!/^https?:\/\//i.test(g("#rUrl"))) return fail("الرابط يجب أن يبدأ بـ https://");
      const dur = g("#rDur") ? Number(g("#rDur")) : null;
      if(dur!==null && !(dur>=1 && dur<=1000)) return fail("المدة بين 1 و1000 دقيقة");
      const payload = {
        type: g("#rType"), title: g("#rTitle"), url: g("#rUrl"), publisher: g("#rPub")||null,
        language: g("#rLang"), duration_minutes: dur, start_at: g("#rStart") ? Number(g("#rStart")) : null
      };
      const role = g("#rRole");
      try{
        if(edit){
          await db.from("resources").update(payload).eq("id", row.resource_id).throwOnError();
          if(role==="recommended") await demoteRecommended(row.id);
          if(role!==row.role){
            const last = rows.filter(y=>y.role===role).length;
            await db.from("lesson_resources").update({role, order_index:last}).eq("id", row.id).throwOnError();
          }
        }else{
          const {data: res} = await db.from("resources").insert({...payload, created_by: Admin.ctx?.user?.id || null}).select("id").single().throwOnError();
          if(role==="recommended") await demoteRecommended();
          await db.from("lesson_resources").insert({lesson_id: lessonId, resource_id: res.id, role, order_index: rows.filter(y=>y.role===role).length}).throwOnError();
        }
        CodeUp.toast(edit?"تم حفظ التعديل":"تمت إضافة المصدر","success"); m2.close(); reload();
      }catch(e){ fail(e.message); }
    };
  }
}
