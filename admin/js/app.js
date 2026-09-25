// admin/js/app.js
const LEADER_SECTION_LABELS = {
  mysquad:"مجموعتي", members:"الأعضاء", ljoin:"طلبات الانضمام", lassignments:"الواجبات",
  lcontent:"المحتوى التعليمي", lsubmissions:"التسليمات", ltimeline:"المستجدات",
  lactivity:"النشاط", lprogress:"التقدم"
};
// الأقسام اللي معناها يعتمد على كورس محدد (تُستخدم لعرض اسم الكورس بمسار التنقّل بس لما تكون الصفحة فعلًا تابعة لكورس)
const COURSE_SCOPED_SECTIONS = new Set(["content","squads","leaders","join_requests","leader_applications","assignments","submissions","timeline","announcements","progress","files","settings"]);
const Admin = {
  ctx: null,          // من CodeUp.loadMyContext()
  role: null,         // 'super' | 'course_admin' | 'leader' | 'university_admin'
  accessibleCourseIds: [], // الكورسات التي يحق له إدارتها بأي صفة
  currentCourseId: null,
  currentSquadId: null, // لواجهة القائد (مقيّد بمجموعاته)
  currentUniversityId: null, // للجامعة المُدارة حاليًا (سوبر أدمن أو أدمن جامعة)
  universityAdminIds: [], // الجامعات التي يحق له إدارة محتواها (فارغة لغير أدمن جامعة)
  isTechWeekAdmin: false, // صلاحية عامة واحدة على كل محتوى الأسبوع التقني (مرنة عمدًا، تُضيَّق لاحقًا لو احتجنا)
  section: "dashboard",
  sections: {}, // يُعبّأ من ملفات admin/js/*.js الأخرى: {key:{label,icon,scope,render}}
  openNavGroup: null, // اسم مجموعة السايدبار المفتوحة حاليًا (أقسام قابلة للطي)

  async boot(){
    // 1) Check Auth
    const { data: sessionData } = await db.auth.getSession();
    if(!sessionData.session){
      window.location.href = "../index.html";
      return;
    }

    // 2/3/4/5) Check is_platform_admin, Course Admin, Leader relationships
    this.ctx = await CodeUp.loadMyContext();
    const isSuper = this.ctx.isPlatformAdmin;
    const courseAdminIds = this.ctx.courseAdminCourseIds;
    const leaderCourseIds = this.ctx.leaderCourseIds;
    const universityAdminIds = this.ctx.universityAdminIds || [];
    this.universityAdminIds = universityAdminIds;
    this.isTechWeekAdmin = !!this.ctx.isTechWeekAdmin;

    if(!isSuper && !courseAdminIds.length && !leaderCourseIds.length && !universityAdminIds.length && !this.isTechWeekAdmin){
      document.getElementById("gate").innerHTML =
        `<div style="text-align:center;font-family:system-ui"><h2>لا تملك صلاحية دخول لوحة الإدارة</h2>
         <p><a href="../index.html">العودة لتطبيق الطالب</a></p></div>`;
      return;
    }

    // 6) حدد Dashboard المناسب حسب الصلاحية الأعلى
    if(isSuper) this.role = "super";
    else if(courseAdminIds.length) this.role = "course_admin";
    else if(leaderCourseIds.length) this.role = "leader";
    else if(universityAdminIds.length) this.role = "university_admin";
    else this.role = "tech_week_admin"; // ما عنده أي صلاحية ثانية إطلاقًا، بس أدمن أسبوع تقني

    this.accessibleCourseIds = isSuper ? null /* كل الكورسات */
      : [...new Set([...courseAdminIds, ...leaderCourseIds])];

    this.currentCourseId = (this.accessibleCourseIds && this.accessibleCourseIds[0]) || null;
    if(this.role === "leader" && this.ctx.leaderSquads.length){
      this.currentSquadId = this.ctx.leaderSquads[0].squad_id;
    }
    if(this.role === "university_admin" && universityAdminIds.length){
      this.currentUniversityId = universityAdminIds[0];
    }

    document.getElementById("gate").classList.add("hidden");
    document.getElementById("shell").classList.remove("hidden");
    document.getElementById("whoLabel").textContent =
      `${this.ctx.profile.full_name || this.ctx.user.email} — ${roleLabel(this.role)}`;
    document.getElementById("backToApp").href = "../index.html";
    document.getElementById("signOut").onclick = async (e)=>{ e.preventDefault(); await db.auth.signOut(); window.location.href="../index.html"; };
    document.getElementById("notifBtn").onclick = ()=>this.openNotifications();
    CodeUp.subscribeToMyNotifications(this.ctx.user.id, (n)=>{ this.refreshNotifBadge(); CodeUp.toast(n.title, "info"); });
    this.initLayoutControls();

    await this.loadAccessibleCourses();
    this.refreshNotifBadge();
    await this.renderNav();
    this.go(this.role === "leader" ? "mysquad" : (this.role === "university_admin" ? "university" : (this.role === "tech_week_admin" ? "tech_week_events" : "dashboard")));
  },

  // ---------- Layout: Sidebar (Drawer على الموبايل + طي على Desktop) + Breadcrumb ----------
  initLayoutControls(){
    const shell = document.getElementById("shell");
    const sidebar = document.getElementById("sidebarEl");
    const scrim = document.getElementById("sidebarScrim");
    const menuBtn = document.getElementById("mobileMenuBtn");
    const collapseBtn = document.getElementById("sidebarToggleBtn");

    const openMobile = ()=>{ sidebar.classList.add("open"); scrim.classList.add("show"); };
    const closeMobile = ()=>{ sidebar.classList.remove("open"); scrim.classList.remove("show"); };
    this.closeMobileSidebar = closeMobile;

    if(menuBtn) menuBtn.onclick = ()=> sidebar.classList.contains("open") ? closeMobile() : openMobile();
    if(scrim) scrim.onclick = closeMobile;

    if(collapseBtn){
      const saved = localStorage.getItem("cu_admin_sidebar_collapsed") === "1";
      if(saved) shell.classList.add("sidebarCollapsed");
      collapseBtn.onclick = ()=>{
        const collapsed = shell.classList.toggle("sidebarCollapsed");
        localStorage.setItem("cu_admin_sidebar_collapsed", collapsed ? "1" : "0");
      };
    }
  },

  setBreadcrumb(parts){
    const el = document.getElementById("pageBreadcrumb");
    if(!el) return;
    el.innerHTML = parts.filter(Boolean).map((p,i)=>{
      const isLast = i === parts.length-1;
      return (i>0 ? `<span class="sep">/</span>` : "") + `<span class="${isLast?"current":""}">${CodeUp.escapeHtml(p)}</span>`;
    }).join("");
  },

  async refreshNotifBadge(){
    if(this.role === "super" || this.role === "admin"){
      const courseIds = (this.courses||[]).map(c=>c.id);
      let joinCount = 0, leaderCount = 0;
      if(courseIds.length){
        const { count: jc } = await db.from("squad_join_requests").select("id, squads!inner(course_id)", {count:"exact",head:true}).eq("status","pending").in("squads.course_id", courseIds);
        const { count: lc } = await db.from("leader_applications").select("id",{count:"exact",head:true}).eq("status","pending").in("course_id", courseIds);
        joinCount = jc||0; leaderCount = lc||0;
      }
      const total = joinCount + leaderCount;
      const badge = document.getElementById("notifBadge");
      if(!badge) return;
      if(total>0){ badge.textContent = total>9?"9+":total; badge.classList.remove("hidden"); }
      else badge.classList.add("hidden");
      return;
    }
    const {count} = await db.from("notifications").select("id",{count:"exact",head:true}).eq("profile_id", this.ctx.user.id).eq("is_read", false);
    const badge = document.getElementById("notifBadge");
    if(!badge) return;
    if(count>0){ badge.textContent = count>9?"9+":count; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
  },

  async openNotifications(){
    if(this.role === "super" || this.role === "admin"){
      const courseIds = (this.courses||[]).map(c=>c.id);
      const [{data: joinReqs}, {data: leaderApps}] = await Promise.all([
        courseIds.length ? db.from("squad_join_requests").select("*, squads!inner(name,course_id), profiles(full_name)").eq("status","pending").in("squads.course_id", courseIds).order("created_at",{ascending:false}) : Promise.resolve({data:[]}),
        courseIds.length ? db.from("leader_applications").select("*, profiles(full_name)").eq("status","pending").in("course_id", courseIds).order("created_at",{ascending:false}) : Promise.resolve({data:[]})
      ]);
      const items = [
        ...(joinReqs||[]).map(r=>({type:"join", created_at:r.created_at, courseId:r.squads.course_id,
          label:`طلب انضمام: ${r.profiles?.full_name||""} → ${r.squads?.name||""}`, section:"join_requests"})),
        ...(leaderApps||[]).map(a=>({type:"leader", created_at:a.created_at, courseId:a.course_id,
          label:`طلب قيادة: ${a.profiles?.full_name||""}`, section:"leader_applications"}))
      ].sort((x,y)=> new Date(y.created_at) - new Date(x.created_at));

      const list = items.map(it=>`
        <div class="card notifClickable" data-notifcourse="${it.courseId}" data-notifsection="${it.section}" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:13.5px">${CodeUp.escapeHtml(it.label)}</b><span class="who">${CodeUp.timeAgo(it.created_at)}</span></div>
        </div>`).join("") || `<div class="emptyState">لا توجد طلبات جديدة بأي كورس.</div>`;

      const m = this.modal(`<h3>الطلبات الجديدة (كل الكورسات)</h3><div style="max-height:60vh;overflow-y:auto;margin-top:10px">${list}</div>`);
      m.el.querySelectorAll("[data-notifcourse]").forEach(el=>{
        el.onclick = async ()=>{
          m.close();
          this.currentCourseId = el.dataset.notifcourse;
          await this.renderNav();
          this.go(el.dataset.notifsection);
        };
      });
      return;
    }

    const {data} = await db.from("notifications").select("*").eq("profile_id", this.ctx.user.id).order("created_at",{ascending:false}).limit(20);
    const list = (data||[]).map(n=>`
      <div class="card notifRow" data-notifid="${n.id}" data-notifcourse="${n.course_id||''}" style="${n.is_read?'':'background:rgba(138,111,201,.14)'};cursor:pointer">
        <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:13.5px">${CodeUp.escapeHtml(n.title)}</b><span class="who">${CodeUp.timeAgo(n.created_at)}</span></div>
        <div class="who" style="margin-top:6px">${CodeUp.escapeHtml(n.body||"")}</div>
      </div>`).join("") || `<div class="emptyState">لا توجد إشعارات بعد.</div>`;
    const m = this.modal(`<h3>الإشعارات</h3><div>${list}</div><div style="margin-top:16px;text-align:end"><button class="btn" id="notifCloseBtn">إغلاق</button></div>`);
    m.el.querySelectorAll("[data-notifid]").forEach(row=>{
      row.onclick = async ()=>{
        await db.from("notifications").update({is_read:true}).eq("id", row.dataset.notifid);
        const courseId = row.dataset.notifcourse;
        m.close();
        this.refreshNotifBadge();
        if(courseId && courseId === this.currentCourseId){ this.go("mysquad"); }
        else if(courseId){ CodeUp.toast("هذا الإشعار يخص كورس آخر — بدّل الكورس من القائمة فوق لمتابعته", "info"); }
      };
    });
    m.el.querySelector("#notifCloseBtn").onclick = async ()=>{
      const ids = (data||[]).filter(n=>!n.is_read).map(n=>n.id);
      if(ids.length) await db.from("notifications").update({is_read:true}).in("id", ids);
      this.refreshNotifBadge();
      m.close();
    };
  },

  // عدد الطلبات المعلّقة ذات الصلة بالقسم الحالي المختار (كورس/مجموعة)،
  // يُستخدم كـ badge بجانب اسم القسم بالقائمة الجانبية.
  async pendingCounts(){
    const counts = {};
    if(this.role === "leader"){
      const mySquads = this.ctx.leaderSquads.map(s=>s.squad_id);
      const squadId = this.currentSquadId || mySquads[0];
      if(squadId){
        const {count} = await db.from("squad_join_requests").select("id",{count:"exact",head:true}).eq("squad_id", squadId).eq("status","pending");
        counts.ljoin = count || 0;
      }
      return counts;
    }
    const cid = this.currentCourseId;
    if(!cid) return counts;
    const [{count:jr},{count:la}] = await Promise.all([
      db.from("squad_join_requests").select("id, squads!inner(course_id)",{count:"exact",head:true}).eq("squads.course_id", cid).eq("status","pending"),
      db.from("leader_applications").select("id",{count:"exact",head:true}).eq("course_id", cid).eq("status","pending")
    ]);
    counts.join_requests = jr || 0;
    counts.leader_applications = la || 0;
    return counts;
  },

  async loadAccessibleCourses(){
    let q = db.from("courses").select("*").order("created_at");
    if(this.accessibleCourseIds) q = q.in("id", this.accessibleCourseIds.length ? this.accessibleCourseIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data } = await q;
    this.courses = data || [];
  },

  navConfig(){
    if(this.role === "tech_week_admin"){
      return [{group:"الأسبوع التقني", items:["tech_week_settings","tech_week_events","tech_week_registrations","tech_week_announcements"]}];
    }
    if(this.role === "university_admin"){
      const cfg = [{group:"الجامعة", items:["university"]}];
      if(this.isTechWeekAdmin) cfg.push({group:"الأسبوع التقني", items:["tech_week_settings","tech_week_events","tech_week_registrations","tech_week_announcements"]});
      return cfg;
    }
    const courseOpItems = ["content","squads","join_requests","leader_applications","assignments","submissions","timeline","announcements","progress","files","settings"];
    if(this.role === "super"){
      const courseItems = ["courses","course_admins"];
      if(this.currentCourseId){
        courseItems.push("content","squads","leaders","join_requests","leader_applications","assignments","submissions","timeline","announcements","progress","files","settings");
      }
      return [
        {group:"لوحة التحكم", items:["dashboard"]},
        {group:"الكورسات", items:courseItems, coursePicker:true},
        {group:"الجامعة", items:["universities","university"]},
        {group:"الأسبوع التقني", items:["tech_week_settings","tech_week_events","tech_week_registrations","tech_week_announcements","tech_week_team"]},
        {group:"Marketplace", items:["marketplace_dashboard","marketplace_listings","marketplace_categories","marketplace_reports","marketplace_settings"]},
        {group:"الإعدادات", items:["users","home_announcements","home_posts","message_settings","moderation","audit_log"]}
      ];
    }
    if(this.role === "course_admin"){
      const courseItems = this.currentCourseId ? courseOpItems.slice() : [];
      const cfg = [
        {group:"لوحة التحكم", items:["dashboard"]},
        {group:"الكورسات", items:courseItems, coursePicker:(this.courses||[]).length>1}
      ];
      if(this.isTechWeekAdmin) cfg.push({group:"الأسبوع التقني", items:["tech_week_settings","tech_week_events","tech_week_registrations","tech_week_announcements"]});
      return cfg;
    }
    // leader — القائمة الفعلية للقائد تُبنى عبر leaderNavHtml() وليس هنا
  },

  async renderNav(){
    const root = document.getElementById("navRoot");
    const counts = await this.pendingCounts();
    if(this.role === "leader"){
      const squadId = this.currentSquadId || (this.ctx.leaderSquads[0] && this.ctx.leaderSquads[0].squad_id);
      const myLeaderRow = this.ctx.leaderSquads.find(s=>s.squad_id===squadId);
      const canAddContent = !!(myLeaderRow?.permissions?.can_add_content);
      root.innerHTML = leaderNavHtml(counts, {canAddContent});
      root.querySelectorAll(".navItem").forEach(el=>el.onclick=()=>{ this.go(el.dataset.section); this.closeMobileSidebar?.(); });
      return;
    }
    const cfg = this.navConfig();
    // أقسام قابلة للطي — يفتح تلقائيًا بس القسم اللي فيه الصفحة الحالية، والباقي مطوي
    if(!this.openNavGroup || !cfg.some(g=>g.group===this.openNavGroup)){
      const activeGroup = cfg.find(g=>g.items.includes(this.section));
      this.openNavGroup = activeGroup ? activeGroup.group : (cfg[0] && cfg[0].group);
    }
    let html = "";
    cfg.forEach(group=>{
      const isOpen = group.group === this.openNavGroup;
      html += `<div class="navGroup ${isOpen?"":"collapsed"}">
        <div class="navLabel navLabelToggle" data-grouptoggle="${CodeUp.escapeHtml(group.group)}">
          <span>${group.group}</span><span class="navChevron">${Icon("chevron_down")}</span>
        </div>
        <div class="navGroupBody">`;
      if(group.coursePicker){
        html += `<select id="coursePickerSelect" style="width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#1f2740;color:#fff;margin-bottom:8px">
          <option value="">— اختر كورسًا —</option>
          ${(this.courses||[]).map(c=>`<option value="${c.id}" ${c.id===this.currentCourseId?"selected":""}>${CodeUp.escapeHtml(c.name)}</option>`).join("")}
        </select>`;
      }
      group.items.forEach(key=>{
        const s = this.sections[key];
        if(!s) return;
        const badge = counts[key] ? `<span class="navBadge">${counts[key]}</span>` : "";
        html += `<div class="navItem" data-section="${key}"><span>${s.label}</span>${badge}</div>`;
      });
      html += `</div></div>`;
    });
    root.innerHTML = html;
    const picker = document.getElementById("coursePickerSelect");
    if(picker) picker.onchange = async ()=>{
      this.currentCourseId = picker.value || null;
      this.openNavGroup = "الكورسات";
      await this.renderNav();
      const courseGroup = this.navConfig().find(g=>g.coursePicker);
      const target = (courseGroup && courseGroup.items.includes(this.section))
        ? this.section
        : ((courseGroup && courseGroup.items.find(k=>this.sections[k])) || "courses");
      this.go(target);
    };
    root.querySelectorAll("[data-grouptoggle]").forEach(el=>{
      el.onclick = ()=>{
        const name = el.dataset.grouptoggle;
        if(this.openNavGroup === name){
          this.openNavGroup = null;
          el.closest(".navGroup").classList.add("collapsed");
        } else {
          this.expandNavGroup(name);
        }
      };
    });
    root.querySelectorAll(".navItem").forEach(el=>el.onclick=()=>{ this.go(el.dataset.section); this.closeMobileSidebar?.(); });
  },

  // يفتح مجموعة واحدة بالسايدبار ويطوي البقية، بدون إعادة استعلام العدادات
  expandNavGroup(name){
    this.openNavGroup = name;
    document.querySelectorAll("#navRoot .navGroup").forEach(g=>g.classList.add("collapsed"));
    document.querySelectorAll("#navRoot .navLabelToggle").forEach(lbl=>{
      if(lbl.dataset.grouptoggle === name) lbl.closest(".navGroup").classList.remove("collapsed");
    });
  },

  async go(sectionKey){
    this.section = sectionKey;
    if(this.role !== "leader"){
      const owner = this.navConfig()?.find(g=>g.items.includes(sectionKey));
      if(owner) this.expandNavGroup(owner.group);
    }
    document.querySelectorAll(".navItem").forEach(el=>el.classList.toggle("active", el.dataset.section===sectionKey));
    const body = document.getElementById("pageBody");
    body.innerHTML = `<div class="emptyState">جارِ التحميل…</div>`;

    if(this.role === "leader"){
      this.setBreadcrumb(["مجموعتي", LEADER_SECTION_LABELS[sectionKey] || ""]);
      try{
        await renderLeaderSection(sectionKey, body);
      }catch(e){
        body.innerHTML = `<div class="emptyState">حدث خطأ: ${CodeUp.escapeHtml(e.message||String(e))}</div>`;
      }
      return;
    }

    const s = this.sections[sectionKey];
    if(!s){ body.innerHTML = `<div class="emptyState">القسم غير متاح.</div>`; return; }
    document.getElementById("pageTitle").textContent = s.label;
    const courseName = (COURSE_SCOPED_SECTIONS.has(sectionKey) && this.currentCourseId)
      ? (this.courses||[]).find(c=>c.id===this.currentCourseId)?.name
      : null;
    this.setBreadcrumb([courseName || "لوحة الإدارة", s.label]);
    try{
      await s.render(body);
    }catch(e){
      body.innerHTML = `<div class="emptyState">حدث خطأ: ${CodeUp.escapeHtml(e.message||String(e))}</div>`;
    }
  },

  modal(innerHtml){
    const bg=document.createElement("div");bg.className="modalBg";
    bg.innerHTML=`<div class="modal">${innerHtml}</div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click",e=>{if(e.target===bg)close()});
    function close(){bg.remove();}
    return {close, el:bg};
  },

  // لوحة جانبية (Drawer) — بديل الـ Modal الكبير لعرض تفاصيل عنصر واحد (طالب/كورس/إلخ)
  drawer(innerHtml){
    const bg=document.createElement("div");bg.className="drawerBg";
    const panel=document.createElement("div");panel.className="drawer";panel.innerHTML=innerHtml;
    document.body.appendChild(bg);document.body.appendChild(panel);
    bg.addEventListener("click",close);
    function close(){bg.remove();panel.remove();}
    return {close, el:panel};
  }
};

function roleLabel(r){ return {super:"سوبر أدمن", course_admin:"أدمن كورس", leader:"قائد مجموعة", university_admin:"أدمن جامعة", tech_week_admin:"أدمن الأسبوع التقني"}[r]||r; }

function leaderNavHtml(counts={}, opts={}){
  const items = [
    ["mysquad","مجموعتي"],["members","الأعضاء"],["ljoin","طلبات الانضمام"],
    ["lassignments","الواجبات"]
  ];
  if(opts.canAddContent) items.push(["lcontent","المحتوى التعليمي"]);
  items.push(["lsubmissions","التسليمات"],["ltimeline","المستجدات"],["lactivity","النشاط"],["lprogress","التقدم"]);
  return `<div class="navGroup"><div class="navLabel">مجموعتي</div>` +
    items.map(([k,l])=>{
      const badge = counts[k] ? `<span class="navBadge">${counts[k]}</span>` : "";
      return `<div class="navItem" data-section="${k}"><span>${l}</span>${badge}</div>`;
    }).join("") +
    `</div>`;
}
