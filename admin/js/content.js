// admin/js/content.js

Admin.sections.content = {
  label: "المحتوى التعليمي",
  async render(body){
    const cid = Admin.currentCourseId;
    if(!cid){ body.innerHTML = `<div class="emptyStatePro"><h4>لا يوجد كورس محدد</h4><p>اختر كورسًا من القائمة الجانبية أولًا.</p></div>`; return; }
    body.innerHTML = `<div class="card">${Array(2).fill(`<div class="skeleton skeleton-line w60" style="height:20px;margin-bottom:14px"></div>`).join("")}</div>`;
    const { data: units, error } = await db.from("units").select("*, lessons(*)").eq("course_id", cid).order("order_index");
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المحتوى.</span><button class="btn alertRetry" id="ctRetry">إعادة المحاولة</button></div>`; body.querySelector("#ctRetry").onclick=()=>Admin.go("content"); return; }

    // عدد مصادر كل درس (patch_54) — لو الجدول غير موجود نتجاهل بصمت
    const resCount = {};
    const lessonIds = (units||[]).flatMap(u=>(u.lessons||[]).map(l=>l.id));
    if(lessonIds.length){
      const rc = await db.from("lesson_resources").select("lesson_id").in("lesson_id", lessonIds);
      if(!rc.error) (rc.data||[]).forEach(x=>{ resCount[x.lesson_id] = (resCount[x.lesson_id]||0)+1; });
    }

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
          <div class="tableScroll"><table style="margin-top:10px"><thead><tr><th></th><th>الدرس</th><th>رابط الفيديو</th><th>مصادر التعلّم</th><th>ترتيب</th><th></th></tr></thead>
          <tbody data-lessonsof="${u.id}">${(u.lessons||[]).sort((a,b)=>a.order_index-b.order_index).map(l=>`
            <tr data-lessonrow="${l.id}" draggable="true">
              <td class="dragHandle" title="اسحب لإعادة الترتيب">${Icon("grip")}</td>
              <td>${CodeUp.escapeHtml(l.title)}</td>
              <td>${l.video_url?`<a href="${l.video_url}" target="_blank">رابط ↗</a>`:"—"}</td>
              <td><button class="btn dark" data-reslesson="${l.id}" data-unit="${u.id}">المصادر${resCount[l.id]?` (${resCount[l.id]})`:""}</button></td>
              <td>${l.order_index}</td>
              <td>
                <button class="btn" data-editlesson="${l.id}" data-unit="${u.id}">تعديل</button>
                <button class="btn danger" data-dellesson="${l.id}">حذف</button>
              </td>
            </tr>`).join("") || `<tr><td colspan="6"><div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">لا توجد دروس في هذه الوحدة بعد.</p></div></td></tr>`}
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
        Admin.kickTelegramCleanup();
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
    body.querySelectorAll("[data-reslesson]").forEach(b=>{
      const unit = units.find(u=>u.id===b.dataset.unit);
      const lesson = unit?.lessons?.find(l=>l.id===b.dataset.reslesson);
      b.onclick = ()=> openLessonResourcesModal(lesson);
    });
    body.querySelectorAll("[data-dellesson]").forEach(b=>{
      b.onclick = async ()=>{
        if(!await Admin.confirmDialog({title:"حذف الدرس", message:"لا يمكن التراجع عن هذا الإجراء.", confirmLabel:"حذف", danger:true})) return;
        const { error } = await db.from("lessons").delete().eq("id", b.dataset.dellesson);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.kickTelegramCleanup();
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

// نافذة مخصّصة لمصادر درس واحد (نفس لوحة المصادر الموجودة داخل نافذة تعديل الدرس)
function openLessonResourcesModal(lesson){
  const m = Admin.modal(`
    <h3>مصادر الدرس: ${CodeUp.escapeHtml(lesson.title)}</h3>
    <div id="lrBox"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn dark" id="lrDone">تم</button></div>`);
  renderLessonResources(m.el.querySelector("#lrBox"), lesson.id);
  m.el.querySelector("#lrDone").onclick = ()=>{ m.close(); Admin.go("content"); };
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


// ===== مصادر التعلّم للدرس (patch_54/57) — اللوحة نفسها في resource_panel.js، وهنا فقط ربطها بجدولي resources / lesson_resources =====
const LESSON_RESOURCE_TYPES = {youtube_video:"فيديو يوتيوب", youtube_course:"دورة يوتيوب", article:"مقال", docs:"توثيق", pdf:"PDF", website:"موقع", interactive:"تفاعلي", github:"GitHub", external_course:"دورة خارجية"};

function lessonResourceAdapter(lessonId){
  const thr = q=>q.throwOnError();
  return {
    pageName:"الدرس", fileCtx:{kind:"lesson", id:lessonId}, types:LESSON_RESOURCE_TYPES, defaultType:"youtube_video", hasStart:true,
    studyHelp:"ملخصات وبطاقات للمراجعة. ملف PDF وبطاقات Anki من حقول الدرس تظهر هنا تلقائيًا.",
    setupHint:"تأكد من تشغيل patch_54 وpatch_57 في Supabase.",
    async load(){
      const {data, error} = await db.from("lesson_resources").select("id, role, order_index, resource_id, resources(id,title,url,type,publisher,language,duration_minutes,start_at)").eq("lesson_id", lessonId);
      if(error) throw new Error(error.message);
      const rows = data||[];
      const reports = {};
      if(rows.length){
        const r = await db.from("resource_reports").select("resource_id").in("resource_id", rows.map(x=>x.resource_id));
        (r.data||[]).forEach(x=>{ reports[x.resource_id] = (reports[x.resource_id]||0)+1; });
      }
      return rows.map(x=>({id:x.id, role:x.role, order_index:x.order_index, resource_id:x.resource_id,
        title:x.resources?.title, url:x.resources?.url, type:x.resources?.type, publisher:x.resources?.publisher,
        language:x.resources?.language, duration_minutes:x.resources?.duration_minutes, start_at:x.resources?.start_at,
        reports:reports[x.resource_id]||0}));
    },
    async create(payload, role, idx){
      const {data: res} = await thr(db.from("resources").insert({...payload, created_by: Admin.ctx?.user?.id || null}).select("id").single());
      await thr(db.from("lesson_resources").insert({lesson_id: lessonId, resource_id: res.id, role, order_index: idx}));
    },
    async update(row, payload, role, newIdx){
      await thr(db.from("resources").update(payload).eq("id", row.resource_id));
      if(newIdx!==null) await thr(db.from("lesson_resources").update({role, order_index:newIdx}).eq("id", row.id));
    },
    async remove(row){ await thr(db.from("lesson_resources").delete().eq("id", row.id)); },
    async setOrder(row, idx){ await thr(db.from("lesson_resources").update({order_index: idx}).eq("id", row.id)); },
    async demoteRecommended(exceptId){
      let q = db.from("lesson_resources").update({role:"alternative"}).eq("lesson_id", lessonId).eq("role","recommended");
      if(exceptId) q = q.neq("id", exceptId);
      await thr(q);
    }
  };
}

function renderLessonResources(box, lessonId){ return renderResourcePanel(box, lessonResourceAdapter(lessonId)); }
