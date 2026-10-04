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
      try{ await ad.remove(byId[b.dataset.rdel]); reload(); }
      catch(e){ CodeUp.toast(e.message,"error"); }
    };
  });
  box.querySelectorAll("[data-redit]").forEach(b=>b.onclick=()=>openResourceModal(byId[b.dataset.redit]));
  box.querySelectorAll("[data-addrole]").forEach(b=>b.onclick=()=>openResourceModal(null, b.dataset.addrole));

  // نافذة إضافة/تعديل مصدر (نفس النموذج للحالتين)
  function openResourceModal(row, presetRole){
    const edit = !!row;
    const opt = (map, cur)=>Object.keys(map).map(k=>`<option value="${k}" ${k===cur?"selected":""}>${map[k]}</option>`).join("");
    const m2 = Admin.modal(`
      <h3>${edit?"تعديل المصدر":"مصدر تعلّم جديد"}</h3>
      <label>القسم في صفحة ${ad.pageName}</label><select id="rRole">${opt(RP_ROLE_LABEL, row?.role||presetRole||"alternative")}</select>
      <label>النوع</label><select id="rType">${opt(ad.types, row?.type||ad.defaultType)}</select>
      <label>العنوان</label><input id="rTitle" value="${esc(row?.title||"")}">
      ${ad.fileCtx?`<label>طريقة الإضافة</label><select id="rMode"><option value="link">رابط</option><option value="file">رفع ملف (يُرسل إلى تيليجرام)</option></select>`:""}
      <div id="rLinkBox"><label>الرابط</label><input id="rUrl" dir="ltr" placeholder="https://..." value="${esc(row?.url||"")}"></div>
      <div id="rFileBox" style="display:none"><label>الملف</label><input id="rFile" type="file">
        <div class="small" style="margin-top:6px">يُرسل تلقائيًا إلى موضوع MATERIALS في مجموعة CodeUp Archive بوسوم (الكورس/الوحدة/الدرس/القسم) ثم يُحذف من تخزين الموقع، ويُحفظ رابط الرسالة كرابط للمصدر. الحد الأقصى 50MB.</div></div>
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
          finalUrl = await uploadToTelegram(pickedFile, {kind: ad.fileCtx.kind, ref_id: ad.fileCtx.id, role: g("#rRole"), title: g("#rTitle"), publisher: g("#rPub"), language: RP_LANG_LABEL[g("#rLang")]||""});
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
        CodeUp.toast(edit?"تم حفظ التعديل":"تمت إضافة المصدر","success"); m2.close(); reload();
      }catch(e){ fail(e.message); }
    };
  }
}
