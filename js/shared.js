// js/shared.js
// دوال مشتركة بين تطبيق الطالب ولوحة الإدارة.
// يعتمد على وجود `db` من js/supabase.js في نفس الصفحة قبل هذا الملف.

function Icon(name){
  const paths = {
    learning: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    assignments: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    timeline: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5"/>',
    squads: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    progress: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    leaderboard: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3a2 2 0 0 1-2 4h-1"/><path d="M7 5H4a2 2 0 0 0 2 4h1"/>',
    announcement: '<path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 4.5V5.5L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a4 4 0 0 1 0 8"/><path d="M17 5a8 8 0 0 1 0 14"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    archive: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]||''}</svg>`;
}

// بطاقة ملف بنمط "معاينة عند الطلب": نعرض الاسم/النوع/الحجم فورًا بدون أي تحميل فعلي،
// ولا نطلب رابط المعاينة من Supabase إلا لما يضغط المستخدم "معاينة" — يقلل الحمل والاستهلاك.
function renderFileCard(f, bucket){
  const sizeLabel = f.file_size ? `${(f.file_size/1024).toFixed(0)} ك.ب` : "";
  const isImage = (f.mime_type||"").startsWith("image/");
  if(f.archive_status === "archived"){
    const link = f.telegram_chat_id && f.telegram_message_id
      ? `https://t.me/c/${String(f.telegram_chat_id).replace(/^-100/,"")}/${f.telegram_message_id}`
      : null;
    return `<div class="fileCard archived" data-filecard="${f.id}">
      <span class="tabIcon">${Icon("archive")}</span>
      <div class="fileCardInfo"><b>${CodeUp.escapeHtml(f.file_name||"ملف")}</b><span class="small">أُرشف — ${sizeLabel}</span></div>
      ${link?`<a class="btn" href="${link}" target="_blank">شاهد في تيليجرام ↗</a>`:`<span class="small">غير متاح حاليًا</span>`}
    </div>`;
  }
  return `<div class="fileCard" data-filecard="${f.id}">
    <span class="tabIcon">${Icon(isImage?"eye":"file")}</span>
    <div class="fileCardInfo"><b>${CodeUp.escapeHtml(f.file_name||"ملف")}</b><span class="small">${isImage?"صورة":"ملف"}${sizeLabel?" — "+sizeLabel:""}</span></div>
    <button class="btn" data-previewfile="${f.id}" data-bucket="${bucket}" data-path="${CodeUp.escapeHtml(f.storage_path)}" data-isimage="${isImage}">معاينة</button>
  </div>`;
}
function wireFileCardPreviews(container){
  container.querySelectorAll("[data-previewfile]").forEach(btn=>{
    btn.onclick = async ()=>{
      const card = btn.closest(".fileCard");
      btn.disabled = true; btn.textContent = "جارِ التحميل…";
      try{
        const url = await CodeUp.getSignedUrl(btn.dataset.bucket, btn.dataset.path, 3600);
        if(btn.dataset.isimage === "true"){
          card.insertAdjacentHTML("beforeend", `<img src="${url}" style="max-width:100%;border-radius:10px;margin-top:8px;display:block">`);
          btn.remove();
        }else{
          window.open(url, "_blank");
          btn.disabled = false; btn.textContent = "معاينة";
        }
      }catch(e){ CodeUp.toast("تعذّر تحميل الملف", "error"); btn.disabled = false; btn.textContent = "معاينة"; }
    };
  });
}

function youtubeIdFromUrl(url){
  const m = String(url||"").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}
function youtubeEmbedHtml(url){
  const id = youtubeIdFromUrl(url);
  if(!id){
    return `<a class="btn" style="margin-top:6px;display:inline-block" href="${url}" target="_blank">فتح رابط الفيديو ↗</a>`;
  }
  return `<div class="videoEmbed" data-yt="${id}">
    <img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="video thumbnail" loading="lazy">
    <div class="playBtn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
  </div>`;
}
function wireYoutubeEmbeds(container){
  container.querySelectorAll("[data-yt]").forEach(el=>{
    el.querySelector(".playBtn").onclick = ()=>{
      el.innerHTML = `<iframe src="https://www.youtube.com/embed/${el.dataset.yt}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    };
  });
}

const CodeUp = (() => {

  // ---------- Toast / رسائل ----------
  function ensureToastHost() {
    let host = document.getElementById("cu-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "cu-toast-host";
      host.style.cssText = "position:fixed;bottom:16px;inset-inline-end:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:320px";
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, type = "info") {
    const host = ensureToastHost();
    const el = document.createElement("div");
    const colors = { info: "#1A1A1A", success: "#3DD16F", error: "#F2555F", warn: "#1A1A1A" };
    const textColors = { info: "#fff", success: "#06210F", error: "#fff", warn: "#fff" };
    el.textContent = message;
    el.style.cssText = `background:${colors[type] || colors.info};color:${textColors[type] || textColors.info};border:1px solid rgba(255,255,255,.15);padding:12px 16px;border-radius:10px;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.4);animation:cuFadeIn .2s ease`;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 4200);
  }

  // ---------- Utils ----------
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "الآن";
    if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
    if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
    if (diff < 2592000) return `منذ ${Math.floor(diff / 86400)} يوم`;
    return new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
  }

  function debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Auth guard ----------
  async function requireSession(redirectTo = "index.html") {
    const { data } = await db.auth.getSession();
    if (!data.session) {
      window.location.href = redirectTo;
      return null;
    }
    return data.session;
  }

  // ---------- Role / context resolution ----------
  // يبني صورة كاملة لصلاحيات المستخدم الحالي: سوبر أدمن؟ أدمن أي كورسات؟
  // قائد أي مجموعات (وفي أي كورسات)؟ مسجل في أي كورسات (وبأي مجموعة)؟
  async function loadMyContext() {
    const { data: sessionData } = await db.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return null;

    const [{ data: profile }, { data: courseAdmins }, { data: squadLeaders }, { data: enrollments }] = await Promise.all([
      db.from("profiles").select("*").eq("id", user.id).single(),
      db.from("course_admins").select("course_id, role").eq("profile_id", user.id),
      db.from("squad_leaders").select("squad_id, permissions, squads(course_id, name)").eq("profile_id", user.id),
      db.from("enrollments").select("*, courses(name, slug), squads(name, emoji)").eq("profile_id", user.id)
    ]);

    return {
      user,
      profile: profile || { id: user.id, full_name: user.user_metadata?.full_name || "", email: user.email, is_super_admin: false },
      isPlatformAdmin: !!profile?.is_super_admin,
      courseAdminCourseIds: (courseAdmins || []).map(c => c.course_id),
      courseAdmins: courseAdmins || [],
      leaderSquads: squadLeaders || [],
      leaderCourseIds: [...new Set((squadLeaders || []).map(s => s.squads?.course_id).filter(Boolean))],
      enrollments: enrollments || []
    };
  }

  // ---------- RPC wrappers (كل عملية حساسة تمر عبر Database Function) ----------
  async function call(fnName, params = {}) {
    const { data, error } = await db.rpc(fnName, params);
    if (error) throw error;
    return data;
  }

  const rpc = {
    enrollInCourse: (courseId) => call("enroll_in_course", { p_course_id: courseId }),
    requestJoinSquad: (squadId, message) => call("request_join_squad", { p_squad_id: squadId, p_message: message || null }),
    cancelJoinRequest: (requestId) => call("cancel_join_request", { p_request_id: requestId }),
    approveJoinRequest: (requestId) => call("approve_join_request", { p_request_id: requestId }),
    rejectJoinRequest: (requestId, reason) => call("reject_join_request", { p_request_id: requestId, p_reason: reason }),

    applyForLeader: (courseId, squadId, message, experience) =>
      call("apply_for_leader", { p_course_id: courseId, p_squad_id: squadId || null, p_message: message || null, p_experience: experience || null }),
    approveLeaderApplication: (appId, squadId) => call("approve_leader_application", { p_application_id: appId, p_squad_id: squadId }),
    rejectLeaderApplication: (appId, reason) => call("reject_leader_application", { p_application_id: appId, p_reason: reason }),

    addComment: (submissionId, content, parentId) => call("add_comment", { p_submission_id: submissionId, p_content: content, p_parent_id: parentId || null }),
    toggleReaction: (targetType, targetId, reactionType) => call("toggle_reaction", { p_target_type: targetType, p_target_id: targetId, p_reaction_type: reactionType || "like" }),

    reviewSubmission: (submissionId, grade, notes) => call("review_submission", { p_submission_id: submissionId, p_grade: grade, p_notes: notes || null }),
    createAnnouncement: (courseId, title, content, targetSquadId) => call("create_announcement", { p_course_id: courseId, p_title: title, p_content: content || null, p_target_squad_id: targetSquadId || null })
  };

  // ---------- Storage helpers ----------
  // ضغط وتصغير الصور قبل الرفع (WebP، أقصى بُعد 1600px، جودة 80%)
  async function compressImageIfNeeded(file) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1600;
      let { width, height } = bitmap;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(res => canvas.toBlob(res, "image/webp", 0.8));
      if (!blob || blob.size >= file.size) return file; // لو الضغط ما أفاد، نرجع الأصلي
      const newName = file.name.replace(/\.[^.]+$/, "") + ".webp";
      return new File([blob], newName, { type: "image/webp" });
    } catch (e) { return file; } // أي فشل بالضغط، نرفع الأصلي بدل ما نوقف الطالب
  }

  const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 ميجابايت كحد أقصى بعد الضغط

  async function uploadSubmissionFile(file, userId, submissionId) {
    const processed = await compressImageIfNeeded(file);
    if (processed.size > MAX_FILE_BYTES) {
      throw new Error(`حجم الملف كبير جدًا (${(processed.size/1024/1024).toFixed(1)} ميجا). الحد الأقصى 8 ميجابايت.`);
    }
    const cleanName = processed.name.replace(/[^\w.\-]+/g, "_");
    const path = `${userId}/${submissionId}/${Date.now()}_${cleanName}`;
    const { error } = await db.storage.from("submissions").upload(path, processed, { upsert: false });
    if (error) throw error;
    return { path, size: processed.size, type: processed.type, name: processed.name };
  }

  async function getSignedUrl(bucket, path, expiresIn = 3600) {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }

  // ---------- Realtime ----------
  // يعتمد على أن جدول notifications محمي بـ RLS (select: profile_id = auth.uid()),
  // فالاشتراك آمن بشكل افتراضي — المستخدم لا يستقبل إلا إشعاراته هو.
  function subscribeToMyNotifications(userId, onInsert) {
    return db.channel("notif-" + userId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${userId}` },
        (payload) => onInsert(payload.new))
      .subscribe();
  }

  return { toast, escapeHtml, timeAgo, formatDate, debounce, requireSession, loadMyContext, rpc, call, uploadSubmissionFile, getSignedUrl, subscribeToMyNotifications };
})();
