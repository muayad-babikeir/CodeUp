// js/shared.js
// دوال مشتركة بين تطبيق الطالب ولوحة الإدارة.
// يعتمد على وجود `db` من js/supabase.js في نفس الصفحة قبل هذا الملف.

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
  async function uploadSubmissionFile(file, userId, submissionId) {
    const cleanName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${userId}/${submissionId}/${Date.now()}_${cleanName}`;
    const { error } = await db.storage.from("submissions").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
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
