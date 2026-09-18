// admin/js/dashboard.js — CodeUp Admin Control Center (Phase 5)
// كل رقم هنا من قاعدة البيانات فعليًا؛ لا أرقام وهمية. أي قسم بدون بيانات كافية يُخفى بدل ما يظهر فاضي.

Admin.sections.dashboard = {
  label: "لوحة التحكم",
  async render(body){
    body.innerHTML = dashSkeleton();
    try{
      if(Admin.role === "super") await renderSuperDashboard(body);
      else await renderCourseAdminDashboard(body, Admin.currentCourseId);
    }catch(e){
      body.innerHTML = `<div class="alertBox error">
        <span>تعذّر تحميل لوحة التحكم. ${CodeUp.escapeHtml(e.message||"")}</span>
        <button class="btn alertRetry" id="dashRetry">إعادة المحاولة</button>
      </div>`;
      body.querySelector("#dashRetry").onclick = ()=> Admin.go("dashboard");
    }
  }
};

// ============================================================
// SUPER ADMIN — نظرة على المنصة كاملة
// ============================================================
async function renderSuperDashboard(body){
  const cid = Admin.currentCourseId;
  const hasCourse = cid && cid !== HOME_SENTINEL;
  const now = Date.now();
  const weekAgo = new Date(now - 7*86400000).toISOString();
  const prevWeekAgo = new Date(now - 14*86400000).toISOString();

  const [
    {count:usersTotal}, {count:usersWeek}, {count:usersPrevWeek},
    {count:coursesTotal}, {count:coursesWeek},
    {count:enrollTotal},
    {count:subsTotal}, {count:subsWeek}, {count:subsPrevWeek},
    {data:activity}, {data:recentSubs}, {data:topCourses}, {data:weekSubs}
  ] = await Promise.all([
    db.from("profiles").select("id",{count:"exact",head:true}),
    db.from("profiles").select("id",{count:"exact",head:true}).gte("created_at", weekAgo),
    db.from("profiles").select("id",{count:"exact",head:true}).gte("created_at", prevWeekAgo).lt("created_at", weekAgo),
    db.from("courses").select("id",{count:"exact",head:true}),
    db.from("courses").select("id",{count:"exact",head:true}).gte("created_at", weekAgo),
    db.from("enrollments").select("id",{count:"exact",head:true}),
    db.from("submissions").select("id",{count:"exact",head:true}),
    db.from("submissions").select("id",{count:"exact",head:true}).gte("submitted_at", weekAgo),
    db.from("submissions").select("id",{count:"exact",head:true}).gte("submitted_at", prevWeekAgo).lt("submitted_at", weekAgo),
    db.from("activity_log").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(8),
    db.from("submissions").select("*, assignments!inner(title), profiles(full_name,email)").order("submitted_at",{ascending:false}).limit(6),
    db.from("courses").select("id,name,status").order("created_at",{ascending:false}).limit(8),
    db.from("submissions").select("submitted_at").gte("submitted_at", weekAgo)
  ]);

  let attention = [];
  let pendingHere = 0, pendingHereWeek = 0;
  if(hasCourse){
    const [{count:jr},{count:la},{count:pendSub},{count:pendSubWeek},{count:failedFiles}] = await Promise.all([
      db.from("squad_join_requests").select("id, squads!inner(course_id)",{count:"exact",head:true}).eq("squads.course_id",cid).eq("status","pending"),
      db.from("leader_applications").select("id",{count:"exact",head:true}).eq("course_id",cid).eq("status","pending"),
      db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid).in("status",["submitted","late"]),
      db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid).in("status",["submitted","late"]).gte("submitted_at", weekAgo),
      db.from("file_uploads").select("id",{count:"exact",head:true}).eq("course_id",cid).eq("archive_status","failed")
    ]);
    pendingHere = pendSub||0; pendingHereWeek = pendSubWeek||0;
    if(jr>0) attention.push(attentionItem(Icon("squads"), `${jr} طلب انضمام بانتظار المراجعة`, "للكورس الحالي", "join_requests"));
    if(la>0) attention.push(attentionItem(Icon("university"), `${la} طلب قيادة مجموعة بانتظار المراجعة`, "للكورس الحالي", "leader_applications"));
    if(pendingHere>0) attention.push(attentionItem(Icon("assignments"), `${pendingHere} تسليم بانتظار المراجعة`, "للكورس الحالي", "submissions"));
    if(failedFiles>0) attention.push(attentionItem(Icon("alert_triangle"), `${failedFiles} ملف فشل إرساله لأرشيف تيليجرام`, "سيُعاد المحاولة تلقائيًا", "files"));
  }

  const learningOverviewHtml = await buildLearningOverview(topCourses||[]);

  body.innerHTML = `
    ${greetingHeader("نظرة CodeUp العامة", "هذا ملخص ما يحدث الآن عبر كل المنصة.")}

    <div class="quickActions">
      ${quickActionBtn(Icon("layers"),"+ كورس جديد","newCourseQA")}
      ${hasCourse ? quickActionBtn(Icon("file"),"+ واجب جديد","newAssignQA") : ""}
      ${hasCourse ? quickActionBtn(Icon("announcement"),"+ إعلان جديد","goAnnQA") : ""}
      ${quickActionBtn(Icon("learning"),"إدارة المحتوى","goContentQA")}
    </div>

    <div class="statGrid">
      ${statCard("المستخدمون", usersTotal, trendVs(usersWeek, usersPrevWeek, "هذا الأسبوع"), "users")}
      ${statCard("الكورسات", coursesTotal, coursesWeek ? `<span class="trend up">+${coursesWeek} هذا الأسبوع</span>` : "", "courses")}
      ${statCard("التسجيلات", enrollTotal, "", null)}
      ${hasCourse
        ? statCard("قيد المراجعة (الكورس الحالي)", pendingHere, pendingHereWeek ? `<span class="trend up">+${pendingHereWeek} هذا الأسبوع</span>` : "", "submissions")
        : statCard("إجمالي التسليمات", subsTotal, trendVs(subsWeek, subsPrevWeek, "هذا الأسبوع"), null)}
    </div>

    <div class="card">
      <b>يحتاج انتباهك</b>
      ${hasCourse
        ? (attention.length ? `<div style="margin-top:8px">${attention.join("")}</div>` : `<div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">كل شيء تمام، لا يوجد شيء يحتاج تدخلك الآن في هذا الكورس.</p></div>`)
        : `<div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">اختر كورسًا من القائمة الجانبية لعرض العناصر التي تحتاج انتباهك الخاصة به.</p></div>`}
    </div>

    ${learningOverviewHtml}

    <div class="card">
      <b>التسليمات اليومية — آخر 7 أيام</b>
      ${renderDailyBarChart(weekSubs, "submitted_at")}
    </div>

    <div class="card">
      <b>آخر التسليمات</b>
      ${recentSubmissionsTable(recentSubs)}
    </div>

    <div class="card">
      <b>آخر النشاط</b>
      ${activityList(activity)}
    </div>
  `;

  wireDashboard(body, {cid});
}

// ============================================================
// COURSE ADMIN — نظرة على كورسه فقط
// ============================================================
async function renderCourseAdminDashboard(body, cid){
  const courseName = (Admin.courses||[]).find(c=>c.id===cid)?.name || "الكورس";
  const now = Date.now();
  const weekAgo = new Date(now - 7*86400000).toISOString();
  const prevWeekAgo = new Date(now - 14*86400000).toISOString();

  const [
    {count:squadsCount}, {count:enrollCount}, {data:progRows},
    {count:subsTotal}, {count:subsWeek}, {count:subsPrevWeek},
    {count:pendSub}, {count:pendSubWeek},
    {count:jr}, {count:la}, {count:failedFiles},
    {data:activity}, {data:recentSubs}, {data:weekSubs}
  ] = await Promise.all([
    db.from("squads").select("id",{count:"exact",head:true}).eq("course_id",cid),
    db.from("enrollments").select("id",{count:"exact",head:true}).eq("course_id",cid),
    db.from("enrollments").select("progress").eq("course_id",cid),
    db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid),
    db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid).gte("submitted_at", weekAgo),
    db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid).gte("submitted_at", prevWeekAgo).lt("submitted_at", weekAgo),
    db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid).in("status",["submitted","late"]),
    db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid).in("status",["submitted","late"]).gte("submitted_at", weekAgo),
    db.from("squad_join_requests").select("id, squads!inner(course_id)",{count:"exact",head:true}).eq("squads.course_id",cid).eq("status","pending"),
    db.from("leader_applications").select("id",{count:"exact",head:true}).eq("course_id",cid).eq("status","pending"),
    db.from("file_uploads").select("id",{count:"exact",head:true}).eq("course_id",cid).eq("archive_status","failed"),
    db.from("activity_log").select("*, profiles(full_name)").eq("course_id",cid).order("created_at",{ascending:false}).limit(8),
    db.from("submissions").select("*, assignments!inner(title,course_id), profiles(full_name,email)").eq("assignments.course_id",cid).order("submitted_at",{ascending:false}).limit(6),
    db.from("submissions").select("submitted_at, assignments!inner(course_id)").eq("assignments.course_id",cid).gte("submitted_at", weekAgo)
  ]);

  const avgProgress = avgOf((progRows||[]).map(r=>r.progress));
  const attention = [];
  if(jr>0) attention.push(attentionItem(Icon("squads"), `${jr} طلب انضمام بانتظار المراجعة`, "", "join_requests"));
  if(la>0) attention.push(attentionItem(Icon("university"), `${la} طلب قيادة مجموعة بانتظار المراجعة`, "", "leader_applications"));
  if(pendSub>0) attention.push(attentionItem(Icon("assignments"), `${pendSub} تسليم بانتظار المراجعة`, "", "submissions"));
  if(failedFiles>0) attention.push(attentionItem(Icon("alert_triangle"), `${failedFiles} ملف فشل إرساله لأرشيف تيليجرام`, "سيُعاد المحاولة تلقائيًا", "files"));

  body.innerHTML = `
    ${greetingHeader(`نظرة على ${CodeUp.escapeHtml(courseName)}`, "هذا ملخص ما يحدث الآن في كورسك.")}

    <div class="quickActions">
      ${quickActionBtn(Icon("file"),"+ واجب جديد","newAssignQA")}
      ${quickActionBtn(Icon("announcement"),"+ إعلان جديد","goAnnQA")}
      ${quickActionBtn(Icon("learning"),"إدارة المحتوى","goContentQA")}
    </div>

    <div class="statGrid">
      ${statCard("المجموعات", squadsCount, "", "squads")}
      ${statCard("الطلاب المسجلون", enrollCount, avgProgress!==null ? `<span class="trend flat">متوسط تقدم ${avgProgress}%</span>` : "", "progress")}
      ${statCard("قيد المراجعة", pendSub, pendSubWeek ? `<span class="trend up">+${pendSubWeek} هذا الأسبوع</span>` : "", "submissions")}
      ${statCard("إجمالي التسليمات", subsTotal, trendVs(subsWeek, subsPrevWeek, "هذا الأسبوع"), null)}
    </div>

    <div class="card">
      <b>يحتاج انتباهك</b>
      ${attention.length ? `<div style="margin-top:8px">${attention.join("")}</div>` : `<div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">كل شيء تمام، لا يوجد شيء يحتاج تدخلك الآن.</p></div>`}
    </div>

    <div class="card">
      <b>التسليمات اليومية — آخر 7 أيام</b>
      ${renderDailyBarChart(weekSubs, "submitted_at")}
    </div>

    <div class="card">
      <b>آخر التسليمات</b>
      ${recentSubmissionsTable(recentSubs)}
    </div>

    <div class="card">
      <b>آخر النشاط</b>
      ${activityList(activity)}
    </div>
  `;

  wireDashboard(body, {cid});
}

// ============================================================
// Learning Overview — الكورسات الأكثر نشاطًا (Super فقط، استعلام واحد إضافي على enrollments)
// ============================================================
async function buildLearningOverview(courses){
  if(!courses.length) return "";
  const ids = courses.map(c=>c.id);
  const { data: rows } = await db.from("enrollments").select("course_id,progress").in("course_id", ids);
  const byCourse = {};
  (rows||[]).forEach(r=>{
    byCourse[r.course_id] = byCourse[r.course_id] || [];
    byCourse[r.course_id].push(r.progress);
  });
  const ranked = courses
    .map(c=>({ ...c, count: (byCourse[c.id]||[]).length, avg: avgOf(byCourse[c.id]||[]) }))
    .sort((a,b)=> b.count - a.count)
    .filter(c=>c.count > 0)
    .slice(0,5);

  if(!ranked.length) return "";

  return `
    <div class="card">
      <b>الكورسات الأكثر نشاطًا</b>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:12px">
        ${ranked.map(c=>`
          <div style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
                <b style="font-size:13.5px">${CodeUp.escapeHtml(c.name)}</b>
                <span class="small" style="color:var(--ink60);white-space:nowrap">${c.count} طالب${c.avg!==null ? ` · ${c.avg}% متوسط تقدم` : ""}</span>
              </div>
              <div class="progressTrack"><div class="progressFill" style="width:${c.avg??0}%"></div></div>
            </div>
            <button class="btn" data-viewcourse="${c.id}">عرض</button>
          </div>
        `).join("")}
      </div>
    </div>`;
}

// ============================================================
// Helpers — بناء HTML بحت (بدون أي دوال مضمّنة داخل الـ HTML؛ الربط كله بـ wireDashboard)
// ============================================================
function dashSkeleton(){
  return `
    <div class="statGrid">${Array(4).fill(`<div class="skeletonStat skeleton"></div>`).join("")}</div>
    <div class="card">
      <div class="skeleton skeleton-line w40" style="height:16px;margin-bottom:14px"></div>
      ${Array(3).fill(`<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><div class="skeleton skeleton-avatar"></div><div style="flex:1"><div class="skeleton skeleton-line w80" style="margin-bottom:6px"></div><div class="skeleton skeleton-line w40"></div></div></div>`).join("")}
    </div>`;
}

function greetingHeader(title, subtitle){
  const h = new Date().getHours();
  const greet = h<12 ? "صباح الخير" : "مساء الخير";
  return `
    <div style="margin-bottom:18px">
      <div class="small" style="color:var(--ink60);margin-bottom:2px">${greet}</div>
      <h2 style="margin:0 0 4px;font-size:19px">${CodeUp.escapeHtml(title)}</h2>
      <div class="small" style="color:var(--ink60)">${CodeUp.escapeHtml(subtitle)}</div>
    </div>`;
}

// gotoSection: مفتاح قسم بالـ Admin.sections للانتقال إليه عند الضغط، أو null لبطاقة معلوماتية فقط
function statCard(label, value, extraHtml, gotoSection){
  const clickable = !!gotoSection;
  return `<div class="stat${clickable?" clickableStat":""}" ${clickable?`data-goto="${gotoSection}" style="cursor:pointer"`:""}>
    ${CodeUp.escapeHtml(label)}<b>${value ?? 0}</b>${extraHtml?`<div style="margin-top:4px">${extraHtml}</div>`:""}
  </div>`;
}

function trendVs(thisWeek, prevWeek, label){
  thisWeek = thisWeek||0; prevWeek = prevWeek||0;
  if(!thisWeek && !prevWeek) return "";
  if(prevWeek === 0) return `<span class="trend up">+${thisWeek} ${label}</span>`;
  const diff = thisWeek - prevWeek;
  if(diff > 0) return `<span class="trend up">↑ +${diff} ${label}</span>`;
  if(diff < 0) return `<span class="trend down">↓ ${diff} ${label}</span>`;
  return `<span class="trend flat">${thisWeek} ${label}</span>`;
}

function attentionItem(icon, text, meta, gotoSection){
  return `<div class="attentionItem">
    <div class="aiIcon">${icon}</div>
    <div class="aiBody">${CodeUp.escapeHtml(text)}${meta?`<div class="aiMeta">${CodeUp.escapeHtml(meta)}</div>`:""}</div>
    <button class="btn" data-goto="${gotoSection}">مراجعة</button>
  </div>`;
}

function activityList(rows){
  if(!rows || !rows.length) return `<div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">لا يوجد نشاط بعد.</p></div>`;
  return rows.map(a=>`
    <div class="activityItem">
      ${CodeUp.avatarHtml(a.profiles?.full_name, null, 28)}
      <div class="acBody">${CodeUp.escapeHtml(a.profiles?.full_name||"—")} — ${CodeUp.escapeHtml(a.action_text||"")}</div>
      <div class="acTime">${CodeUp.timeAgo(a.created_at)}</div>
    </div>`).join("");
}

function recentSubmissionsTable(rows){
  if(!rows || !rows.length) return `<div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">لا توجد تسليمات بعد.</p></div>`;
  return `<div class="tableScroll"><table><thead><tr><th>الطالب</th><th>الواجب</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
    <tbody>${rows.map(s=>`
      <tr>
        <td>${CodeUp.escapeHtml(s.profiles?.full_name||s.profiles?.email||"—")}</td>
        <td>${CodeUp.escapeHtml(s.assignments?.title||"—")}</td>
        <td><span class="pill ${s.status==='reviewed'?'approved':s.status==='late'?'pending':''}">${{submitted:"تم التسليم",late:"متأخر",missing:"لم يُسلَّم",reviewed:"تمت المراجعة"}[s.status]||s.status}</span></td>
        <td class="small" style="color:var(--ink60)">${CodeUp.timeAgo(s.submitted_at)}</td>
        <td><button class="btn" data-quickreview="${s.id}">مراجعة</button></td>
      </tr>`).join("")}</tbody></table></div>`;
}

function quickActionBtn(icon, label, key){
  return `<button class="quickAction" data-qa="${key}"><span class="qaIcon">${icon}</span><span>${label}</span></button>`;
}

function avgOf(arr){
  const nums = arr.filter(n=>typeof n === "number" && !Number.isNaN(n));
  if(!nums.length) return null;
  return Math.round(nums.reduce((a,b)=>a+b,0)/nums.length);
}

// رسم بياني بسيط (SVG صرف، بدون أي مكتبة خارجية) لعدد التسليمات بكل يوم من آخر 7 أيام
function renderDailyBarChart(rows, dateField){
  const days = [];
  for(let i=6;i>=0;i--){
    const d = new Date(Date.now() - i*86400000);
    days.push({ key: d.toDateString(), label: d.toLocaleDateString("ar-EG",{weekday:"short"}), date: d });
  }
  const counts = Object.fromEntries(days.map(d=>[d.key,0]));
  (rows||[]).forEach(r=>{
    const k = new Date(r[dateField]).toDateString();
    if(k in counts) counts[k]++;
  });
  const max = Math.max(1, ...days.map(d=>counts[d.key]));
  const total = days.reduce((s,d)=>s+counts[d.key],0);
  if(total === 0){
    return `<div class="emptyStatePro" style="padding:20px 8px"><p style="margin:0">لا توجد تسليمات بآخر 7 أيام بعد.</p></div>`;
  }
  const W = 320, H = 110, barW = 28, gap = (W - barW*7)/8;
  const bars = days.map((d,i)=>{
    const x = gap + i*(barW+gap);
    const h = Math.round((counts[d.key]/max) * (H-30));
    const y = H - 20 - h;
    return `
      <text x="${x+barW/2}" y="${y-6}" text-anchor="middle" font-size="10" fill="var(--ink)" font-family="'IBM Plex Mono',monospace">${counts[d.key]}</text>
      <rect x="${x}" y="${y}" width="${barW}" height="${h||2}" rx="4" fill="var(--indigo)" opacity="${counts[d.key]?1:0.25}"></rect>
      <text x="${x+barW/2}" y="${H-4}" text-anchor="middle" font-size="10" fill="var(--ink60)" font-family="'IBM Plex Sans Arabic',sans-serif">${CodeUp.escapeHtml(d.label)}</text>
    `;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;margin-top:6px" role="img" aria-label="رسم بياني للتسليمات اليومية بآخر 7 أيام">${bars}</svg>`;
}

// ============================================================
// Wiring — كل الأحداث تُربط هنا بعد الحقن بالـ DOM، دفعة واحدة، بنفس أسلوب باقي صفحات الأدمن
// ============================================================
function wireDashboard(body, {cid}){
  const hasCourse = cid && cid !== HOME_SENTINEL;

  // أي عنصر (بطاقة مقياس أو عنصر Needs Attention) عليه data-goto ينتقل للقسم مباشرة
  body.querySelectorAll("[data-goto]").forEach(el=>{
    el.onclick = ()=> Admin.go(el.dataset.goto);
  });

  const newCourseBtn = body.querySelector('[data-qa="newCourseQA"]');
  if(newCourseBtn) newCourseBtn.onclick = ()=> openCourseModal();

  const newAssignBtn = body.querySelector('[data-qa="newAssignQA"]');
  if(newAssignBtn) newAssignBtn.onclick = ()=>{
    if(!hasCourse){ CodeUp.toast("اختر كورسًا أولًا", "error"); return; }
    openAssignmentModal(cid);
  };

  const goAnnBtn = body.querySelector('[data-qa="goAnnQA"]');
  if(goAnnBtn) goAnnBtn.onclick = ()=> Admin.go("announcements");

  const goContentBtn = body.querySelector('[data-qa="goContentQA"]');
  if(goContentBtn) goContentBtn.onclick = ()=> Admin.go(hasCourse ? "content" : "courses");

  // بطاقات "عرض" داخل "الكورسات الأكثر نشاطًا" — تُبدّل الكورس الحالي ثم تُرجع لهذه الصفحة بسياقه
  body.querySelectorAll("[data-viewcourse]").forEach(btn=>{
    btn.onclick = async ()=>{
      Admin.currentCourseId = btn.dataset.viewcourse;
      await Admin.renderNav();
      Admin.go("dashboard");
    };
  });

  // زر "مراجعة" بجدول آخر التسليمات — نفس نافذة المراجعة المستخدمة أصلًا بصفحة التسليمات
  body.querySelectorAll("[data-quickreview]").forEach(btn=>{
    btn.onclick = async ()=>{
      const { data: sub } = await db.from("submissions").select("*, assignments!inner(title), profiles(full_name,email)").eq("id", btn.dataset.quickreview).single();
      if(sub) openReviewModal(sub);
    };
  });
}
