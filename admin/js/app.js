// admin/js/app.js
const Admin = {
  ctx: null,          // من CodeUp.loadMyContext()
  role: null,         // 'super' | 'course_admin' | 'leader'
  accessibleCourseIds: [], // الكورسات التي يحق له إدارتها بأي صفة
  currentCourseId: null,
  currentSquadId: null, // لواجهة القائد (مقيّد بمجموعاته)
  section: "dashboard",
  sections: {}, // يُعبّأ من ملفات admin/js/*.js الأخرى: {key:{label,icon,scope,render}}

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

    if(!isSuper && !courseAdminIds.length && !leaderCourseIds.length){
      document.getElementById("gate").innerHTML =
        `<div style="text-align:center;font-family:system-ui"><h2>لا تملك صلاحية دخول لوحة الإدارة</h2>
         <p><a href="../index.html">العودة لتطبيق الطالب</a></p></div>`;
      return;
    }

    // 6) حدد Dashboard المناسب حسب الصلاحية الأعلى
    if(isSuper) this.role = "super";
    else if(courseAdminIds.length) this.role = "course_admin";
    else this.role = "leader";

    this.accessibleCourseIds = isSuper ? null /* كل الكورسات */
      : [...new Set([...courseAdminIds, ...leaderCourseIds])];

    this.currentCourseId = (this.accessibleCourseIds && this.accessibleCourseIds[0]) || null;
    if(this.role === "leader" && this.ctx.leaderSquads.length){
      this.currentSquadId = this.ctx.leaderSquads[0].squad_id;
    }

    document.getElementById("gate").classList.add("hidden");
    document.getElementById("shell").classList.remove("hidden");
    document.getElementById("whoLabel").textContent =
      `${this.ctx.profile.full_name || this.ctx.user.email} — ${roleLabel(this.role)}`;
    document.getElementById("backToApp").href = "../index.html";
    document.getElementById("signOut").onclick = async (e)=>{ e.preventDefault(); await db.auth.signOut(); window.location.href="../index.html"; };

    await this.loadAccessibleCourses();
    this.renderNav();
    this.go(this.role === "leader" ? "mysquad" : "dashboard");
  },

  async loadAccessibleCourses(){
    let q = db.from("courses").select("*").order("created_at");
    if(this.accessibleCourseIds) q = q.in("id", this.accessibleCourseIds.length ? this.accessibleCourseIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data } = await q;
    this.courses = data || [];
  },

  navConfig(){
    if(this.role === "super"){
      return [
        {group:"عام", items:["dashboard"]},
        {group:"المنصة", items:["courses","users","course_admins"]},
        {group:"الكورس الحالي", items:["content","squads","leaders","join_requests","leader_applications","assignments","submissions","timeline","announcements","progress"]},
        {group:"النظام", items:["files","moderation","audit_log","settings"]}
      ];
    }
    if(this.role === "course_admin"){
      return [
        {group:"الكورس", items:["dashboard","content","squads","join_requests","leader_applications","assignments","submissions","timeline","announcements","progress","files","settings"]}
      ];
    }
    // leader
    return [
      {group:"مجموعتي", items:["myszquad_placeholder"]} // مُستبدلة أدناه بـ mysquad أدوات
    ];
  },

  renderNav(){
    const root = document.getElementById("navRoot");
    if(this.role === "leader"){
      root.innerHTML = leaderNavHtml();
      root.querySelectorAll(".navItem").forEach(el=>el.onclick=()=>this.go(el.dataset.section));
      return;
    }
    const cfg = this.navConfig();
    let html = "";
    if(this.courses && this.courses.length > 1){
      html += `<div class="navGroup"><div class="navLabel">الكورس</div>
        <select id="courseSwitcher" style="width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#1f2740;color:#fff">
          ${this.courses.map(c=>`<option value="${c.id}" ${c.id===this.currentCourseId?"selected":""}>${CodeUp.escapeHtml(c.name)}</option>`).join("")}
        </select></div>`;
    }
    cfg.forEach(group=>{
      html += `<div class="navGroup"><div class="navLabel">${group.group}</div>`;
      group.items.forEach(key=>{
        const s = this.sections[key];
        if(!s) return;
        html += `<div class="navItem" data-section="${key}"><span>${s.label}</span></div>`;
      });
      html += `</div>`;
    });
    root.innerHTML = html;
    const switcher = document.getElementById("courseSwitcher");
    if(switcher) switcher.onchange = ()=>{ this.currentCourseId = switcher.value; this.go(this.section); };
    root.querySelectorAll(".navItem").forEach(el=>el.onclick=()=>this.go(el.dataset.section));
  },

  async go(sectionKey){
    this.section = sectionKey;
    document.querySelectorAll(".navItem").forEach(el=>el.classList.toggle("active", el.dataset.section===sectionKey));
    const body = document.getElementById("pageBody");
    body.innerHTML = `<div class="emptyState">جارِ التحميل…</div>`;

    if(this.role === "leader"){
      return renderLeaderSection(sectionKey, body);
    }

    const s = this.sections[sectionKey];
    if(!s){ body.innerHTML = `<div class="emptyState">القسم غير متاح.</div>`; return; }
    document.getElementById("pageTitle").textContent = s.label;
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
  }
};

function roleLabel(r){ return {super:"سوبر أدمن", course_admin:"أدمن كورس", leader:"قائد مجموعة"}[r]||r; }

function leaderNavHtml(){
  const items = [
    ["mysquad","مجموعتي"],["members","الأعضاء"],["ljoin","طلبات الانضمام"],
    ["lassignments","الواجبات"],["lsubmissions","التسليمات"],["ltimeline","المستجدات"],
    ["lactivity","النشاط"],["lprogress","التقدم"]
  ];
  return `<div class="navGroup"><div class="navLabel">مجموعتي</div>` +
    items.map(([k,l])=>`<div class="navItem" data-section="${k}"><span>${l}</span></div>`).join("") +
    `</div>`;
}
