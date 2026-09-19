// admin/js/courses.js

Admin.sections.courses = {
  label: "الكورسات",
  async render(body){
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w80" style="height:44px;margin-bottom:10px"></div>`).join("")}</div>`;

    const [{ data: courses, error }, { data: unitsRows }, { data: enrollRows }] = await Promise.all([
      db.from("courses").select("*").order("created_at",{ascending:false}),
      db.from("units").select("course_id, lessons(id)"),
      db.from("enrollments").select("course_id")
    ]);
    if(error){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل الكورسات.</span><button class="btn alertRetry" id="crsRetry">إعادة المحاولة</button></div>`; body.querySelector("#crsRetry").onclick=()=>Admin.go("courses"); return; }

    const lessonCount = {};
    (unitsRows||[]).forEach(u=>{ lessonCount[u.course_id] = (lessonCount[u.course_id]||0) + (u.lessons||[]).length; });
    const studentCount = {};
    (enrollRows||[]).forEach(e=>{ studentCount[e.course_id] = (studentCount[e.course_id]||0) + 1; });

    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="newCourseBtn">+ كورس جديد</button></div>
      <div class="card"><div class="tableScroll"><table>
        <thead><tr><th>الكورس</th><th>الدروس</th><th>الطلاب</th><th>الحالة</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
        <tbody>${(courses||[]).map(c=>`
          <tr>
            <td>
              <b>${CodeUp.escapeHtml(c.name)}</b>
              ${c.description?`<div class="small" style="margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${CodeUp.escapeHtml(c.description)}</div>`:""}
            </td>
            <td>${lessonCount[c.id]||0}</td>
            <td>${studentCount[c.id]||0}</td>
            <td><span class="pill ${c.status==='published'?'approved':c.status==='draft'?'pending':'rejected'}">${courseStatusLabel(c.status)}</span></td>
            <td class="small">${CodeUp.formatDate(c.created_at)}</td>
            <td>
              <button class="btn" data-content="${c.id}">إدارة المحتوى</button>
              <button class="btn" data-edit="${c.id}">تعديل</button>
            </td>
          </tr>`).join("") || `<tr><td colspan="6"><div class="emptyStatePro"><h4>لا توجد كورسات بعد</h4><p>أنشئ أول كورس لتبدأ ببناء تجربة CodeUp التعليمية.</p><button class="btn dark" id="emptyNewCourseBtn">+ كورس جديد</button></div></td></tr>`}
        </tbody></table></div></div>`;

    const wireNew = (btn)=>{ if(btn) btn.onclick = ()=> openCourseModal(); };
    wireNew(body.querySelector("#newCourseBtn"));
    wireNew(body.querySelector("#emptyNewCourseBtn"));
    body.querySelectorAll("[data-edit]").forEach(b=>{
      b.onclick = ()=> openCourseModal(courses.find(c=>c.id===b.dataset.edit));
    });
    body.querySelectorAll("[data-content]").forEach(b=>{
      b.onclick = async ()=>{
        Admin.currentCourseId = b.dataset.content;
        await Admin.renderNav();
        Admin.go("content");
      };
    });
  }
};

function courseStatusLabel(s){ return {published:"منشور",draft:"مسودة",archived:"مؤرشف"}[s]||s; }
function enrollmentStatusLabel(s){ return {on_track:"على المسار",at_risk:"في خطر",behind:"متأخر",inactive:"غير نشط"}[s]||s; }

function openCourseModal(course){
  const isEdit = !!course;
  const m = Admin.modal(`
    <h3>${isEdit?"تعديل الكورس":"كورس جديد"}</h3>
    <label>الاسم</label><input id="cName" value="${course?CodeUp.escapeHtml(course.name):""}">
    <label>الرابط (slug)</label><input id="cSlug" value="${course?CodeUp.escapeHtml(course.slug):""}" placeholder="cpp-2026">
    <label>الوصف</label><textarea id="cDesc" rows="3">${course?CodeUp.escapeHtml(course.description||""):""}</textarea>
    <label>الحالة</label>
    <select id="cStatus">
      <option value="draft" ${course?.status==='draft'?'selected':''}>مسودة</option>
      <option value="published" ${!course||course.status==='published'?'selected':''}>منشور</option>
      <option value="archived" ${course?.status==='archived'?'selected':''}>مؤرشف</option>
    </select>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" id="cCancel">إلغاء</button>
      <button class="btn dark" id="cSave">حفظ</button>
    </div>
    <div id="cMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
  `);
  m.el.querySelector("#cCancel").onclick = m.close;
  m.el.querySelector("#cSave").onclick = async ()=>{
    const msgEl = m.el.querySelector("#cMsg");
    const payload = {
      name: m.el.querySelector("#cName").value.trim(),
      slug: m.el.querySelector("#cSlug").value.trim(),
      description: m.el.querySelector("#cDesc").value.trim(),
      status: m.el.querySelector("#cStatus").value
    };
    if(!payload.name || !payload.slug){ msgEl.style.display="block"; msgEl.textContent="الاسم والرابط إلزاميان"; return; }
    try{
      if(isEdit) await db.from("courses").update(payload).eq("id", course.id).throwOnError();
      else await db.from("courses").insert({...payload, created_by: Admin.ctx.user.id, is_active:true}).throwOnError();
      CodeUp.toast("تم الحفظ", "success"); m.close(); Admin.go("courses");
    }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message; }
  };
}

Admin.sections.course_admins = {
  label: "أدمن الكورسات",
  async render(body){
    const [{data: admins}, {data: profiles}] = await Promise.all([
      db.from("course_admins").select("*, courses(name), profiles(full_name,email)").order("created_at",{ascending:false}),
      db.from("profiles").select("id, full_name, email").order("full_name")
    ]);
    body.innerHTML = `
      <div class="toolbar"><button class="btn dark" id="assignBtn">+ تعيين أدمن كورس</button></div>
      <div class="card"><table><thead><tr><th>المستخدم</th><th>الكورس</th><th>الدور</th><th></th></tr></thead>
      <tbody>${(admins||[]).map(a=>`
        <tr>
          <td>${CodeUp.escapeHtml(a.profiles?.full_name||a.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(a.courses?.name||"")}</td>
          <td><span class="pill ${a.role}">${a.role==='owner'?'مالك':'أدمن'}</span></td>
          <td><button class="btn danger" data-remove="${a.id}">إزالة</button></td>
        </tr>`).join("") || `<tr><td colspan="4" class="emptyState">لا يوجد أدمن كورسات بعد.</td></tr>`}
      </tbody></table></div>`;

    body.querySelector("#assignBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3>تعيين أدمن كورس</h3>
        <label>الكورس</label>
        <select id="acCourse">${Admin.courses.map(c=>`<option value="${c.id}">${CodeUp.escapeHtml(c.name)}</option>`).join("")}</select>
        <label>المستخدم</label>
        <select id="acUser">${(profiles||[]).map(p=>`<option value="${p.id}">${CodeUp.escapeHtml(p.full_name||p.email)}</option>`).join("")}</select>
        <label>الدور</label>
        <select id="acRole"><option value="admin">أدمن</option><option value="owner">مالك</option></select>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="acCancel">إلغاء</button><button class="btn dark" id="acSave">تعيين</button>
        </div><div id="acMsg" class="emptyState" style="display:none;padding:8px;color:#F2555F"></div>
      `);
      m.el.querySelector("#acCancel").onclick = m.close;
      m.el.querySelector("#acSave").onclick = async ()=>{
        const msgEl = m.el.querySelector("#acMsg");
        try{
          await db.from("course_admins").insert({
            course_id: m.el.querySelector("#acCourse").value,
            profile_id: m.el.querySelector("#acUser").value,
            role: m.el.querySelector("#acRole").value
          }).throwOnError();
          CodeUp.toast("تم التعيين", "success"); m.close(); Admin.go("course_admins");
        }catch(e){ msgEl.style.display="block"; msgEl.textContent = e.message.includes("duplicate")?"هذا المستخدم أدمن على هذا الكورس بالفعل":e.message; }
      };
    };

    body.querySelectorAll("[data-remove]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("تأكيد إزالة صلاحية الإدارة؟")) return;
        const { error } = await db.from("course_admins").delete().eq("id", b.dataset.remove);
        if(error){ CodeUp.toast(error.message, "error"); return; }
        Admin.go("course_admins");
      };
    });
  }
};

Admin.sections.settings = {
  label: "إعدادات الكورس",
  async render(body){
    if(!Admin.currentCourseId){ body.innerHTML = `<div class="emptyStatePro"><h4>لا يوجد كورس محدد</h4><p>اختر كورسًا من القائمة الجانبية أولًا.</p></div>`; return; }
    body.innerHTML = `<div class="card">${Array(3).fill(`<div class="skeleton skeleton-line w60" style="height:30px;margin-bottom:12px"></div>`).join("")}</div>`;
    const { data: course, error } = await db.from("courses").select("*").eq("id", Admin.currentCourseId).single();
    if(error || !course){ body.innerHTML = `<div class="alertBox error"><span>تعذّر تحميل إعدادات الكورس.</span><button class="btn alertRetry" id="setRetry">إعادة المحاولة</button></div>`; body.querySelector("#setRetry").onclick=()=>Admin.go("settings"); return; }
    body.innerHTML = `
      <div class="card">
        <label>الاسم</label><input id="sName" value="${CodeUp.escapeHtml(course.name)}">
        <label>الوصف</label><textarea id="sDesc" rows="4">${CodeUp.escapeHtml(course.description||"")}</textarea>
        <label>الرابط (slug) — يُستخدم لمشاركة رابط مباشر للكورس، مثل codeup.app/#/course/${CodeUp.escapeHtml(course.slug||"...")}
        </label><input id="sSlug" value="${CodeUp.escapeHtml(course.slug||"")}" placeholder="cpp-2026">
        <label>الحالة</label>
        <select id="sStatus">
          <option value="draft" ${course.status==='draft'?'selected':''}>مسودة</option>
          <option value="published" ${course.status==='published'?'selected':''}>منشور</option>
          <option value="archived" ${course.status==='archived'?'selected':''}>مؤرشف (مخفي عن الطلاب، بياناته محفوظة)</option>
        </select>
        <button class="btn dark" id="sSave" style="margin-top:16px">حفظ التغييرات</button>
      </div>

      <div class="card" style="margin-top:16px;border-color:rgba(224,49,49,.4)">
        <b style="color:#E03131">منطقة الخطر</b>
        <p class="small" style="margin-top:6px">حذف الكورس نهائيًا يمسح كل الوحدات والدروس والواجبات وتسليمات الطلاب وملفاتهم وإعلانات الكورس — <b>بلا رجعة إطلاقًا</b>. لو تبي بس تخفيه عن الطلاب مؤقتًا مع الاحتفاظ بكل شيء، استخدم "أرشفة" من قائمة الحالة فوق بدلًا من هذا.</p>
        <button class="btn danger" id="sDeleteBtn" style="margin-top:10px">حذف الكورس نهائيًا</button>
      </div>`;

    body.querySelector("#sSave").onclick = async ()=>{
      const newSlug = body.querySelector("#sSlug").value.trim();
      try{
        await db.from("courses").update({
          name: body.querySelector("#sName").value.trim(),
          description: body.querySelector("#sDesc").value.trim(),
          slug: newSlug,
          status: body.querySelector("#sStatus").value
        }).eq("id", course.id).throwOnError();
        CodeUp.toast("تم الحفظ", "success");
      }catch(e){ CodeUp.toast(e.message.includes("duplicate")?"هذا الرابط مستخدم لكورس آخر":e.message, "error"); }
    };

    body.querySelector("#sDeleteBtn").onclick = ()=>{
      const m = Admin.modal(`
        <h3 style="color:#E03131">حذف "${CodeUp.escapeHtml(course.name)}" نهائيًا</h3>
        <p class="small">هذا الإجراء لا يمكن التراجع عنه. سيُحذف كل محتوى الكورس وتسليمات الطلاب وملفاتهم بالكامل.</p>
        <label>اكتب اسم الكورس بالضبط للتأكيد: <b>${CodeUp.escapeHtml(course.name)}</b></label>
        <input id="dConfirm" placeholder="${CodeUp.escapeHtml(course.name)}">
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn" id="dCancel">إلغاء</button>
          <button class="btn danger" id="dConfirmBtn">حذف نهائي</button>
        </div>`);
      m.el.querySelector("#dCancel").onclick = m.close;
      m.el.querySelector("#dConfirmBtn").onclick = async ()=>{
        const typed = m.el.querySelector("#dConfirm").value.trim();
        const btn = m.el.querySelector("#dConfirmBtn");
        btn.disabled = true;
        try{
          // نمسح ملفات Storage الحية أولًا (الدالة بقاعدة البيانات ما تقدر تحذف من Storage مباشرة)
          const { data: files } = await db.from("file_uploads").select("storage_path").eq("course_id", course.id).eq("archive_status","live");
          const paths = (files||[]).map(f=>f.storage_path).filter(Boolean);
          if(paths.length) await db.storage.from("submissions").remove(paths);

          await db.rpc("delete_course_permanently", {p_course_id: course.id, p_confirm_name: typed}).throwOnError();
          CodeUp.toast("تم حذف الكورس نهائيًا", "success");
          m.close();
          location.reload();
        }catch(e){ CodeUp.toast(e.message||"فشل الحذف — تأكد من الاسم", "error"); btn.disabled = false; }
      };
    };
  }
};

// مركز الإعدادات — صفحة تجميع فقط، بدون أي منطق أو بيانات جديدة.
// تربط بالصفحات الحقيقية الموجودة أصلًا (لا تُنشئ أي إعداد وهمي).
// كل بطاقة تظهر فقط لو القسم المرتبط بها موجود فعلًا بالمشروع ومتاح للدور الحالي.
Admin.sections.settings_hub = {
  label: "الإعدادات",
  async render(body){
    const isSuper = Admin.role === "super";
    const hasCourse = Admin.currentCourseId && Admin.currentCourseId !== HOME_SENTINEL;

    const groups = [
      { title:"هذا الكورس", items:[
        hasCourse && {icon:"📘", label:"إعدادات الكورس", desc:"الاسم، الوصف، الرابط، الحالة، وحذف الكورس نهائيًا.", goto:"settings"},
        hasCourse && {icon:Icon("archive"), label:"الأرشفة والملفات", desc:"مدة الاحتفاظ بملفات التسليمات قبل حذفها من التخزين المؤقت.", goto:"files"},
      ].filter(Boolean) },
      { title:"المنصة (Super Admin)", items: isSuper ? [
        {icon:Icon("announcement"), label:"الإعلانات العامة", desc:"إعلانات تظهر لكل مستخدمي CodeUp بالصفحة الرئيسية.", goto:"home_announcements", home:true},
        {icon:Icon("assignments"), label:"الإشراف على منشورات المستجدات", desc:"حذف أي منشور حر غير مناسب من الصفحة الرئيسية.", goto:"home_posts", home:true},
        {icon:Icon("comment"), label:"مدة الاحتفاظ بالرسائل الخاصة", desc:"عدد الأيام قبل حذف الرسائل الخاصة تلقائيًا.", goto:"message_settings", home:true},
        {icon:Icon("university"), label:"قسم الجامعة", desc:"الفصول الدراسية والمواد لكل جامعة مضافة.", goto:"university", home:true},
        {icon:Icon("layers"), label:"الجامعات وأدمنها", desc:"إضافة جامعة جديدة أو تعيين أدمن لإدارة محتوى جامعة معيّنة.", goto:"universities", home:true},
      ] : [] }
    ].filter(g=>g.items.length);

    if(!groups.length){
      body.innerHTML = `<div class="emptyStatePro"><h4>لا توجد إعدادات متاحة هنا</h4><p>اختر كورسًا من القائمة الجانبية لعرض إعداداته.</p></div>`;
      return;
    }

    body.innerHTML = groups.map(g=>`
      <div class="card" style="margin-bottom:14px">
        <b>${CodeUp.escapeHtml(g.title)}</b>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:2px">
          ${g.items.map(it=>`
            <button class="quickAction" style="width:100%;justify-content:flex-start" data-hubgo="${it.goto}" data-home="${!!it.home}">
              <span class="qaIcon">${it.icon}</span>
              <span style="display:flex;flex-direction:column;align-items:flex-start;text-align:start">
                <b style="font-size:13.5px">${CodeUp.escapeHtml(it.label)}</b>
                <span class="small">${CodeUp.escapeHtml(it.desc)}</span>
              </span>
            </button>`).join("")}
        </div>
      </div>`).join("");

    body.querySelectorAll("[data-hubgo]").forEach(b=>{
      b.onclick = async ()=>{
        // بعض الصفحات (الإعلانات العامة، الجامعة...) لا تُقرأ إلا بسياق "الصفحة الرئيسية" وليس داخل كورس محدد
        if(b.dataset.home === "true" && Admin.currentCourseId !== HOME_SENTINEL){
          Admin.currentCourseId = HOME_SENTINEL;
          await Admin.renderNav();
        }
        Admin.go(b.dataset.hubgo);
      };
    });
  }
};

Admin.sections.progress = {
  label: "التقدم",
  async render(body){
    const { data } = await db.from("enrollments").select("*, profiles(full_name,email), squads(name)").eq("course_id", Admin.currentCourseId).order("xp",{ascending:false});
    body.innerHTML = `<div class="card"><table><thead><tr><th>الطالب</th><th>المجموعة</th><th>الحالة</th><th>التقدم</th><th>XP</th><th>Streak</th></tr></thead>
      <tbody>${(data||[]).map(e=>`
        <tr>
          <td>${CodeUp.escapeHtml(e.profiles?.full_name||e.profiles?.email||"")}</td>
          <td>${CodeUp.escapeHtml(e.squads?.name||"—")}</td>
          <td><span class="pill ${e.status==='on_track'?'approved':e.status==='behind'?'rejected':'pending'}">${enrollmentStatusLabel(e.status)}</span></td>
          <td>${e.progress}%</td><td>${e.xp}</td><td>${e.streak}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="emptyState">لا يوجد طلاب مسجلون بعد.</td></tr>`}
      </tbody></table></div>`;
  }
};
