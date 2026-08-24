// admin/js/app.js
const HOME_SENTINEL = "__home__";
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
    document.getElementById("notifBtn").onclick = ()=>this.openNotifications();
    this.refreshNotifBadge();
    CodeUp.subscribeToMyNotifications(this.ctx.user.id, (n)=>{ this.refreshNotifBadge(); CodeUp.toast(n.title, "info"); });

    await this.loadAccessibleCourses();
    await this.renderNav();
    this.go(this.role === "leader" ? "mysquad" : "dashboard");
  },

  async refreshNotifBadge(){
    const {count} = await db.from("notifications").select("id",{count:"exact",head:true}).eq("profile_id", this.ctx.user.id).eq("is_read", false);
    const badge = document.getElementById("notifBadge");
    if(!badge) return;
    if(count>0){ badge.textContent = count>9?"9+":count; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
  },

  async openNotifications(){
    const {data} = await db.from("notifications").select("*").eq("profile_id", this.ctx.user.id).order("created_at",{ascending:false}).limit(20);
    const list = (data||[]).map(n=>`
      <div class="card" style="${n.is_read?'':'background:rgba(138,111,201,.14)'}">
        <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:13.5px">${CodeUp.escapeHtml(n.title)}</b><span class="who">${CodeUp.timeAgo(n.created_at)}</span></div>
        <div class="who" style="margin-top:6px">${CodeUp.escapeHtml(n.body||"")}</div>
      </div>`).join("") || `<div class="emptyState">لا توجد إشعارات بعد.</div>`;
    const m = this.modal(`<h3>الإشعارات</h3><div>${list}</div><div style="margin-top:16px;text-align:end"><button class="btn" id="notifCloseBtn">إغلاق</button></div>`);
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
    if(!cid || cid === HOME_SENTINEL) return counts;
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
    if(this.currentCourseId === HOME_SENTINEL){
      return [{group:"الصفحة الرئيسية", items:["home_announcements"]}];
    }
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
      root.querySelectorAll(".navItem").forEach(el=>el.onclick=()=>this.go(el.dataset.section));
      return;
    }
    const cfg = this.navConfig();
    let html = "";
    if(this.role === "super" || (this.courses && this.courses.length > 1)){
      html += `<div class="navGroup"><div class="navLabel">الكورس</div>
        <select id="courseSwitcher" style="width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#1f2740;color:#fff">
          ${this.role==="super"?`<option value="${HOME_SENTINEL}" ${this.currentCourseId===HOME_SENTINEL?"selected":""}>🏠 الصفحة الرئيسية</option>`:""}
          ${this.courses.map(c=>`<option value="${c.id}" ${c.id===this.currentCourseId?"selected":""}>${CodeUp.escapeHtml(c.name)}</option>`).join("")}
        </select></div>`;
    }
    cfg.forEach(group=>{
      html += `<div class="navGroup"><div class="navLabel">${group.group}</div>`;
      group.items.forEach(key=>{
        const s = this.sections[key];
        if(!s) return;
        const badge = counts[key] ? `<span class="navBadge">${counts[key]}</span>` : "";
        html += `<div class="navItem" data-section="${key}"><span>${s.label}</span>${badge}</div>`;
      });
      html += `</div>`;
    });
    root.innerHTML = html;
    const switcher = document.getElementById("courseSwitcher");
    if(switcher) switcher.onchange = async ()=>{
      this.currentCourseId = switcher.value;
      await this.renderNav();
      const firstSection = this.navConfig().flatMap(g=>g.items).find(k=>this.sections[k]);
      this.go(firstSection || this.section);
    };
    root.querySelectorAll(".navItem").forEach(el=>el.onclick=()=>this.go(el.dataset.section));
  },

  async go(sectionKey){
    this.section = sectionKey;
    document.querySelectorAll(".navItem").forEach(el=>el.classList.toggle("active", el.dataset.section===sectionKey));
    const body = document.getElementById("pageBody");
    body.innerHTML = `<div class="emptyState">جارِ التحميل…</div>`;

    if(this.role === "leader"){
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
