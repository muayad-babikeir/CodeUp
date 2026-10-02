// admin/js/tracks.js — مسارات التعلّم (patch_54). للسوبر أدمن فقط

Admin.sections.tracks = {
  label: "مسارات التعلّم",
  async render(body){
    const esc = CodeUp.escapeHtml;
    if(Admin.role !== "super"){ body.innerHTML = `<div class="emptyState">هذا القسم للسوبر أدمن فقط.</div>`; return; }
    body.innerHTML = `<div class="card"><div class="skeleton skeleton-line w80" style="height:44px"></div></div>`;
    const {data: tracks, error} = await db.from("tracks").select("*, track_courses(id)").order("created_at");
    if(error){
      body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل المسارات — تأكد من تشغيل patch_54 في Supabase. (${esc(error.message)})</span></div>`;
      return;
    }
    body.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <b>ما هو المسار؟</b>
        <p class="small" style="margin:6px 0">المسار هو <b>ترتيب لعدة كورسات في مراحل</b>، ليعرف الطالب ماذا يتعلّم أولًا وماذا بعده. الكورسات نفسها لا تتغير، والمسار يرتّبها فقط.</p>
        <p class="small" style="margin:6px 0">مثال: مسار «المبرمج» ← المرحلة 1: أساسيات الخوارزميات ← المرحلة 2: التطبيق بلغة برمجة ← المرحلة 3: قواعد البيانات.</p>
        <ol class="small" style="margin:6px 0 0;padding-inline-start:18px;line-height:1.9">
          <li>اضغط «+ مسار جديد» وسمِّه.</li>
          <li>اضغط «إدارة الكورسات» وأضف كورساتك مع <b>رقم المرحلة</b> (الكورسات ذات الرقم نفسه تظهر معًا في مرحلة واحدة).</li>
          <li>يظهر المسار للطالب أعلى صفحة «الكورسات» بتقدّمه، والكورسات غير المنشورة لا تظهر فيه. الشرط المسبق مجرّد تنبيه ولا يقفل الكورس.</li>
        </ol>
      </div>
      <div class="toolbar"><button class="btn dark" id="newTrackBtn">+ مسار جديد</button></div>
      <div class="card"><div class="tableScroll"><table>
        <thead><tr><th>المسار</th><th>الكورسات</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${(tracks||[]).map(t=>`
          <tr>
            <td><b>${esc(t.name)}</b><div class="small mono">${esc(t.slug)}</div></td>
            <td>${(t.track_courses||[]).length}</td>
            <td><span class="pill ${t.is_active?"approved":"pending"}">${t.is_active?"فعّال":"متوقف"}</span></td>
            <td><button class="btn" data-manage="${t.id}">إدارة الكورسات</button> <button class="btn" data-edit="${t.id}">تعديل</button></td>
          </tr>`).join("") || `<tr><td colspan="4"><div class="emptyStatePro"><h4>لا توجد مسارات بعد</h4><p>اضغط «+ مسار جديد» أعلاه لتبدأ، ثم أضف إليه كورساتك بمراحلها.</p></div></td></tr>`}
        </tbody></table></div></div>`;
    const byId = Object.fromEntries((tracks||[]).map(t=>[t.id,t]));
    body.querySelector("#newTrackBtn").onclick = ()=>openTrackModal(null);
    body.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openTrackModal(byId[b.dataset.edit]));
    body.querySelectorAll("[data-manage]").forEach(b=>b.onclick=()=>openTrackCoursesModal(byId[b.dataset.manage]));
  }
};

function openTrackModal(track){
  const esc = CodeUp.escapeHtml, isEdit = !!track;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل المسار":"مسار جديد"}</h3>
    <label>الاسم</label><input id="tName" value="${isEdit?esc(track.name):""}">
    <label>المعرّف (إنجليزي صغير وشرطات)</label><input id="tSlug" dir="ltr" value="${isEdit?esc(track.slug):""}" placeholder="programmer-path">
    <label>الوصف (اختياري)</label><textarea id="tDesc" rows="3">${isEdit?esc(track.description||""):""}</textarea>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="tActive" ${!isEdit||track.is_active?"checked":""}> فعّال (يظهر للطلاب)</label>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button class="btn" id="tCancel">إلغاء</button><button class="btn dark" id="tSave">حفظ</button></div>
    <div id="tMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>`);
  m.el.querySelector("#tCancel").onclick = m.close;
  m.el.querySelector("#tSave").onclick = async ()=>{
    const g = id=>m.el.querySelector(id).value.trim();
    const msg = m.el.querySelector("#tMsg");
    const fail = t=>{ msg.style.display="block"; msg.textContent=t; };
    if(!g("#tName")) return fail("الاسم إلزامي");
    if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(g("#tSlug"))) return fail("المعرّف: أحرف إنجليزية صغيرة وأرقام وشرطات فقط");
    const payload = {name:g("#tName"), slug:g("#tSlug"), description:g("#tDesc")||null, is_active:m.el.querySelector("#tActive").checked};
    try{
      if(isEdit) await db.from("tracks").update(payload).eq("id", track.id).throwOnError();
      else await db.from("tracks").insert(payload).throwOnError();
      CodeUp.toast("تم الحفظ","success"); m.close(); Admin.go("tracks");
    }catch(e){ fail(/duplicate|unique/i.test(e.message||"") ? "هذا المعرّف مستخدم من قبل" : e.message); }
  };
}

async function openTrackCoursesModal(track){
  const esc = CodeUp.escapeHtml;
  const m = Admin.modal(`<div id="tcBox"><div class="small">جارِ التحميل…</div></div>`);
  const box = m.el.querySelector("#tcBox");
  const draw = async ()=>{
    const [{data: rows, error}, {data: courses}] = await Promise.all([
      db.from("track_courses").select("id,course_id,stage,stage_title,order_index,is_optional,prereq_note,courses(name)").eq("track_id", track.id).order("stage").order("order_index"),
      db.from("courses").select("id,name").order("name")
    ]);
    if(error){ box.innerHTML = `<div class="small" style="color:#F2555F">${esc(error.message)}</div>`; return; }
    const used = new Set((rows||[]).map(r=>r.course_id));
    const free = (courses||[]).filter(c=>!used.has(c.id));
    box.innerHTML = `
      <h3>كورسات المسار: ${esc(track.name)}</h3>
      ${(rows||[]).map(r=>`
        <div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)">
          <div style="flex:1;min-width:0"><b style="font-size:13px">${esc(r.courses?.name||"")}</b>
            <div class="small">المرحلة ${r.stage}${r.stage_title?` — ${esc(r.stage_title)}`:""} · ترتيب ${r.order_index}${r.is_optional?" · اختياري":""}${r.prereq_note?` · ${esc(r.prereq_note)}`:""}</div></div>
          <button class="btn danger" data-tcdel="${r.id}">إزالة</button>
        </div>`).join("") || `<div class="small">لا توجد كورسات في هذا المسار بعد.</div>`}
      <h3 style="margin-top:18px">إضافة كورس</h3>
      ${free.length ? `
      <label>الكورس</label><select id="tcCourse">${free.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      <label>رقم المرحلة (1 تُدرس أولًا، ثم 2…)</label><input id="tcStage" type="number" min="1" value="1">
      <label>اسم المرحلة (اختياري)</label><input id="tcStageTitle">
      <label>الترتيب داخل المرحلة (إن كان فيها أكثر من كورس)</label><input id="tcOrder" type="number" value="0">
      <label>ملاحظة الشرط المسبق (اختياري، تنبيه فقط بلا قفل)</label><input id="tcNote">
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="tcOpt"> كورس اختياري</label>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end"><button class="btn" id="tcClose">إغلاق</button><button class="btn dark" id="tcAdd">إضافة</button></div>`
      : `<div class="small">كل الكورسات مضافة للمسار.</div><div style="margin-top:14px;text-align:end"><button class="btn" id="tcClose">إغلاق</button></div>`}
      <div id="tcMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>`;
    box.querySelector("#tcClose").onclick = ()=>{ m.close(); Admin.go("tracks"); };
    box.querySelectorAll("[data-tcdel]").forEach(b=>b.onclick=async ()=>{
      if(!confirm("إزالة الكورس من المسار؟ (الكورس نفسه لا يُحذف)")) return;
      try{ await db.from("track_courses").delete().eq("id", b.dataset.tcdel).throwOnError(); draw(); }
      catch(e){ CodeUp.toast(e.message,"error"); }
    });
    const add = box.querySelector("#tcAdd");
    if(add) add.onclick = async ()=>{
      const v = id=>box.querySelector(id).value.trim();
      try{
        await db.from("track_courses").insert({
          track_id: track.id, course_id: v("#tcCourse"), stage: Math.max(1, Number(v("#tcStage"))||1),
          stage_title: v("#tcStageTitle")||null, order_index: Number(v("#tcOrder"))||0,
          is_optional: box.querySelector("#tcOpt").checked, prereq_note: v("#tcNote")||null
        }).throwOnError();
        draw();
      }catch(e){ const mm=box.querySelector("#tcMsg"); mm.style.display="block"; mm.textContent=e.message; }
    };
  };
  draw();
}
