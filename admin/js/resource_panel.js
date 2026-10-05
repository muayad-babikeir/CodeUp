// admin/js/resource_panel.js — لوحة مصادر التعلّم المشتركة (دروس الكورسات + مواد University).
// أربعة أقسام تطابق صفحة الدرس/المادة عند الطالب: المصدر الأساسي، مصادر بديلة، تعمّق، للمذاكرة.
// كل صفحة تمرّر "adapter" يربط اللوحة بجدولها (lesson_resources أو university_materials).
//
// adapter = {
//   pageName: "الدرس" | "المادة",
//   types: {key: label}, defaultType, hasStart,
//   studyHelp: نص قسم «للمذاكرة»,
//   setupHint: رسالة لو فشل التحميل,
//   load(): Promise<rows>   rows = [{id, role, order_index, title, url, type, publisher, language, duration_minutes, start_at, reports}]
//   create(payload, role, orderIndex), update(row, payload, role, newOrderIndexOrNull),
//   remove(row), setOrder(row, idx), demoteRecommended(exceptRowId|null)
//   fileCtx (اختياري): {kind:"lesson"|"subject", id} — يفعّل خيار «رفع ملف» (يُرسل إلى تيليجرام عبر telegram-upload-resource ويُحذف من Storage)
// }

const RP_ROLE_LABEL = {recommended:"المصدر الأساسي", alternative:"مصدر بديل", deep_dive:"تعمّق", study:"للمذاكرة"};
const RP_ROLE_RANK = {recommended:0, alternative:1, deep_dive:2, study:3};
const RP_LANG_LABEL = {ar:"عربي", en:"English", other:"أخرى"};

async function renderResourcePanel(box, ad){
  const esc = CodeUp.escapeHtml;
  box.innerHTML = `<div class="small" style="margin-top:14px">جارِ تحميل المصادر…</div>`;
  let rows;
  try{ rows = await ad.load(); }
  catch(e){
    box.innerHTML = `<div class="small" style="margin-top:14px;color:#F2555F">تعذّر تحميل المصادر — ${esc(ad.setupHint||"")} (${esc(e.message||"")})</div>`;
    return;
  }
  rows.sort((a,b)=>((RP_ROLE_RANK[a.role]??1)-(RP_ROLE_RANK[b.role]??1)) || ((a.order_index||0)-(b.order_index||0)));

  const meta = x=>[ad.types[x.type], x.publisher, RP_LANG_LABEL[x.language], x.duration_minutes?`${x.duration_minutes} د`:""].filter(Boolean).join(" · ");
  const group = role=>rows.filter(x=>x.role===role);
  const ROLE_HELP = {
    recommended:"أفضل مصدر واحد يبدأ به الطالب (بطاقة كبيرة بنجمة). إضافة مصدر جديد هنا تحوّل الحالي إلى «بديل».",
    alternative:"شروحات أخرى بأسلوب مختلف. يظهر أول اثنين، والباقي خلف «عرض مصدر إضافي».",
    deep_dive:"للمتقدمين ومن يريد التوسّع. يظهر في قسم «تعمّق» القابل للطي.",
    study: ad.studyHelp || "ملخصات وبطاقات للمراجعة."
  };
  const sectionHtml = role=>{
    const g = group(role);
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0"><b style="font-size:13.5px">${RP_ROLE_LABEL[role]}</b><div class="small">${ROLE_HELP[role]}</div></div>
        <button class="btn dark" data-addrole="${role}" style="flex:none">${role==="recommended"&&g.length?"+ استبدال":"+ إضافة"}</button>
      </div>
      ${g.map((x,i)=>`
        <div style="display:flex;gap:6px;align-items:center;padding:8px 0;border-top:1px solid var(--line);margin-top:8px">
          <div style="flex:1;min-width:0"><b style="font-size:13px">${esc(x.title||"")}</b>
            <div class="small">${esc(meta(x))}${x.reports?` · <span style="color:#F2555F">بلاغات: ${x.reports}</span>`:""}</div></div>
          <button class="btn" data-rup="${x.id}" ${i===0?"disabled":""} aria-label="تحريك للأعلى">↑</button>
          <button class="btn" data-rdown="${x.id}" ${i===g.length-1?"disabled":""} aria-label="تحريك للأسفل">↓</button>
          <button class="btn" data-redit="${x.id}">تعديل</button>
          <button class="btn danger" data-rdel="${x.id}">إزالة</button>
        </div>`).join("") || `<div class="small" style="margin-top:8px;opacity:.7">لا شيء هنا بعد.</div>`}
    </div>`;
  };
  box.innerHTML = `
    <label style="margin-top:14px;display:block">مصادر التعلّم</label>
    <div class="small">كل قسم أدناه يقابل قسمًا في صفحة ${ad.pageName} عند الطالب. اضغط «+ إضافة» في القسم الذي تريده.</div>
    ${["recommended","alternative","deep_dive","study"].map(sectionHtml).join("")}`;

  const byId = Object.fromEntries(rows.map(x=>[x.id,x]));
  const reload = ()=>renderResourcePanel(box, ad);
  // ترتيب: نبدّل مكان العنصر مع جاره داخل نفس القسم ثم نعيد ترقيم القسم كاملًا (0..n)
  const move = async (id, dir)=>{
    const x = byId[id]; const g = group(x.role); const i = g.findIndex(y=>y.id===id); const j = i+dir;
    if(j<0 || j>=g.length) return;
    [g[i], g[j]] = [g[j], g[i]];
    try{ await Promise.all(g.map((y,k)=>ad.setOrder(y, k))); reload(); }
    catch(e){ CodeUp.toast(e.message,"error"); }
  };
  box.querySelectorAll("[data-rup]").forEach(b=>b.onclick=()=>move(b.dataset.rup,-1));
  box.querySelectorAll("[data-rdown]").forEach(b=>b.onclick=()=>move(b.dataset.rdown,1));
  box.querySelectorAll("[data-rdel]").forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm("إزالة هذا المصدر؟")) return;
      try{ await ad.remove(byId[b.dataset.rdel]); Admin.kickTelegramCleanup(); reload(); }
      catch(e){ CodeUp.toast(e.message,"error"); }
    };
  });
  box.querySelectorAll("[data-redit]").forEach(b=>b.onclick=()=>openResourceModal(byId[b.dataset.redit]));
  box.querySelectorAll("[data-addrole]").forEach(b=>b.onclick=async ()=>{ if(ad.beforeAdd){ const go = await ad.beforeAdd(b.dataset.addrole); if(go===false) return; } openResourceModal(null, b.dataset.addrole); });

  // نافذة إضافة/تعديل مصدر (نفس النموذج للحالتين)
  function openResourceModal(row, presetRole){
    const edit = !!row;
    const opt = (map, cur)=>Object.keys(map).map(k=>`<option value="${k}" ${k===cur?"selected":""}>${map[k]}</option>`).join("");
    const m2 = Admin.modal(`
      <h3>${edit?"تعديل المصدر":"مصدر تعلّم جديد"}</h3>
      <label>القسم في صفحة ${ad.pageName}</label><select id="rRole">${opt(RP_ROLE_LABEL, row?.role||presetRole||"alternative")}</select>
      <label>النوع</label><select id="rType">${opt(ad.types, row?.type||ad.defaultType)}</select>
      <label>العنوان</label><input id="rTitle" value="${esc(row?.title||"")}">
      ${ad.fileCtx?`<label>طريقة الإضافة</label><select id="rMode"><option value="link">رابط</option><option value="file">رفع ملف (يُرسل إلى تيليجرام)</option>${!row?`<option value="import">استيراد من تيليجرام (نسخ من مجموعة مصدر)</option>`:""}</select>`:""}
      <div id="rLinkBox"><label>الرابط</label><input id="rUrl" dir="ltr" placeholder="https://..." value="${esc(row?.url||"")}"></div>
      <div id="rFileBox" style="display:none"><label>الملف</label><input id="rFile" type="file">
        ${ad.fileCtx?.kind==="subject"?`<label>القسم داخل تيليجرام (اختياري)</label><input id="rSection" placeholder="مثال: Functions — يُرقَّم تلقائيًا E01, E02… داخل كل قسم (الافتراضي: عنوان المصدر)">`:""}
        <div class="small" style="margin-top:6px">يُرسل تلقائيًا إلى تيليجرام ثم يُحذف من تخزين الموقع، ويُحفظ رابط رسالته كرابط للمصدر. لمواد الجامعة بمجموعة سنة: يُرسل كفاصل ثم «القسم | رقم» ثم الملف (فيديو/صورة/ملف) ويتحدّث الفهرس المثبّت تلقائيًا. الحد الأقصى 50MB.</div></div>
      <label>الناشر / القناة (اختياري)</label><input id="rPub" value="${esc(row?.publisher||"")}">
      <label>اللغة</label><select id="rLang">${opt(RP_LANG_LABEL, row?.language||"ar")}</select>
      <label>المدة بالدقائق (اختياري)</label><input id="rDur" type="number" min="1" max="1000" value="${row?.duration_minutes??""}">
      ${ad.hasStart?`<label>بداية الفيديو بالثواني (اختياري، ليوتيوب)</label><input id="rStart" type="number" min="0" value="${row?.start_at??""}">`:""}
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button class="btn" id="rCancel">إلغاء</button><button class="btn dark" id="rSave">حفظ</button></div>
      <div id="rMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>`);
    m2.el.querySelector("#rCancel").onclick = m2.close;
    const modeSel = m2.el.querySelector("#rMode");
    const isFileMode = ()=>!!modeSel && modeSel.value==="file";
    if(modeSel) modeSel.onchange = ()=>{
      if(modeSel.value==="import"){ m2.close(); openImportModal(ad.fileCtx.kind==="lesson" ? {lesson_id: ad.fileCtx.id} : {subject_id: ad.fileCtx.id}, reload); return; }
      m2.el.querySelector("#rLinkBox").style.display = isFileMode() ? "none" : "";
      m2.el.querySelector("#rFileBox").style.display = isFileMode() ? "" : "none";
      const tSel = m2.el.querySelector("#rType");
      if(isFileMode() && tSel.querySelector('option[value="pdf"]')) tSel.value = "pdf"; // الغالب أن الملف PDF، ويمكن تغييره
    };
    // رفع مؤقت إلى Storage ثم نقل إلى تيليجرام (الدالة تحذف المؤقت). يرجع رابط رسالة تيليجرام.
    const uploadToTelegram = async (file, meta)=>{
      const { data: sd } = await db.auth.getSession();
      const token = sd?.session?.access_token, uid = sd?.session?.user?.id;
      if(!token || !uid) throw new Error("انتهت الجلسة، أعد تسجيل الدخول");
      const clean = (file.name.replace(/[^\w.\-]+/g,"_") || "file");
      const path = `${uid}/resource-uploads/${Date.now()}_${clean}`;
      const up = await db.storage.from("submissions").upload(path, file, {upsert:false});
      if(up.error) throw new Error("تعذّر رفع الملف: " + up.error.message);
      const call = body=>fetch(`${SUPABASE_URL}/functions/v1/telegram-upload-resource`, {
        method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`}, body: JSON.stringify(body)
      }).then(r=>r.json().catch(()=>({error:"رد غير صالح من الخادم"})));
      let j;
      try{ j = await call({action:"send", storage_path:path, file_name:file.name, mime_type:file.type, ...meta}); }
      catch(e){ j = {error:e.message}; }
      if(!j.ok){
        try{ await call({action:"discard", storage_path:path}); }catch(_){}  // لا نترك نسخة في التخزين عند الفشل
        throw new Error("تعذّر الإرسال إلى تيليجرام: " + (j.error||"خطأ غير معروف") + " — لم يُحفظ شيء، حاول مرة أخرى.");
      }
      return j.url;
    };
    m2.el.querySelector("#rSave").onclick = async ()=>{
      const g = id=>m2.el.querySelector(id).value.trim();
      const msg = m2.el.querySelector("#rMsg");
      const fail = t=>{ msg.style.display="block"; msg.textContent=t; };
      const saveBtn = m2.el.querySelector("#rSave");
      msg.style.display="none";
      if(!g("#rTitle")) return fail("العنوان إلزامي");
      const fileMode = isFileMode();
      const pickedFile = fileMode ? m2.el.querySelector("#rFile").files[0] : null;
      if(fileMode){
        if(!pickedFile) return fail("اختر ملفًا للرفع");
        if(pickedFile.size > 50*1024*1024) return fail("حجم الملف أكبر من 50MB (حد تيليجرام). استخدم رابطًا بدلًا منه.");
      }else if(!/^https?:\/\//i.test(g("#rUrl"))) return fail("الرابط يجب أن يبدأ بـ https://");
      const dur = g("#rDur") ? Number(g("#rDur")) : null;
      if(dur!==null && !(dur>=1 && dur<=1000)) return fail("المدة بين 1 و1000 دقيقة");
      let finalUrl = fileMode ? "" : g("#rUrl");
      if(fileMode){
        saveBtn.disabled = true; const oldLabel = saveBtn.textContent; saveBtn.textContent = "جارِ الرفع إلى تيليجرام…";
        try{
          finalUrl = await uploadToTelegram(pickedFile, {kind: ad.fileCtx.kind, ref_id: ad.fileCtx.id, role: g("#rRole"), title: g("#rTitle"), publisher: g("#rPub"), language: RP_LANG_LABEL[g("#rLang")]||"", section: m2.el.querySelector("#rSection")?.value.trim()||""});
        }catch(e){ saveBtn.disabled = false; saveBtn.textContent = oldLabel; return fail(e.message); }
        saveBtn.disabled = false; saveBtn.textContent = oldLabel;
      }
      const payload = {
        type: g("#rType"), title: g("#rTitle"), url: finalUrl, publisher: g("#rPub")||null,
        language: g("#rLang"), duration_minutes: dur,
        start_at: ad.hasStart && g("#rStart") ? Number(g("#rStart")) : null
      };
      const role = g("#rRole");
      try{
        if(edit){
          if(role==="recommended") await ad.demoteRecommended(row.id);
          await ad.update(row, payload, role, role!==row.role ? rows.filter(y=>y.role===role).length : null);
        }else{
          if(role==="recommended") await ad.demoteRecommended(null);
          await ad.create(payload, role, rows.filter(y=>y.role===role).length);
        }
        CodeUp.toast(edit?"تم حفظ التعديل":"تمت إضافة المصدر","success"); if(edit) Admin.kickTelegramCleanup(); m2.close(); reload();
      }catch(e){ fail(e.message); }
    };
  }
}


// ======================= استيراد من تيليجرام (مواد الجامعة) =======================
// الفكرة: الصق رابط الرسالة الأولى (والأخيرة اختياريًا) من مجموعة مصدر، فينسخها الخادم إلى موضوع المادة بنفس الترتيب
// (فاصل ← "القسم | رقم" ← الملف) ويُنشئ لكل رسالة مصدرًا مستقلًا. عند خطأ مؤقت يتوقف عند العنصر ويُستكمل من نفس المكان.
async function importEdge(action, body){
  const { data } = await db.auth.getSession();
  const token = data?.session?.access_token;
  if(!token) throw new Error("انتهت الجلسة، أعد تسجيل الدخول");
  const r = await fetch(`${SUPABASE_URL}/functions/v1/telegram-import`, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`}, body: JSON.stringify({action, ...body}) });
  const j = await r.json().catch(()=>({error:"رد غير صالح من الخادم"}));
  return { ok: r.ok, status: r.status, ...j };
}

async function openImportModal(target, onDone){
  const isLesson = !!target.lesson_id;
  const esc = CodeUp.escapeHtml;
  const m = Admin.modal(`<h3>استيراد من تيليجرام</h3><div id="impBody"><div class="small">جارِ التحميل…</div></div>`);
  const box = m.el.querySelector("#impBody");
  let pollTimer = null, closed = false;
  const origClose = m.close;
  m.close = ()=>{ closed = true; if(pollTimer) clearInterval(pollTimer); origClose(); };

  // عملية غير مكتملة لنفس المادة؟ نعرض تقدّمها بدل النموذج
  const { data: openJobs } = await db.from("telegram_import_jobs").select("*").eq(isLesson ? "lesson_id" : "subject_id", isLesson ? target.lesson_id : target.subject_id).in("status", ["pending","running","paused"]).order("created_at",{ascending:false}).limit(1);
  if(openJobs && openJobs.length) return showProgress(openJobs[0].id);
  showForm();

  function showForm(){
    box.innerHTML = `
      <p class="small" style="margin:0 0 10px">يعرف CodeUp الوجهة من ${isLesson?"الدرس":"المادة"} الحالي${isLesson?"":"ة"}. الصق رابط رسالة (أو رابطين لنطاق) من مجموعة مصدر يكون البوت عضوًا فيها. تُنسخ الرسائل بالترتيب ولا تُحذف من المصدر.</p>
      <label>رابط الرسالة الأولى</label><input id="impFrom" dir="ltr" placeholder="https://t.me/c/1234567890/123">
      <label>رابط الرسالة الأخيرة (اختياري — لاستيراد نطاق)</label><input id="impTo" dir="ltr" placeholder="https://t.me/c/1234567890/140">
      <label>القسم داخل تيليجرام (اختياري — يُرقَّم تلقائيًا E01, E02…)</label><input id="impSection" placeholder="افتراضيًا: اسم ${isLesson?"الدرس":"المادة"}">
      <label>قسم المصدر</label>
      <select id="impRole"><option value="alternative">مصدر بديل</option><option value="deep_dive">تعمّق</option><option value="study">للمذاكرة</option></select>
      <label>اللغة</label>
      <select id="impLang"><option value="">—</option><option value="ar">العربية</option><option value="en">English</option><option value="other">أخرى</option></select>
      <div id="impMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
      <div id="impAnalysis"></div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="btn" id="impCancel">إغلاق</button><button class="btn dark" id="impAnalyze">تحليل</button>
      </div>`;
    box.querySelector("#impCancel").onclick = m.close;
    box.querySelector("#impAnalyze").onclick = analyzeNow;
  }
  const formVals = ()=>({
    ...target,
    from_url: box.querySelector("#impFrom").value.trim(),
    to_url: box.querySelector("#impTo").value.trim() || undefined,
    section: box.querySelector("#impSection").value.trim(),
    role: box.querySelector("#impRole").value,
    language: box.querySelector("#impLang").value || undefined,
  });
  async function analyzeNow(){
    const msg = box.querySelector("#impMsg"), out = box.querySelector("#impAnalysis"), btn = box.querySelector("#impAnalyze");
    msg.style.display = "none"; out.innerHTML = "";
    const v = formVals();
    if(!v.from_url){ msg.style.display="block"; msg.textContent="أدخل رابط الرسالة الأولى"; return; }
    btn.disabled = true; btn.textContent = "جارِ الفحص…";
    let r;
    try{ r = await importEdge("analyze", v); }catch(e){ r = {ok:false, error:e.message}; }
    btn.disabled = false; btn.textContent = "تحليل";
    if(!r.ok){ msg.style.display="block"; msg.textContent = r.error || "تعذّر التحليل"; return; }
    const checks = (r.checks||[]).map(c=>`<div style="margin:3px 0">${c.ok?"✅":"❌"} ${esc(c.label)}</div>`).join("");
    const blockers = (r.blockers||[]).map(b=>`<div style="margin:3px 0;color:#F2555F">⚠️ ${esc(b)}</div>`).join("");
    out.innerHTML = `
      <div class="card" style="margin-top:12px;padding:12px">
        <div><b>المصدر:</b> ${esc(r.source.title)} <span class="small">(${esc(r.source.type)})</span></div>
        <div><b>الرسائل:</b> ${r.range.from} → ${r.range.to} (${r.range.count} رقم)</div>
        <div><b>الوجهة:</b> ${esc(r.destination.path)}<div class="small">مجموعة: ${esc(r.destination.group||"—")} · ${r.destination.topic_exists?"الموضوع موجود":"يُنشأ الموضوع عند البدء"}</div></div>
        <div style="margin-top:8px">${checks}${blockers}</div>
        <div class="small" style="margin-top:8px">لن يظهر نوع/حجم الرسائل القديمة قبل النسخ (قيد في Bot API). الرسائل التي لا تُنسخ (خدمة/محذوفة) تُتخطى تلقائيًا.</div>
        ${r.already_imported>0?`<label style="display:flex;gap:8px;align-items:center;margin-top:10px;color:#F0B429"><input type="checkbox" id="impForce" style="width:auto"> ${r.already_imported} رسالة مستوردة بالفعل في هذه المادة. أعد استيرادها (تُنشأ نسخ جديدة)</label>`:""}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn dark" id="impStart" ${r.ok?"":"disabled"}>بدء الاستيراد (${r.range.count} رقم)</button></div>`;
    const startBtn = out.querySelector("#impStart");
    if(startBtn) startBtn.onclick = async ()=>{
      const force = !!out.querySelector("#impForce")?.checked;
      if(r.already_imported>0 && !force){ msg.style.display="block"; msg.textContent="هذه الرسائل مستوردة بالفعل. فعّل خيار إعادة الاستيراد أو غيّر النطاق."; return; }
      startBtn.disabled = true; startBtn.textContent = "جارِ البدء…";
      let s;
      try{ s = await importEdge("start", {...v, force}); }catch(e){ s = {ok:false, error:e.message}; }
      if(!s.ok){ startBtn.disabled=false; startBtn.textContent=`بدء الاستيراد (${r.range.count} رقم)`; msg.style.display="block"; msg.textContent = s.error==="already_imported" ? "هذه الرسائل مستوردة بالفعل." : (s.error||"تعذّر البدء"); return; }
      showProgress(s.job_id);
    };
  }

  // ---- التقدّم: نقرأ صف العملية كل ثانيتين؛ ونُبقي استدعاء run متسلسلًا ما دامت الصفحة مفتوحة (cron شبكة أمان) ----
  async function showProgress(jobId){
    let running = false;
    const drive = async (action)=>{
      if(running || closed) return; running = true;
      try{ await importEdge(action, {job_id: jobId}); }catch(_){} finally{ running = false; }
    };
    const render = (job)=>{
      const total = job.to_message_id - job.from_message_id + 1;
      const done = Math.min(total, job.cursor_message_id - job.from_message_id);
      const pct = total ? Math.round(done/total*100) : 0;
      const label = {pending:"في الانتظار", running:"جارٍ النسخ…", paused:"متوقّف عند خطأ", done:"اكتمل", cancelled:"أُلغي"}[job.status] || job.status;
      box.innerHTML = `
        <div><b>${esc(label)}</b></div>
        <div style="height:8px;background:var(--line);border-radius:6px;margin:10px 0;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--lime,#00BA7C)"></div></div>
        <div class="small">تمت معالجة ${done} من ${total} · منسوخ ${job.copied} · متخطّى ${job.skipped}${job.status==="paused"?` · توقّف عند الرسالة ${job.cursor_message_id}`:""}</div>
        ${job.last_error?`<div style="margin-top:10px;color:${job.status==="done"?"#F0B429":"#F2555F"}">${esc(job.last_error)}</div>`:""}
        <div class="small" style="margin-top:8px">يمكنك إغلاق هذه النافذة؛ تستمر العملية في الخلفية وتعود إليها من «استيراد من تيليجرام».</div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
          ${job.status==="paused"?`<button class="btn dark" id="impResume">استكمال</button>`:""}
          ${["pending","running","paused"].includes(job.status)?`<button class="btn danger" id="impStop">إلغاء</button>`:""}
          <button class="btn" id="impClose">إغلاق</button>
        </div>`;
      box.querySelector("#impClose").onclick = ()=>{ m.close(); if(typeof onDone==="function") onDone(); };
      const rs = box.querySelector("#impResume"); if(rs) rs.onclick = ()=>{ rs.disabled = true; drive("resume"); };
      const st = box.querySelector("#impStop"); if(st) st.onclick = async ()=>{
        if(!await Admin.confirmDialog({title:"إلغاء الاستيراد", message:"يتوقف النسخ هنا. ما نُسخ يبقى في الأرشيف وفي مصادر المادة.", confirmLabel:"إلغاء الاستيراد", danger:true})) return;
        await importEdge("cancel", {job_id: jobId});
      };
    };
    let lastStatus = null;
    const tick = async ()=>{
      if(!document.body.contains(box)){ closed = true; if(pollTimer){ clearInterval(pollTimer); pollTimer = null; } return; }  // أُغلقت النافذة (حتى بالنقر خارجها)
      if(closed) return;
      const { data: job } = await db.from("telegram_import_jobs").select("*").eq("id", jobId).maybeSingle();
      if(!job) return;
      render(job);
      if(job.status==="pending") drive("run");            // يستكمل الدفعة التالية ما دامت الصفحة مفتوحة
      if(job.status==="done" && lastStatus!=="done"){ CodeUp.toast("اكتمل الاستيراد","success"); if(typeof onDone==="function") onDone(); }
      lastStatus = job.status;
      if(["done","cancelled"].includes(job.status) && pollTimer){ clearInterval(pollTimer); pollTimer = null; }
    };
    await tick();
    drive("run");
    pollTimer = setInterval(tick, 2000);
  }
}
