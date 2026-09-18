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
        if(!confirm("حذف الوحدة؟\n\nسيتم حذف كل دروسها معها، ولا يمكن التراجع عن هذا الإجراء.")) return;
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
        if(!confirm("حذف هذا الدرس؟\n\nلا يمكن التراجع عن هذا الإجراء.")) return;
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

  // ملفات Anki الحالية لهذا الدرس (لو موجود) — نفس جدول file_uploads الموجود أصلًا،
  // بقيمتين جديدتين لعمود related_type (anki_ar / anki_en)، بدون أي جدول جديد وبدون نظام بطاقات
  let ankiFiles = { anki_ar:null, anki_en:null };
  if(isEdit){
    const { data } = await db.from("file_uploads").select("*").eq("related_id", lesson.id).in("related_type", ["anki_ar","anki_en"]);
    (data||[]).forEach(f=>{ ankiFiles[f.related_type] = f; });
  }

  const ankiRowHtml = (lang, label)=>{
    const f = ankiFiles[lang];
    return `
      <div class="card2" style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <b style="font-size:13px">${label}</b>
          ${f?`<span class="pill approved">مرفوع</span>`:`<span class="pill neutral">لا يوجد</span>`}
        </div>
        ${f?`<div class="small" style="margin-top:6px">${CodeUp.escapeHtml(f.file_name)}</div>`:""}
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <input type="file" accept=".apkg" id="ankiFile_${lang}" style="flex:1">
          <button class="btn" data-ankiupload="${lang}">${f?"استبدال":"رفع"}</button>
          ${f?`<button class="btn danger" data-ankidelete="${lang}">حذف</button>`:""}
        </div>
      </div>`;
  };

  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الدرس":"درس جديد"}</h3>
    <label>العنوان</label><input id="lTitle" value="${lesson?CodeUp.escapeHtml(lesson.title):""}">
    <label>رابط الفيديو (اختياري)</label><input id="lVideo" value="${lesson?CodeUp.escapeHtml(lesson.video_url||""):""}" placeholder="https://...">
    <label>محتوى نصي (اختياري)</label><textarea id="lText" rows="4" placeholder="شرح مكتوب يظهر بصفحة الدرس للطالب">${lesson?CodeUp.escapeHtml(lesson.text_content||""):""}</textarea>
    <label>رابط PDF (اختياري)</label><input id="lPdf" value="${lesson?CodeUp.escapeHtml(lesson.pdf_url||""):""}" placeholder="https://...">
    <label>الترتيب</label><input id="lOrder" type="number" value="${lesson?.order_index??0}">
    ${isEdit?`
      <label style="margin-top:14px;display:block">بطاقات Anki (ملفات APKG جاهزة — يرفعها الأدمن كما هي، بدون تعديل)</label>
      ${ankiRowHtml("anki_ar","النسخة العربية")}
      ${ankiRowHtml("anki_en","English Version")}
    `:`<p class="small" style="margin-top:10px">احفظ الدرس أولًا حتى تقدر ترفع ملفات Anki له.</p>`}
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="lCancel">إلغاء</button><button class="btn dark" id="lSave">حفظ</button>
    </div><div id="lMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#lCancel").onclick = m.close;
  m.el.querySelector("#lSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#lMsg");
    const payload = {
      title: m.el.querySelector("#lTitle").value.trim(),
      video_url: m.el.querySelector("#lVideo").value.trim() || null,
      text_content: m.el.querySelector("#lText").value.trim() || null,
      pdf_url: m.el.querySelector("#lPdf").value.trim() || null,
      order_index: Number(m.el.querySelector("#lOrder").value)||0
    };
    if(!payload.title){ msgEl.style.display="block"; msgEl.textContent="العنوان إلزامي"; return; }
    try{
      if(isEdit) await db.from("lessons").update(payload).eq("id", lesson.id).throwOnError();
      else await db.from("lessons").insert({...payload, unit_id: unitId}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); onDone();
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };

  if(isEdit){
    m.el.querySelectorAll("[data-ankiupload]").forEach(btn=>{
      btn.onclick = async ()=>{
        const lang = btn.dataset.ankiupload;
        const fileInput = m.el.querySelector(`#ankiFile_${lang}`);
        const file = fileInput.files[0];
        if(!file){ CodeUp.toast("اختر ملف APKG أولًا", "error"); return; }
        if(!file.name.toLowerCase().endsWith(".apkg")){ CodeUp.toast("الملف يجب أن يكون بصيغة .apkg", "error"); return; }
        btn.disabled = true; const oldLabel = btn.textContent; btn.textContent = "جارِ الرفع…";
        try{
          const cleanName = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `anki/${lesson.id}/${lang}/${Date.now()}_${cleanName}`;
          const { error: upErr } = await db.storage.from("course-assets").upload(path, file, { upsert:false });
          if(upErr) throw upErr;
          const old = ankiFiles[lang];
          await db.from("file_uploads").insert({
            uploader_id: Admin.ctx.user.id, related_type: lang, related_id: lesson.id,
            course_id: Admin.currentCourseId, storage_path: path,
            file_name: file.name, mime_type: "application/octet-stream", file_size: file.size,
            archive_status: "live"
          }).throwOnError();
          if(old){
            await db.storage.from("course-assets").remove([old.storage_path]).catch(()=>{});
            await db.from("file_uploads").delete().eq("id", old.id);
          }
          CodeUp.toast("تم رفع الملف", "success");
          m.close(); openLessonModal(unitId, lesson, onDone);
        }catch(e){ CodeUp.toast(e.message || "تعذّر رفع الملف", "error"); btn.disabled=false; btn.textContent = oldLabel; }
      };
    });
    m.el.querySelectorAll("[data-ankidelete]").forEach(btn=>{
      btn.onclick = async ()=>{
        const lang = btn.dataset.ankidelete;
        const f = ankiFiles[lang];
        if(!f) return;
        if(!confirm("حذف ملف Anki هذا نهائيًا؟\n\nلا يمكن التراجع عن هذا الإجراء.")) return;
        try{
          await db.storage.from("course-assets").remove([f.storage_path]).catch(()=>{});
          await db.from("file_uploads").delete().eq("id", f.id).throwOnError();
          CodeUp.toast("تم الحذف", "success");
          m.close(); openLessonModal(unitId, lesson, onDone);
        }catch(e){ CodeUp.toast(e.message || "تعذّر الحذف", "error"); }
      };
    });
  }
}
