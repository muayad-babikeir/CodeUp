
const authApp=document.getElementById("authApp"),dash=document.getElementById("dashboardApp"),bootScreen=document.getElementById("bootScreen"),form=document.getElementById("authForm"),msg=document.getElementById("message"),btn=document.getElementById("submitBtn");
function hideBoot(){ bootScreen.classList.add("hidden"); }
document.getElementById("authFooterYear").textContent = `© ${new Date().getFullYear()} CodeUp`;
let mode="login";
function setMode(m){mode=m;loginTab.classList.toggle("active",m==="login");signupTab.classList.toggle("active",m==="signup");nameGroup.classList.toggle("hidden",m!=="signup");btn.querySelector(".btnText").textContent=m==="signup"?"إنشاء الحساب":"تسجيل الدخول";msg.className="message"}
function message(t,c="error"){msg.textContent=t;msg.className="message show "+c}
loginTab.onclick=()=>setMode("login");signupTab.onclick=()=>setMode("signup");
const pwdInput=document.getElementById("password"),pwdToggle=document.getElementById("pwdToggle");
pwdToggle.onclick=()=>{const show=pwdInput.type==="password";pwdInput.type=show?"text":"password";pwdToggle.classList.toggle("show",show);pwdToggle.setAttribute("aria-label",show?"إخفاء كلمة المرور":"إظهار كلمة المرور")};

function cleanEmail(raw){
  return raw.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g,"").trim();
}

form.onsubmit=async e=>{
  e.preventDefault();btn.disabled=true;btn.classList.add("loading");msg.className="message";
  try{
    let email=cleanEmail(document.getElementById("email").value),password=document.getElementById("password").value;
    if(mode==="signup"){
      let name=fullName.value.trim();if(!name){message("اكتب اسمك أولاً.");btn.disabled=false;btn.classList.remove("loading");return}
      let{data,error}=await db.auth.signUp({email,password,options:{data:{full_name:name}}});
      if(error)throw error;
      if(data.session)await bootApp(data.user);else message("تم إنشاء الحساب. تحقق من بريدك الإلكتروني إذا كان تأكيد البريد مفعلاً.","success");
    }else{
      let{data,error}=await db.auth.signInWithPassword({email,password});
      if(error)throw error;
      await bootApp(data.user);
    }
  }catch(e){message(e.message||"حدث خطأ غير متوقع")}
  finally{btn.disabled=false;btn.classList.remove("loading")}
};
logoutBtn.onclick=()=>App.logout();

// ===== استعادة كلمة المرور (لا تمس signInWithPassword/signUp أعلاه إطلاقًا) =====
const resetRequestForm=document.getElementById("resetRequestForm"),newPasswordForm=document.getElementById("newPasswordForm");
const resetRequestMsg=document.getElementById("resetRequestMsg"),newPasswordMsg=document.getElementById("newPasswordMsg");
const resetSendBtn=document.getElementById("resetSendBtn"),newPasswordBtn=document.getElementById("newPasswordBtn");

function showAuthScreen(which){
  form.classList.toggle("hidden", which!=="login");
  document.getElementById("forgotPwdRow").classList.toggle("hidden", which!=="login");
  document.querySelector(".tabs").classList.toggle("hidden", which!=="login");
  document.getElementById("googleAuthRow").classList.toggle("hidden", which!=="login");
  document.getElementById("githubAuthRow").classList.toggle("hidden", which!=="login");
  document.getElementById("googleAuthDivider").classList.toggle("hidden", which!=="login");
  msg.className="message";
  resetRequestForm.classList.toggle("hidden", which!=="reset");
  resetRequestMsg.className="message";
  newPasswordForm.classList.toggle("hidden", which!=="newpassword");
  newPasswordMsg.className="message";
  document.getElementById("confirmedScreen").classList.toggle("hidden", which!=="confirmed");
  document.getElementById("pwdChangedScreen").classList.toggle("hidden", which!=="pwdchanged");
}
document.getElementById("forgotPwdLink").onclick=()=>showAuthScreen("reset");
document.getElementById("backToLoginLink").onclick=()=>showAuthScreen("login");
document.getElementById("goToLoginAfterResetBtn").onclick=()=>showAuthScreen("login");

resetRequestForm.onsubmit=async e=>{
  e.preventDefault();
  resetSendBtn.disabled=true;resetSendBtn.classList.add("loading");resetRequestMsg.className="message";
  try{
    const email=cleanEmail(document.getElementById("resetEmail").value);
    await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  }catch(e){ /* نتجاهل الخطأ بصمت عمدًا — ما نكشف هل البريد مسجّل أم لا */ }
  // نفس الرسالة دايمًا بغض النظر عن وجود البريد من عدمه (أمان)
  resetRequestMsg.textContent="لو هذا البريد مسجّل عندنا، وصلته رسالة فيها رابط استعادة كلمة المرور.";
  resetRequestMsg.className="message show success";
  resetSendBtn.disabled=false;resetSendBtn.classList.remove("loading");
};

newPasswordForm.onsubmit=async e=>{
  e.preventDefault();
  const p1=document.getElementById("newPassword").value, p2=document.getElementById("newPassword2").value;
  if(p1!==p2){ newPasswordMsg.textContent="كلمتا المرور غير متطابقتين"; newPasswordMsg.className="message show error"; return; }
  newPasswordBtn.disabled=true;newPasswordBtn.classList.add("loading");newPasswordMsg.className="message";
  try{
    const {error}=await db.auth.updateUser({password:p1});
    if(error) throw error;
    await db.auth.signOut();
    showAuthScreen("pwdchanged");
  }catch(e){ newPasswordMsg.textContent=e.message||"تعذّر تحديث كلمة المرور"; newPasswordMsg.className="message show error"; }
  finally{ newPasswordBtn.disabled=false;newPasswordBtn.classList.remove("loading"); }
};

// Supabase يفعّل جلسة استعادة مؤقتة ويطلق هذا الحدث لما الطالب يفتح رابط الاستعادة من بريده
let isPasswordRecoveryFlow = location.hash.includes("type=recovery");
// نتحقق من شكلين مختلفين لرابط تأكيد التسجيل حسب إعداد المشروع (hash قديم أو PKCE بـ query جديد)
const urlParams = new URLSearchParams(location.search);
const isSignupConfirmFlow =
  location.hash.includes("type=signup") || location.hash.includes("type=email_change") || location.hash.includes("type=invite") ||
  urlParams.get("type") === "signup" || urlParams.get("type") === "email_change" || urlParams.get("type") === "invite" ||
  (urlParams.has("code") && !isPasswordRecoveryFlow); // رابط PKCE ما بيحدد النوع أحيانًا — وجود code وحده كافٍ كإشارة تأكيد
db.auth.onAuthStateChange((event, session)=>{
  if(event === "PASSWORD_RECOVERY"){
    isPasswordRecoveryFlow = true;
    hideBoot();
    authApp.classList.remove("hidden"); dash.classList.add("hidden");
    showAuthScreen("newpassword");
  }
});

// بعد تأكيد البريد، ما نسجّل الدخول تلقائيًا — نفس سلوك "تم تغيير كلمة المرور":
// نخرج من أي جلسة مؤقتة أنشأها رابط التأكيد ونوديه لصفحة تسجيل الدخول العادية.
document.getElementById("goToAppBtn").onclick=async()=>{
  await db.auth.signOut();
  showAuthScreen("login");
};

// ===== تسجيل الدخول عبر Google (Supabase Auth + Google OAuth) =====
const googleAuthBtn=document.getElementById("googleAuthBtn");
googleAuthBtn.onclick=async()=>{
  googleAuthBtn.disabled=true;googleAuthBtn.classList.add("loading");
  try{
    const {error}=await db.auth.signInWithOAuth({
      provider:"google",
      options:{ redirectTo: window.location.origin + window.location.pathname }
    });
    // عند النجاح، المتصفح يُحوَّل فورًا لصفحة Google — ما وصلنا هنا إلا لو صار خطأ قبل التحويل
    if(error) throw error;
  }catch(e){
    message(e.message||"تعذّر بدء تسجيل الدخول عبر Google");
    googleAuthBtn.disabled=false;googleAuthBtn.classList.remove("loading");
  }
};

// ===== تسجيل الدخول عبر GitHub (Supabase Auth + GitHub OAuth) — نفس منطق Google بالضبط =====
const githubAuthBtn=document.getElementById("githubAuthBtn");
githubAuthBtn.onclick=async()=>{
  githubAuthBtn.disabled=true;githubAuthBtn.classList.add("loading");
  try{
    const {error}=await db.auth.signInWithOAuth({
      provider:"github",
      options:{ redirectTo: window.location.origin + window.location.pathname }
    });
    if(error) throw error;
  }catch(e){
    message(e.message||"تعذّر بدء تسجيل الدخول عبر GitHub");
    githubAuthBtn.disabled=false;githubAuthBtn.classList.remove("loading");
  }
};

// رجوع Google لنا وهو حامل خطأ (مثلاً المستخدم ألغى تسجيل الدخول) بيجي كـ query/hash فيه error
(function checkOAuthError(){
  const hashParams=new URLSearchParams(location.hash.replace(/^#/,""));
  const errDesc=urlParams.get("error_description")||hashParams.get("error_description")||urlParams.get("error")||hashParams.get("error");
  if(errDesc){
    message(decodeURIComponent(errDesc).replace(/\+/g," "));
    history.replaceState(null,"",window.location.pathname);
  }
})();

(async()=>{
  if(window.__earlyLoginShown) return; // اتعرض اللوجين بالفعل من الفحص المبكر فوق
  try{
    let{data}=await db.auth.getSession();
    // تسجيل دخول Google (أو أي مزوّد خارجي) يمرّ برابط PKCE فيه ?code= هو نفسه، لكن ما هو
    // "تأكيد بريد" — نفرّق بينهم عبر app_metadata.provider في الجلسة الراجعة.
    const provider = data.session?.user?.app_metadata?.provider;
    const isOAuthLogin = !!provider && provider !== "email";
    if(data.session && isOAuthLogin && !isPasswordRecoveryFlow){
      history.replaceState(null,"",window.location.pathname);
      await bootApp(data.session.user);
    }else if(data.session && isSignupConfirmFlow && !isPasswordRecoveryFlow){
      showAuthScreen("confirmed");
      authApp.classList.remove("hidden");
      history.replaceState(null,"",window.location.pathname);
      hideBoot();
    }else if(data.session && !isPasswordRecoveryFlow){
      await bootApp(data.session.user);
    }else if(!data.session && !isPasswordRecoveryFlow){
      // ما فيش Session خالص — دلوقتي بس، بعد التأكد الكامل، نظهر شاشة الدخول.
      // (حالة isPasswordRecoveryFlow بيتكفّل بيها حدث PASSWORD_RECOVERY تحت)
      authApp.classList.remove("hidden");
      hideBoot();
    }
  }catch(e){
    // فشل التحقق من الجلسة (شبكة بطيئة/خطأ) — ما نسيب المستخدم عالق على شاشة
    // البووت للأبد، نوديه لتسجيل الدخول العادي بدل ما يفضل شايف اللوجو بس.
    authApp.classList.remove("hidden");
    hideBoot();
  }
})();

// شبكة أمان: بعض المتصفحات/الحالات تُطلق SIGNED_IN بعد أن يكون التحميل الأول قد انتهى
// (مثلاً تأخّر معالجة hash الخاص بـ OAuth). لا يكرر bootApp لو التطبيق ظاهر أصلًا.
db.auth.onAuthStateChange((event, session)=>{
  if(event === "SIGNED_IN" && session && dash.classList.contains("hidden") && authApp.classList.contains("hidden")===false){
    const provider = session.user?.app_metadata?.provider;
    if(provider && provider !== "email" && !isPasswordRecoveryFlow){
      history.replaceState(null,"",window.location.pathname);
      bootApp(session.user);
    }
  }
});

async function bootApp(user){
  hideBoot();
  authApp.classList.add("hidden");dash.classList.remove("hidden");
  await App.init(user);
}

// يحدد "الدرس الحالي" (أول درس غير مكتمل بترتيب الوحدات ثم الدروس) — مصدر واحد
// لهذا المنطق يُستخدم بكل من قائمة المحتوى وصفحة الدرس المستقلة، بدل تكراره
function computeCurrentLesson(sortedUnits, doneSet){
  let currentLessonId = null;
  outer: for(const u of sortedUnits){
    for(const l of u.lessons){
      if(!doneSet.has(l.id)){ currentLessonId = l.id; break outer; }
    }
  }
  const currentUnitId = currentLessonId
    ? sortedUnits.find(u=>u.lessons.some(l=>l.id===currentLessonId))?.id
    : (sortedUnits[0]?.id ?? null);
  return {currentLessonId, currentUnitId};
}
function lessonContentType(l){
  if(l.video_url) return {label:"فيديو", icon:"play"};
  if(l.text_content) return {label:"قراءة", icon:"learning"};
  if(l.pdf_url) return {label:"PDF", icon:"file"};
  return {label:"محتوى", icon:"file"};
}

// ===== مصادر التعلّم (patch_54) — بطاقات متساوية تُفتح خارج CodeUp، بدون مشغّل مضمَّن =====
function lpTypeIcon(t){
  return ({youtube_video:"play", youtube_course:"play", pdf:"file", article:"file", docs:"file", anki:"download", telegram:"paperclip"})[t] || "link";
}
function lpSafeUrl(r){
  let u = String(r.url||"");
  if(!/^https?:\/\//i.test(u)) return "#";
  if((r.type==="youtube_video"||r.type==="youtube_course") && r.start_at){
    try{ const x = new URL(u); x.searchParams.set("t", r.start_at+"s"); u = x.toString(); }catch(_e){}
  }
  return u;
}
const LP_TYPE_LABEL = {youtube_video:"فيديو", youtube_course:"دورة", article:"مقال", docs:"توثيق", pdf:"PDF", website:"موقع", interactive:"تفاعلي", github:"GitHub", external_course:"دورة خارجية", anki:"بطاقات", telegram:"تيليجرام"};
const LP_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
function lpLang(l){ return ({ar:"عربي", en:"English"})[l] || ""; }
function lpDur(r){ return r.duration_minutes ? `${r.duration_minutes} د` : ""; }
// صف مصدر: الصف كله رابط يُفتح خارج CodeUp. opts.sub يستبدل السطر الفرعي (للمراجع الثابتة PDF/Anki)
function lpRow(r){
  const esc = CodeUp.escapeHtml;
  const sub = r._sub !== undefined ? r._sub : [r.publisher, lpDur(r)].filter(Boolean).join(" · ");
  const pill = lpLang(r.language);
  return `<a class="lpRow" href="${esc(lpSafeUrl(r))}" target="_blank" rel="noopener noreferrer">
    <span class="lpIc lpIc-${r.type==="youtube_video"||r.type==="youtube_course"?"play":"other"}">${Icon(lpTypeIcon(r.type))}</span>
    <span class="lpT"><b>${esc(r.title)}</b>${sub?`<span class="small">${esc(sub)}</span>`:""}</span>
    ${pill?`<span class="lpPill">${pill}</span>`:""}
    <span class="lpChev">${LP_CHEV}</span>
  </a>`;
}
// المصدر الأساسي: بطاقة كبيرة (هي نفسها رابط)
function lpPrimary(r){
  const esc = CodeUp.escapeHtml;
  const meta = [r.publisher, lpLang(r.language), LP_TYPE_LABEL[r.type], lpDur(r)].filter(Boolean).join(" · ");
  return `<a class="card2 lpPrimary" href="${esc(lpSafeUrl(r))}" target="_blank" rel="noopener noreferrer">
    <span class="lpStar">★ المصدر الأساسي</span>
    <b class="lpPrimaryTitle">${esc(r.title)}</b>
    ${meta?`<span class="small">${esc(meta)}</span>`:""}
  </a>`;
}

// أقسام المصادر المشتركة بين صفحة الدرس وصفحة مادة University:
// المصدر الأساسي، مصادر بديلة (+عرض المزيد)، الشرح المكتوب، تعمّق (قابل للطي)، للمذاكرة.
// o = {rec, alts, text, deep, study, note, emptyText}
function lpSectionsHtml(o){
  const esc = CodeUp.escapeHtml;
  const alts = o.alts || [], deep = o.deep || [], study = o.study || [];
  const extra = Math.max(0, alts.length - 2);
  const empty = !o.rec && !alts.length && !deep.length && !study.length && !o.text;
  return `
    ${o.rec ? `${lpPrimary(o.rec)}${o.note?`<div class="small lpNote">${esc(o.note)}</div>`:""}` : ""}

    ${alts.length ? `
    <div class="lpSecHead"><b>مصادر بديلة</b><span class="small">شرح بأسلوب مختلف</span></div>
    <div class="card2 lpList">
      ${alts.slice(0,2).map(lpRow).join("")}
      ${extra ? `<div class="hidden" id="lpMoreBox">${alts.slice(2).map(lpRow).join("")}</div>
      <button class="lpMoreBtn" id="lpMoreBtn" type="button" data-count="${extra}">${extra===1?"عرض مصدر إضافي":`عرض ${extra} مصادر إضافية`}</button>` : ""}
    </div>` : ""}

    ${o.text ? `<div class="card2"><b class="lessonSectionTitle">الشرح المكتوب</b><p class="small" style="white-space:pre-wrap;color:var(--ink);margin:8px 0 0">${esc(o.text)}</p></div>` : ""}

    ${deep.length ? `
    <div class="card2 lpList lpDeep" id="lpDeep">
      <button class="lpDeepHead" id="lpDeepBtn" type="button" aria-expanded="false"><b>تعمّق</b><span class="lpChev lpDeepChev">${Icon("chevron_down")}</span></button>
      <div class="hidden" id="lpDeepBody">${deep.map(lpRow).join("")}</div>
    </div>` : ""}

    ${study.length ? `
    <div class="lpSecHead"><b>للمذاكرة</b></div>
    <div class="card2 lpList">${study.map(lpRow).join("")}</div>` : ""}

    ${empty ? `<div class="card2"><p class="small" style="margin:0">${esc(o.emptyText || "لا توجد مصادر بعد.")}</p></div>` : ""}`;
}
// ربط أزرار "عرض مصدر إضافي" و"تعمّق"
function lpWireSections(root){
  const moreBtn = root.querySelector("#lpMoreBtn");
  if(moreBtn){
    const n = Number(moreBtn.dataset.count) || 0;
    moreBtn.onclick = ()=>{
      const open = root.querySelector("#lpMoreBox").classList.toggle("hidden") === false;
      moreBtn.textContent = open ? "إخفاء المصادر الإضافية" : (n===1 ? "عرض مصدر إضافي" : `عرض ${n} مصادر إضافية`);
    };
  }
  const deepBtn = root.querySelector("#lpDeepBtn");
  if(deepBtn){
    deepBtn.onclick = ()=>{
      const open = root.querySelector("#lpDeepBody").classList.toggle("hidden") === false;
      root.querySelector("#lpDeep").classList.toggle("open", open);
      deepBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
  }
}

const App = {
  ctx: null,
  view: {name:"home"},
  root: document.getElementById("viewRoot"),
  crumbs: document.getElementById("crumbs"),
  _openNotifModal: null,
  _feedRealtimeChannel: null,
  _coursesCache: null,
  _universitySemestersCache: null,

  async init(user){
    this.ctx = await CodeUp.loadMyContext();
    document.getElementById("crumbHome").onclick = ()=>{this.go({name:"home"})};
    document.getElementById("notifBtn").onclick = ()=>this.openNotifications();
    document.getElementById("bottomNotifBtn").onclick = ()=>this.openNotifications();
    document.getElementById("messagesBtn").onclick = ()=>this.go({name:"messages"});
    document.getElementById("topAvatarBtn").onclick = ()=> this.go({name:"profile", profileId:this.ctx.user.id});
    this.refreshTopAvatar();
    this.refreshNotifBadge();
    this.refreshMsgBadge();
    CodeUp.subscribeToMyNotifications(user.id, (n)=>{ this.refreshNotifBadge(); if(n.related_type!=="message") CodeUp.toast(n.title, "info"); if(n.related_type==="message") this.refreshMsgBadge(); });
    document.querySelectorAll("#bottomNav [data-bottomnav]").forEach(b=>{
      b.onclick = ()=>{
        const dest = b.dataset.bottomnav;
        if(dest==="search") this.go({name:"search"});
        else if(dest==="messages") this.go({name:"messages"});
        else if(dest==="profile") this.go({name:"profile", profileId:this.ctx.user.id});
      };
    });
    window.addEventListener("popstate", ()=> this.routeFromHash(false));
    this.initHeaderScroll();
    initOverflowHints();
    await this.routeFromHash(false, true);
  },

  // تحكّم تمرير الهيدر (هاتف فقط ≤720px) — مستمع واحد فقط على window.
  // الهيدر يتحرك بـtransform فقط ولا يتغيّر أي شيء بالتخطيط أثناء الإخفاء/الإظهار (لا padding ولا height)،
  // فلا توجد حلقة تغذية راجعة تسبب الاهتزاز. القرار يعتمد على تراكم الحركة بنفس الاتجاه حتى تتجاوز عتبة واضحة.
  initHeaderScroll(){
    const wrap = document.getElementById("mobileHeaderWrap");
    if(!wrap) return;
    const THRESHOLD = 14;                       // px تراكمية بنفس الاتجاه قبل تغيير الحالة
    const mq = window.matchMedia("(max-width:720px)");
    let lastY = Math.max(0, window.scrollY), acc = 0, hidden = false, ticking = false;

    const apply = (v)=>{ if(v === hidden) return; hidden = v; wrap.classList.toggle("headerHidden", v); };
    const reset = ()=>{ acc = 0; lastY = Math.max(0, window.scrollY); apply(false); };
    this._setHeaderHidden = (v)=>{ if(v) apply(true); else reset(); }; // go() يرجّع الهيدر ظاهرًا عند أي تنقل

    const update = ()=>{
      ticking = false;
      if(!mq.matches){ reset(); return; }
      const doc = document.documentElement;
      const range = doc.scrollHeight - doc.clientHeight;      // مساحة التمرير الفعلية
      const headerH = wrap.offsetHeight;
      // لا تمرير حقيقي (أو شبه معدوم): لا إخفاء/إظهار إطلاقًا
      if(range <= headerH + THRESHOLD * 2){ reset(); return; }
      const y = Math.min(Math.max(0, window.scrollY), range);  // قصّ حدّي الارتداد (rubber-band) أعلى/أسفل
      if(y <= 0){ reset(); return; }                           // أعلى الصفحة: ظاهر دائمًا
      const dy = y - lastY;
      lastY = y;
      if(dy === 0) return;
      if(acc !== 0 && (dy > 0) !== (acc > 0)) acc = 0;         // تغيّر الاتجاه يصفّر التراكم
      acc += dy;
      if(acc >= THRESHOLD && y > headerH){ apply(true); acc = 0; }   // نزول مستمر → يختفي
      else if(acc <= -THRESHOLD){ apply(false); acc = 0; }           // صعود مستمر → يظهر
    };

    window.addEventListener("scroll", ()=>{ if(!ticking){ ticking = true; requestAnimationFrame(update); } }, {passive:true});
    // resize يُطلَق أيضًا عند ظهور/اختفاء شريط المتصفح أثناء التمرير — لا نصفّر الحالة إلا عند الخروج من نطاق الهاتف
    window.addEventListener("resize", ()=>{ this.syncHeaderHeight(); if(!mq.matches) reset(); }, {passive:true});
    this.syncHeaderHeight();
  },

  // App Bar موحّد لكل الصفحات الداخلية (هاتف): سهم رجوع + عنوان. info=null (الرئيسية) = بدون App Bar.
  // يُحدَّث بنفس العناصر دون إعادة بناء حتى لا يظهر وميض عند الانتقال من العنوان المؤقت للنهائي.
  setAppBar(info){
    const wrap = document.getElementById("mobileHeaderWrap");
    const host = document.getElementById("appBarHost");
    if(!wrap || !host) return;
    if(!info){
      if(wrap.classList.contains("barMode")){ wrap.classList.remove("barMode"); host.innerHTML = ""; this.syncHeaderHeight(); }
      return;
    }
    let t = host.querySelector("#appBarTitle");
    if(!t){
      host.innerHTML = `<button class="appBarBack" id="appBarBack" type="button" aria-label="رجوع">${Icon("arrow_right")}</button><div class="appBarTitle" id="appBarTitle"></div>`;
      t = host.querySelector("#appBarTitle");
    }
    t.textContent = info.title; t.title = info.title;
    host.querySelector("#appBarBack").onclick = info.back;
    if(!wrap.classList.contains("barMode")){ wrap.classList.add("barMode"); this.syncHeaderHeight(); }
  },

  // عنوان مؤقت + وجهة رجوع لكل صفحة داخلية (تُحسَّن لاحقًا من crumbTrail بعد تحميل البيانات)
  appBarDefaults(view){
    const home = tab=>()=>this.go({name:"home", homeTab:tab});
    const map = {
      course: {title:"الكورس", back: home("courses")},
      lesson: {title:"الدرس", back: ()=>this.go({name:"course", courseId:view.courseId, courseSlug:view.courseSlug, tab:"learning"})},
      messages: {title:"الرسائل", back: home("feed")},
      profile: {title: view.profileId===this.ctx?.user?.id ? "حسابي" : "الملف الشخصي", back: home("feed")},
      search: {title:"البحث", back: home("feed")},
      marketplace_listing: {title:"Marketplace", back: home("marketplace")}
    };
    return map[view.name] || {title:"CodeUp", back: home("feed")};
  },

  // منطق تسجيل الخروج الموحّد — تستخدمه Topbar (كمبيوتر) وإعدادات الحساب (موبايل)، بدون تكرار
  async logout(){
    await db.auth.signOut();
    dash.classList.add("hidden");
    authApp.classList.remove("hidden");
    setMode("login");
    this.ctx = null;
  },

  // تحدّث أفتار الشريط العلوي — صورة حقيقية لو موجودة، وإلا الحرف الأول (نفس أسلوب باقي التطبيق)
  refreshTopAvatar(){
    const img = document.getElementById("topAvatarImg"), initial = document.getElementById("topAvatarInitial");
    const url = this.ctx?.profile?.avatar_url;
    const name = this.ctx?.profile?.full_name || "؟";
    if(url){ img.src = url; img.classList.remove("hidden"); initial.classList.add("hidden"); }
    else{ img.classList.add("hidden"); initial.classList.remove("hidden"); initial.textContent = name[0]; }
  },

  updateBottomNavActive(){
    const map = {search:"search", messages:"messages", profile:"profile"};
    const active = map[this.view.name] || null;
    document.querySelectorAll("#bottomNav [data-bottomnav]").forEach(b=> b.classList.toggle("active", b.dataset.bottomnav===active));
  },

  // يحوّل الرابط الحالي (#/course/<slug>/<tab>) إلى view، أو يفتح الرئيسية لو ما فيه رابط
  async routeFromHash(pushState, isInitial){
    const hash = location.hash.replace(/^#\/?/, "");
    const parts = hash.split("/").filter(Boolean);
    if(parts[0] === "course" && parts[1]){
      const {data: course} = await db.from("courses").select("id").eq("slug", parts[1]).single();
      if(course){
        if(parts[2] === "lesson" && parts[3]){ this.go({name:"lesson", courseId: course.id, courseSlug: parts[1], lessonId: parts[3]}, pushState); return; }
        this.go({name:"course", courseId: course.id, courseSlug: parts[1], tab: parts[2]||"learning"}, pushState); return;
      }
    }
    this.go({name:"home"}, pushState);
  },

  go(view, updateHash = true){
    // نافذة الإشعارات مودال عائم فوق الصفحة — لازم تُغلق عند أي تنقل حتى لا تبقى معلّقة فوق صفحة جديدة
    if(this._openNotifModal){ this._openNotifModal.close(); this._openNotifModal = null; }
    // تابات الرئيسية تعيش بفتحة دائمة بمنطقة الهيدر — أي تنقل لغير الرئيسية يجب يفرّغها
    // (renderHome نفسها بتعيد تعبئتها لو رجع المستخدم للرئيسية بعدين)
    if(view.name !== "home"){
      const tabSlot = document.getElementById("mobileTabSlot");
      if(tabSlot) tabSlot.innerHTML = "";
    }
    this.view = view;
    this.setAppBar(view.name==="home" ? null : this.appBarDefaults(view));
    if(updateHash){
      if(view.name === "course" && view.courseSlug){
        history.pushState(null, "", `#/course/${view.courseSlug}/${view.tab||"learning"}`);
      }else if(view.name === "lesson" && view.courseSlug){
        history.pushState(null, "", `#/course/${view.courseSlug}/lesson/${view.lessonId}`);
      }else if(view.name === "home"){
        history.pushState(null, "", location.pathname);
      }
    }
    this.render();
    this.syncHeaderHeight();
    if(this._setHeaderHidden) this._setHeaderHidden(false); // الهيدر يظهر دايمًا عند أي تنقل جديد، بدل ما يفضل مخفي من الصفحة السابقة
  },

  crumbTrail(items, opts){
    opts = opts || {};
    this.crumbs.classList.remove("hidden");
    const home = this.crumbs.querySelector("#crumbHome");
    this.crumbs.innerHTML = "";
    this.crumbs.appendChild(home);
    items.forEach(it=>{
      const sep=document.createElement("span");sep.textContent="/";sep.className="mono";this.crumbs.appendChild(sep);
      const b=document.createElement("button");b.textContent=it.label;b.onclick=it.onClick;this.crumbs.appendChild(b);
    });
    // الهاتف: عنوان الصفحة = آخر عنصر، والرجوع = العنصر الأب (أو الرئيسية)
    const title = opts.title || (items.length ? items[items.length-1].label : null);
    const back = opts.back || (items.length>1 ? items[items.length-2].onClick : ()=>this.go({name:"home"}));
    if(title) this.setAppBar({title, back});
    this.syncHeaderHeight();
  },

  // يقيس الارتفاع الفعلي لمنطقة الهيدر الموحّدة (topbar + crumbs/tabs الظاهرين حاليًا)
  // ويحجز نفس المساحة أعلى المحتوى بالهاتف — بدونها يبدأ المحتوى تحت الهيدر مباشرة
  // (Fixed = خارج تدفق الصفحة)، وبالتالي تختفي بداية أول منشور خلفه.
  syncHeaderHeight(){
    const wrap = document.getElementById("mobileHeaderWrap");
    if(!wrap || window.innerWidth > 720) return;
    requestAnimationFrame(()=>{
      document.documentElement.style.setProperty("--mobileHeaderH", wrap.offsetHeight + "px");
    });
  },

  async refreshNotifBadge(){
    const {count} = await db.from("notifications").select("id",{count:"exact",head:true}).eq("profile_id", this.ctx.user.id).eq("is_read", false);
    const badge=document.getElementById("notifBadge");
    if(count>0){badge.textContent=count>9?"9+":count;badge.classList.remove("hidden")}else badge.classList.add("hidden");
    const bottomBadge = document.getElementById("bottomNotifBadge");
    if(bottomBadge){ if(count>0){bottomBadge.textContent=count>9?"9+":count;bottomBadge.classList.remove("hidden")}else bottomBadge.classList.add("hidden"); }
  },

  // العداد يعتمد على رسائل غير مقروءة فعليًا بجدول messages (مصدر الحقيقة)، مو على notifications
  async refreshMsgBadge(){
    const {data: convs} = await db.from("conversations").select("id").or(`user_a.eq.${this.ctx.user.id},user_b.eq.${this.ctx.user.id}`);
    const ids = (convs||[]).map(c=>c.id);
    let count = 0;
    if(ids.length){
      const {count: c} = await db.from("messages").select("id",{count:"exact",head:true}).in("conversation_id", ids).eq("is_read", false).neq("sender_id", this.ctx.user.id);
      count = c || 0;
    }
    const badge = document.getElementById("msgBadge"), bottomBadge = document.getElementById("bottomMsgBadge");
    if(count>0){ badge.textContent = count>9?"9+":count; badge.classList.remove("hidden"); bottomBadge.textContent = count>9?"9+":count; bottomBadge.classList.remove("hidden"); }
    else{ badge.classList.add("hidden"); bottomBadge.classList.add("hidden"); }
  },

  async openNotifications(){
    const PAGE_SIZE = 15;
    let offset = 0, done = false, loading = false;

    const rowHtml = (n)=>`
      <div class="card2 notifRow" data-notifid="${n.id}" data-notiftype="${n.related_type||''}" data-notifcourse="${n.course_id||''}" data-notifrelated="${n.related_id||''}" style="${n.is_read?'':'background:rgba(255,255,255,.08)'};cursor:pointer">
        <div class="row"><b style="font-size:13.5px">${CodeUp.escapeHtml(n.title)}</b><span class="small mono">${CodeUp.timeAgo(n.created_at)}</span></div>
        ${n.body?`<p class="small" style="margin-top:4px">${CodeUp.escapeHtml(n.body)}</p>`:""}
      </div>`;

    const m = this.modalScrollable("الإشعارات", `<div id="notifListInner"></div><div id="notifLoadMoreRow" style="text-align:center;margin-top:10px"></div>`);
    App._openNotifModal = m;
    const listInner = m.el.querySelector("#notifListInner");
    const loadMoreRow = m.el.querySelector("#notifLoadMoreRow");

    // خرائط نوع الإشعار → التبويب المناسب داخل الكورس
    const TAB_BY_TYPE = { announcement:"timeline", submission:"assignments", squad_join_request:"squads", leader_application:"squads" };
    const ADMIN_ACTION_TYPES = new Set(["squad_join_request_new", "leader_application_new"]); // إشعارات تخص دور القائد/الأدمن، توديه للوحة التحكم مباشرة

    const openRow = async (row)=>{
      const id = row.dataset.notifid;
      await db.from("notifications").update({is_read:true}).eq("id", id);
      const courseId = row.dataset.notifcourse;
      const notifType = row.dataset.notiftype;
      m.close();
      this.refreshNotifBadge();
      if(notifType === "message"){
        this.go({name:"messages", conversationId: row.dataset.notifrelated});
        return;
      }
      if(ADMIN_ACTION_TYPES.has(notifType)){
        // إشعار إداري (طلب انضمام/قيادة جديد) — يخص لوحة التحكم مباشرة، مو تطبيق الطالب
        window.location.href = "admin/index.html";
        return;
      }
      const tab = TAB_BY_TYPE[notifType] || "timeline";
      if(!courseId){ this.go({name:"home", homeTab:"feed"}); return; } // إعلان عام لكل المنصة
      const {data: course} = await db.from("courses").select("id,slug").eq("id", courseId).single();
      if(!course){ CodeUp.toast("هذا العنصر لم يعد موجودًا", "error"); return; }
      this.go({name:"course", courseId: course.id, courseSlug: course.slug, tab});
    };
    // تفويض حدث النقر لعنصر القائمة نفسه بدل كل صف — يشتغل تلقائيًا مع الصفوف
    // المُضافة لاحقًا عبر "تحميل المزيد" بدون إعادة ربط أحداث جديدة.
    listInner.addEventListener("click", (e)=>{
      const row = e.target.closest("[data-notifid]");
      if(row) openRow(row);
    });

    const loadPage = async ()=>{
      if(done || loading) return;
      loading = true;
      const {data} = await db.from("notifications").select("*").eq("profile_id", this.ctx.user.id)
        .order("created_at", {ascending:false}).range(offset, offset + PAGE_SIZE - 1);
      const page = data || [];
      if(offset === 0 && !page.length){
        listInner.innerHTML = `<div class="emptyState">لا توجد إشعارات بعد.</div>`;
      }else{
        listInner.insertAdjacentHTML("beforeend", page.map(rowHtml).join(""));
      }
      offset += page.length;
      if(page.length < PAGE_SIZE) done = true;

      // نعلّم غير المقروء ضمن هذه الدفعة كمقروء بمجرد عرضها فعليًا للمستخدم
      const unreadIds = page.filter(n=>!n.is_read).map(n=>n.id);
      if(unreadIds.length){
        await db.from("notifications").update({is_read:true}).in("id", unreadIds);
        this.refreshNotifBadge();
      }

      loadMoreRow.innerHTML = done ? "" : `<button class="btn" id="notifLoadMoreBtn">تحميل المزيد</button>`;
      const moreBtn = document.getElementById("notifLoadMoreBtn");
      if(moreBtn) moreBtn.onclick = loadPage;
      loading = false;
    };

    await loadPage();
  },

  async renderMessages(conversationId){
    this.crumbTrail([], {title:"الرسائل", back: ()=>this.go({name:"home", homeTab:"feed"})});
    const isMobile = window.innerWidth < 720;
    this.root.innerHTML = `
      <div class="chatShell ${isMobile && conversationId ? 'showThread' : ''} ${isMobile && !conversationId ? 'showList' : ''}">
        <div class="chatList">
          <div class="chatListHead">
            <h2>الدردشة</h2>
            <p class="small" id="chatStatusLine">تواصل مع طلاب CodeUp</p>
            <input type="text" id="chatSearchInput" placeholder="بحث عن محادثة أو شخص…" class="chatSearchInput">
          </div>
          <div id="convList">${skeletonRowsHtml(5)}</div>
          <button id="newChatFab" class="chatFab" title="محادثة جديدة" aria-label="محادثة جديدة">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div class="chatThread" id="chatThreadPane">
          <div class="emptyState" style="margin-top:60px">اختر محادثة أو ابدأ وحدة جديدة</div>
        </div>
      </div>`;

    if(this._msgRealtimeChannel){ db.removeChannel(this._msgRealtimeChannel); this._msgRealtimeChannel = null; }

    const loadConvList = async ()=>{
      const {data: convs} = await db.from("conversations")
        .select("*, a:profiles!conversations_user_a_fkey(id,full_name), b:profiles!conversations_user_b_fkey(id,full_name)")
        .or(`user_a.eq.${this.ctx.user.id},user_b.eq.${this.ctx.user.id}`)
        .order("last_message_at",{ascending:false});

      const {data: unread} = await db.from("messages").select("conversation_id").eq("is_read", false).neq("sender_id", this.ctx.user.id)
        .in("conversation_id", (convs||[]).map(c=>c.id).length ? (convs||[]).map(c=>c.id) : ["00000000-0000-0000-0000-000000000000"]);
      const unreadByConv = {};
      (unread||[]).forEach(m=> unreadByConv[m.conversation_id] = (unreadByConv[m.conversation_id]||0)+1);

      const listBox = document.getElementById("convList");
      listBox.innerHTML = (convs||[]).map(c=>{
        const other = c.a.id === this.ctx.user.id ? c.b : c.a;
        const unreadCount = unreadByConv[c.id]||0;
        return `<div class="convRow ${c.id===conversationId?'active':''}" data-conv="${c.id}" data-othername="${CodeUp.escapeHtml(other.full_name||'')}">
          <div class="convAvatar">${CodeUp.escapeHtml((other.full_name||"?")[0])}</div>
          <div class="convInfo"><b>${CodeUp.escapeHtml(other.full_name||"مستخدم")}</b><span class="small mono">${CodeUp.timeAgo(c.last_message_at)}</span></div>
          ${unreadCount?`<span class="bottomBadge" style="position:static">${unreadCount}</span>`:""}
        </div>`;
      }).join("") || `<div class="emptyState">لا توجد محادثات بعد. ابدأ وحدة جديدة بزر +.</div>`;

      listBox.querySelectorAll("[data-conv]").forEach(row=>{
        row.onclick = ()=> this.go({name:"messages", conversationId: row.dataset.conv});
      });
    };
    await loadConvList();

    document.getElementById("chatSearchInput").oninput = CodeUp.debounce(async (e)=>{
      const q = e.target.value.trim();
      document.querySelectorAll(".convRow").forEach(row=>{
        row.style.display = !q || row.dataset.othername.toLowerCase().includes(q.toLowerCase()) ? "" : "none";
      });
    }, 250);

    document.getElementById("newChatFab").onclick = ()=> this.openNewChatPicker();

    if(conversationId) await this.renderChatThread(conversationId);

    window.onresize = CodeUp.debounce(()=>{
      const nowMobile = window.innerWidth < 720;
      const shell = document.querySelector(".chatShell");
      if(!shell) return;
      shell.classList.toggle("showThread", nowMobile && !!conversationId);
      shell.classList.toggle("showList", nowMobile && !conversationId);
    }, 200);
  },

  async openNewChatPicker(){
    const m = this.modal(`<h3>محادثة جديدة</h3>
      <input type="text" id="newChatSearch" placeholder="ابحث عن طالب بالاسم…" autofocus>
      <div id="newChatResults" style="margin-top:10px;max-height:50vh;overflow-y:auto"></div>`);
    const results = m.el.querySelector("#newChatResults");
    m.el.querySelector("#newChatSearch").oninput = CodeUp.debounce(async (e)=>{
      const q = e.target.value.trim();
      if(q.length < 2){ results.innerHTML = `<p class="small">اكتب حرفين على الأقل للبحث.</p>`; return; }
      const {data} = await db.from("profiles").select("id,full_name").ilike("full_name", `%${q}%`).neq("id", this.ctx.user.id).limit(15);
      results.innerHTML = (data||[]).map(p=>`<div class="convRow" data-user="${p.id}"><div class="convAvatar">${CodeUp.escapeHtml((p.full_name||"?")[0])}</div><div class="convInfo"><b>${CodeUp.escapeHtml(p.full_name||"")}</b></div></div>`).join("") || `<p class="small">لا نتائج.</p>`;
      results.querySelectorAll("[data-user]").forEach(row=>{
        row.onclick = async ()=>{
          try{
            const {data: conv, error} = await db.rpc("get_or_create_conversation", {p_other_user: row.dataset.user}).single();
            if(error) throw error;
            m.close();
            this.go({name:"messages", conversationId: conv.id});
          }catch(e){ CodeUp.toast(e.message,"error"); }
        };
      });
    }, 300);
  },

  async renderChatThread(conversationId){
    const pane = document.getElementById("chatThreadPane");
    pane.innerHTML = `<div class="chatMessages">${skeletonChatBubblesHtml(4)}</div>`;

    const {data: conv} = await db.from("conversations")
      .select("*, a:profiles!conversations_user_a_fkey(id,full_name), b:profiles!conversations_user_b_fkey(id,full_name)")
      .eq("id", conversationId).single();
    if(!conv){ pane.innerHTML = `<div class="emptyState">هذه المحادثة لم تعد موجودة.</div>`; return; }
    const other = conv.a.id === this.ctx.user.id ? conv.b : conv.a;

    pane.innerHTML = `
      <div class="chatThreadHead">
        ${window.innerWidth<720?`<button id="chatBackBtn" class="iconBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>`:""}
        <div class="convAvatar">${CodeUp.escapeHtml((other.full_name||"?")[0])}</div>
        <b>${CodeUp.escapeHtml(other.full_name||"مستخدم")}</b>
      </div>
      <div class="chatMessages" id="chatMessages">${skeletonChatBubblesHtml(4)}</div>
      <form class="chatComposer" id="chatComposerForm">
        <input type="text" id="chatMsgInput" placeholder="اكتب رسالة…" maxlength="2000" autocomplete="off">
        <button type="submit" class="btn dark">إرسال</button>
      </form>`;

    const backBtn = document.getElementById("chatBackBtn");
    if(backBtn) backBtn.onclick = ()=> this.go({name:"messages"});

    const msgBox = document.getElementById("chatMessages");
    const PAGE = 30;
    let oldestLoaded = null;

    const renderMsgs = (msgs, prepend)=>{
      const html = msgs.map(m=>`<div class="chatBubble ${m.sender_id===this.ctx.user.id?'mine':''}">${CodeUp.escapeHtml(m.content)}<span class="small mono">${CodeUp.timeAgo(m.created_at)}</span></div>`).join("");
      if(prepend) msgBox.insertAdjacentHTML("afterbegin", html);
      else msgBox.insertAdjacentHTML("beforeend", html);
    };

    const {data: initialMsgs} = await db.from("messages").select("*").eq("conversation_id", conversationId).order("created_at",{ascending:false}).limit(PAGE);
    const ordered = (initialMsgs||[]).slice().reverse();
    msgBox.innerHTML = "";
    if(!ordered.length) msgBox.innerHTML = `<div class="emptyState">ابدأ المحادثة الآن.</div>`;
    else{ renderMsgs(ordered, false); oldestLoaded = ordered[0]?.created_at; }
    msgBox.scrollTop = msgBox.scrollHeight;

    msgBox.onscroll = CodeUp.debounce(async ()=>{
      if(msgBox.scrollTop > 40 || !oldestLoaded) return;
      const {data: older} = await db.from("messages").select("*").eq("conversation_id", conversationId).lt("created_at", oldestLoaded).order("created_at",{ascending:false}).limit(PAGE);
      if(older && older.length){
        const prevHeight = msgBox.scrollHeight;
        renderMsgs(older.slice().reverse(), true);
        oldestLoaded = older[older.length-1].created_at;
        msgBox.scrollTop = msgBox.scrollHeight - prevHeight;
      }
    }, 150);

    await db.rpc("mark_conversation_read", {p_conversation_id: conversationId});
    this.refreshMsgBadge();

    // Realtime محصور بهذي المحادثة بس — مو اشتراك عام على كل الرسائل
    this._msgRealtimeChannel = db.channel(`conv-${conversationId}`)
      .on("postgres_changes", {event:"INSERT", schema:"public", table:"messages", filter:`conversation_id=eq.${conversationId}`}, async (payload)=>{
        renderMsgs([payload.new], false);
        msgBox.scrollTop = msgBox.scrollHeight;
        if(payload.new.sender_id !== this.ctx.user.id){
          await db.rpc("mark_conversation_read", {p_conversation_id: conversationId});
          this.refreshMsgBadge();
        }
      }).subscribe();

    document.getElementById("chatComposerForm").onsubmit = async (e)=>{
      e.preventDefault();
      const input = document.getElementById("chatMsgInput");
      const val = input.value.trim();
      if(!val) return;
      input.disabled = true;
      try{
        await db.rpc("send_message", {p_conversation_id: conversationId, p_content: val});
        input.value = "";
      }catch(err){ CodeUp.toast(err.message,"error"); }
      finally{ input.disabled = false; input.focus(); }
    };
  },

  async renderProfile(profileId){
    this.crumbTrail([], {title: profileId===this.ctx.user.id ? "حسابي" : "الملف الشخصي", back: ()=>this.go({name:"home", homeTab:"feed"})});
    const isMe = profileId === this.ctx.user.id;
    const esc = CodeUp.escapeHtml;
    const {data: profile} = await db.from("profiles").select("id,full_name,avatar_url,created_at,university,major,study_level,skills,achievements,github_url,linkedin_url").eq("id", profileId).single();
    if(!profile){ this.root.innerHTML = `<div class="emptyState">المستخدم غير موجود.</div>`; return; }

    const [{data: posts}, {data: subs}, completedRes] = await Promise.all([
      db.from("posts").select("*").eq("profile_id", profileId).eq("status","published").order("created_at",{ascending:false}).limit(30),
      db.from("submissions").select("id,status,grade,content,created_at,assignment_id,assignments(id,title,course_id,courses(name,slug))").eq("profile_id", profileId).order("created_at",{ascending:false}).limit(30),
      db.rpc("profile_completed_courses", {p_profile_id: profileId})
    ]);
    const completed = completedRes && !completedRes.error ? (completedRes.data || []) : [];

    // إحصائيات ودور المستخدم لصفحته الشخصية فقط — كلها من this.ctx المحمّل
    // مسبقًا (loadMyContext) بدون أي استعلام إضافي حساس، ومن memberships
    // (RLS بتسمح لصاحبها بس يشوفه).
    let statsHtml = "", badgesHtml = "";
    if(isMe){
      const enr = this.ctx.enrollments || [];
      const totalXp = enr.reduce((s,e)=> s + (e.xp||0), 0);
      const bestStreak = enr.reduce((m,e)=> Math.max(m, e.streak||0), 0);
      const roleLabel = this.ctx.isPlatformAdmin ? "سوبر أدمن"
        : (this.ctx.courseAdmins||[]).length ? "مشرف كورس"
        : (this.ctx.leaderSquads||[]).length ? "قائد مجموعة"
        : enr.length ? "طالب" : "عضو CodeUp";

      let memberId = "";
      try{
        const {data: m} = await db.from("memberships").select("member_id").eq("user_id", this.ctx.user.id).maybeSingle();
        memberId = m?.member_id || "";
      }catch(_e){}

      badgesHtml = `<div class="apBadges">
        <span class="apBadge role">${esc(roleLabel)}</span>
        ${memberId?`<span class="apBadge mid">${esc(memberId)}</span>`:""}
      </div>`;

      statsHtml = `<div class="apStats">
        <div class="apStat"><b>${totalXp}</b><span>XP</span></div>
        <div class="apStat"><b>${bestStreak}</b><span>Streak</span></div>
        <div class="apStat"><b>${enr.length}</b><span>الكورسات</span></div>
        <div class="apStat"><b>${(subs||[]).length}</b><span>التسليمات</span></div>
      </div>`;
    }

    // ---- بيانات الملف الشخصي (كلها اختيارية؛ لا يظهر إلا ما هو مُدخَل) ----
    const skills = (profile.skills||[]).filter(Boolean);
    const achievements = (profile.achievements||[]).filter(Boolean);
    const info = [["الجامعة", profile.university], ["التخصص", profile.major], ["المستوى الدراسي", profile.study_level]].filter(r=>r[1]);
    const ghOk = profile.github_url && /^https:\/\/(www\.)?github\.com\/.+/i.test(profile.github_url);
    const liOk = profile.linkedin_url && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/.+/i.test(profile.linkedin_url);
    const hasAny = info.length || skills.length || achievements.length || completed.length || ghOk || liOk;

    const linksHtml = (ghOk || liOk) ? `<div class="profLinks">
      ${ghOk?`<a class="btn" href="${esc(profile.github_url)}" target="_blank" rel="noopener noreferrer"><span class="inlineBtnIcon">${Icon("github")}</span>GitHub</a>`:""}
      ${liOk?`<a class="btn" href="${esc(profile.linkedin_url)}" target="_blank" rel="noopener noreferrer"><span class="inlineBtnIcon">${Icon("linkedin")}</span>LinkedIn</a>`:""}
    </div>` : "";

    const section = (title, inner)=>`<div class="card2 profSection"><h4>${title}</h4>${inner}</div>`;
    const sectionsHtml = [
      info.length ? section("المعلومات الأكاديمية", info.map(([k,v])=>`<div class="profInfoRow"><span class="small">${k}</span><b>${esc(v)}</b></div>`).join("")) : "",
      skills.length ? section("المهارات", `<div class="profChips">${skills.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div>`) : "",
      completed.length ? section("الكورسات المكتملة", `<div class="profCourses">${completed.map(c=>`<button type="button" class="profCourse" data-pcourse="${esc(c.course_id)}" data-pslug="${esc(c.slug||"")}"><span class="profCourseIc">${Icon("check_circle")}</span><span class="profCourseName">${esc(c.name)}</span><span class="lpChev">${LP_CHEV}</span></button>`).join("")}</div>`) : "",
      achievements.length ? section("الشهادات والإنجازات", `<ul class="profAch">${achievements.map(x=>`<li><span class="profAchIc">${Icon("check")}</span><span>${esc(x)}</span></li>`).join("")}</ul>`) : "",
      (isMe && !hasAny) ? `<div class="card2 profSection profEmpty"><b>أكمل ملفك الشخصي</b><p class="small" style="margin:6px 0 12px">أضف جامعتك وتخصصك ومهاراتك وروابطك ليظهر ملفك للآخرين بشكل أفضل.</p><button class="btn dark" id="profileCompleteBtn">إكمال الملف الشخصي</button></div>` : ""
    ].join("");

    this.root.innerHTML = `
      <div class="accountPro profilePage">
        <div class="card2 profHero">
          ${CodeUp.avatarHtml(profile.full_name, profile.avatar_url, 84)}
          <div class="profId">
            <h2 class="profName">${esc(profile.full_name||"")}</h2>
            ${isMe?`<p class="small mono ellipsis" style="margin:2px 0 0">${esc(this.ctx.user.email||"")}</p>`:""}
            ${badgesHtml}
            ${info.length?`<div class="profChips">${info.map(([k,v])=>`<span class="chip">${esc(v)}</span>`).join("")}</div>`:""}
          </div>
          <div class="profActions">
            ${isMe?`<button class="btn" id="profileSettingsBtn">الإعدادات</button>`
                  :`<button class="btn dark" id="profileMsgBtn">مراسلة</button>`}
          </div>
        </div>
        ${linksHtml}
        ${statsHtml}
        ${sectionsHtml}
        <div class="fbTabBar apTabBar">
          <button data-ptab="posts" class="active">المنشورات</button>
          <button data-ptab="submissions">التسليمات</button>
        </div>
        <div id="profileBody"></div>
      </div>`;

    if(isMe) document.getElementById("profileSettingsBtn").onclick = ()=> this.openAccountSettings();
    else document.getElementById("profileMsgBtn").onclick = async ()=>{
      try{ const {data: conv} = await db.rpc("get_or_create_conversation", {p_other_user: profileId}).single(); this.go({name:"messages", conversationId: conv.id}); }
      catch(e){ CodeUp.toast(e.message,"error"); }
    };
    const completeBtn = document.getElementById("profileCompleteBtn");
    if(completeBtn) completeBtn.onclick = ()=> this.openAccountSettings();
    this.root.querySelectorAll("[data-pcourse]").forEach(b=>{
      b.onclick = ()=> this.go({name:"course", courseId:b.dataset.pcourse, courseSlug:b.dataset.pslug, tab:"learning"});
    });

    const body = document.getElementById("profileBody");
    const showPosts = ()=>{
      body.innerHTML = (posts||[]).map(p=>`
        <div class="card2" data-postid="${p.id}" style="position:relative">
          ${isMe?`<button class="btn iconBtn" data-postmenu="${p.id}" aria-label="خيارات المنشور" style="position:absolute;inset-inline-end:8px;top:8px">${Icon("more_vertical")}</button>`:""}
          <div class="body" style="padding-inline-end:${isMe?'34px':'0'}">${esc(p.content||"")}</div>
          <span class="small mono">${CodeUp.timeAgo(p.created_at)}</span>
        </div>`).join("") || `<div class="emptyState">لا توجد منشورات بعد.</div>`;
      if(isMe){
        body.querySelectorAll("[data-postmenu]").forEach(b=> b.onclick = ()=>{
          const p = (posts||[]).find(x=>x.id===b.dataset.postmenu);
          const m = this.modal(`
            <h3 style="margin-top:0">خيارات المنشور</h3>
            <div style="display:flex;flex-direction:column;gap:8px">
              <button class="btn" id="menuEditPost">تعديل</button>
              <button class="btn danger" id="menuDelPost">حذف</button>
            </div>`);
          m.el.querySelector("#menuEditPost").onclick = async ()=>{
            m.close();
            const newVal = await this.promptDialog({title:"تعديل المنشور", defaultValue:p.content, confirmLabel:"حفظ"});
            if(newVal===null || !newVal.trim()) return;
            try{ await db.from("posts").update({content:newVal.trim()}).eq("id", p.id).eq("profile_id", this.ctx.user.id).throwOnError(); this.renderProfile(profileId); }
            catch(e){ CodeUp.toast(e.message,"error"); }
          };
          m.el.querySelector("#menuDelPost").onclick = async ()=>{
            m.close();
            if(!await this.confirmDialog({title:"حذف المنشور", message:"لن يظهر لأي شخص بعد الحذف.", confirmLabel:"حذف", danger:true})) return;
            try{ await db.from("posts").update({status:"deleted", deleted_at:new Date().toISOString()}).eq("id", p.id).eq("profile_id", this.ctx.user.id).throwOnError(); this.renderProfile(profileId); }
            catch(e){ CodeUp.toast(e.message,"error"); }
          };
        });
      }
    };
    // التسليمات: البطاقة كلها قابلة للضغط وتنقلك إلى الكورس ← تبويب الواجبات ← نفس الواجب (route موجود أصلًا)
    const SUB_LABEL = {submitted:"مُسلَّم", late:"متأخر", reviewed:"تمت المراجعة", missing:"غير مُسلَّم"};
    const SUB_TAG = {submitted:"pending", late:"late", reviewed:"reviewed", missing:"missing"};
    const showSubs = ()=>{
      body.innerHTML = (subs||[]).map(s=>{
        const a = s.assignments, c = a?.courses;
        const grade = s.status==="reviewed" && s.grade!=null ? ` · ${s.grade}` : "";
        const snippet = (s.content||"").trim();
        return `<button type="button" class="card2 subCard" data-subnav="${s.id}" ${a?"":"disabled"}>
          <div class="subTop"><span class="small ellipsis">${esc(c?.name||"")}</span><span class="tag ${SUB_TAG[s.status]||""}">${esc((SUB_LABEL[s.status]||s.status||"")+grade)}</span></div>
          <b class="subTitle clamp2">${esc(a?.title||"واجب")}</b>
          ${snippet?`<div class="small clamp2">${esc(snippet)}</div>`:""}
          <div class="subBottom"><span class="small mono">${CodeUp.timeAgo(s.created_at)}</span>${a?`<span class="subGo">عرض في الواجب <span class="lpChev">${LP_CHEV}</span></span>`:""}</div>
        </button>`;
      }).join("") || `<div class="emptyState">لا توجد تسليمات بعد.</div>`;
      body.querySelectorAll("[data-subnav]").forEach(b=>{
        b.onclick = ()=>{
          const s = (subs||[]).find(x=>x.id===b.dataset.subnav); const a = s?.assignments;
          if(!a) return;
          this.go({name:"course", courseId:a.course_id, courseSlug:a.courses?.slug, tab:"assignments", assignmentId:a.id});
        };
      });
    };
    showPosts();
    this.root.querySelectorAll("[data-ptab]").forEach(b=>{
      b.onclick = ()=>{
        this.root.querySelectorAll("[data-ptab]").forEach(x=>x.classList.remove("active")); b.classList.add("active");
        b.dataset.ptab==="posts" ? showPosts() : showSubs();
      };
    });
  },

  openAccountSettings(){
    const prof = this.ctx.profile || {};
    const enr = this.ctx.enrollments || [];
    const roleLabel = this.ctx.isPlatformAdmin ? "سوبر أدمن"
      : (this.ctx.courseAdmins||[]).length ? "مشرف كورس"
      : (this.ctx.leaderSquads||[]).length ? "قائد مجموعة"
      : enr.length ? "طالب" : "عضو CodeUp";

    const m = this.modal(`
      <div class="accountPro">
      <h3 style="margin-top:0">إعدادات الحساب</h3>

      <div class="apSection">
        <div class="apSecTitle">الملف الشخصي</div>
        <div class="apAvatarRow">
          <div class="apAvatarBig" id="editAvatarPreview">
            ${this.ctx.profile.avatar_url?`<img src="${CodeUp.escapeHtml(this.ctx.profile.avatar_url)}" alt="">`:`<span>${CodeUp.escapeHtml((this.ctx.profile.full_name||"؟")[0])}</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <input type="file" id="avatarFileInput" accept="image/*" style="display:none">
            <button class="btn" id="changeAvatarBtn">تغيير الصورة</button>
          </div>
        </div>
        <label>الاسم الكامل</label>
        <input id="editFullName" maxlength="80" value="${CodeUp.escapeHtml(this.ctx.profile.full_name||"")}">
      </div>

      <div class="apSection">
        <div class="apSecTitle">المعلومات الأكاديمية</div>
        <label>الجامعة</label>
        <input id="editUniversity" maxlength="120" value="${CodeUp.escapeHtml(prof.university||"")}" placeholder="مثال: جامعة أم درمان الإسلامية">
        <label>التخصص</label>
        <input id="editMajor" maxlength="120" value="${CodeUp.escapeHtml(prof.major||"")}" placeholder="مثال: علوم الحاسوب وتقنية المعلومات">
        <label>المستوى الدراسي</label>
        <input id="editStudyLevel" maxlength="40" list="studyLevelList" value="${CodeUp.escapeHtml(prof.study_level||"")}" placeholder="مثال: المستوى الأول">
        <datalist id="studyLevelList"><option value="المستوى الأول"><option value="المستوى الثاني"><option value="المستوى الثالث"><option value="المستوى الرابع"><option value="المستوى الخامس"><option value="خريج"></datalist>
      </div>

      <div class="apSection">
        <div class="apSecTitle">المهارات والإنجازات</div>
        <label>المهارات <span class="small">(افصل بينها بفاصلة، حتى 20)</span></label>
        <textarea id="editSkills" rows="2" placeholder="مثال: Python، HTML، SQL">${CodeUp.escapeHtml((prof.skills||[]).join("، "))}</textarea>
        <label>الشهادات والإنجازات <span class="small">(كل سطر إنجاز، حتى 20)</span></label>
        <textarea id="editAchievements" rows="4" placeholder="مثال: شهادة إتمام كورس الخوارزميات — CodeUp">${CodeUp.escapeHtml((prof.achievements||[]).join("\n"))}</textarea>
      </div>

      <div class="apSection">
        <div class="apSecTitle">الروابط <span class="small">(اختياري)</span></div>
        <label>GitHub</label>
        <input id="editGithub" dir="ltr" maxlength="200" value="${CodeUp.escapeHtml(prof.github_url||"")}" placeholder="https://github.com/username">
        <label>LinkedIn</label>
        <input id="editLinkedin" dir="ltr" maxlength="200" value="${CodeUp.escapeHtml(prof.linkedin_url||"")}" placeholder="https://www.linkedin.com/in/username">
        <button class="btn dark apSaveBtn" id="saveProfileBtn">حفظ التعديلات</button>
      </div>

      <div class="apSection">
        <div class="apSecTitle">الأمان والحساب</div>
        <div class="apRow"><span>البريد الإلكتروني</span><span class="mono small">${CodeUp.escapeHtml(this.ctx.user.email||"")}</span></div>
        <button class="btn apFull" id="resetPasswordBtn">إعادة تعيين كلمة المرور عبر البريد</button>
        <button class="btn apFull" id="accountLogoutBtn">تسجيل الخروج</button>
      </div>

      <div class="apSection">
        <div class="apSecTitle">عضوية CodeUp</div>
        <div class="apRow"><span>الحالة</span><span class="apBadge role">${CodeUp.escapeHtml(roleLabel)}</span></div>
        <p class="small" style="margin-top:8px">أضف بطاقة عضويتك إلى Google Wallet للوصول السريع إليها من هاتفك.</p>
        <button class="btn dark apFull" id="googleWalletBtn">
          <svg id="googleWalletBtnIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="3"></rect><path d="M2 10h20"></path><path d="M6 15h4"></path></svg>
          <span id="googleWalletBtnLabel">إضافة إلى Google Wallet</span>
        </button>
      </div>

      <div class="apSection">
        <div class="apSecTitle">المساعدة</div>
        <a class="apLinkRow" href="mailto:support@codeupsd.online">التواصل مع CodeUp</a>
        <a class="apLinkRow" href="mailto:support@codeupsd.online?subject=مشكلة%20في%20CodeUp">الإبلاغ عن مشكلة</a>
      </div>

      <div class="apSection">
        <div class="apSecTitle">حول CodeUp</div>
        <div class="apRow"><span>الإصدار</span><span class="mono small">1.0.0</span></div>
      </div>

      <div class="apSection apDanger">
        <div class="apSecTitle">منطقة خطرة</div>
        <p class="small" style="margin-top:6px">حذف الحساب إجراء نهائي لا يمكن التراجع عنه — سيُحذف حسابك وكل بياناتك المرتبطة به.</p>
        <button class="btn danger apFull" id="deleteAccountStep1">حذف حسابي نهائيًا</button>
      </div>
      </div>`);
    m.el.querySelector("#accountLogoutBtn").onclick = ()=>{ m.close(); App.logout(); };

    m.el.querySelector("#resetPasswordBtn").onclick = async (ev)=>{
      const btn = ev.currentTarget;
      // نفس دالة إعادة التعيين المستخدمة في شاشة اللوجين بالضبط — بريد
      // المستخدم معروف بالفعل (هو مسجّل دخول)، فلا داعي لأي حقل إدخال.
      btn.disabled = true; const original = btn.textContent; btn.textContent = "جارِ الإرسال...";
      try{
        await db.auth.resetPasswordForEmail(this.ctx.user.email, { redirectTo: window.location.origin + window.location.pathname });
        btn.textContent = "تم إرسال الرابط إلى بريدك"; btn.classList.add("dark");
      }catch(err){
        btn.disabled = false; btn.textContent = original;
        CodeUp.toast("تعذّر إرسال رابط إعادة التعيين، حاول مرة أخرى", "error");
      }
    };

    m.el.querySelector("#changeAvatarBtn").onclick = ()=> m.el.querySelector("#avatarFileInput").click();
    m.el.querySelector("#avatarFileInput").onchange = async (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      const btn = m.el.querySelector("#changeAvatarBtn");
      try{
        await CodeUp.withBtnLoading(btn, async ()=>{
          const processed = await CodeUp.compressImageIfNeeded(file); // نفس دالة ضغط الصور الموجودة أصلًا
          const path = `${this.ctx.user.id}/${Date.now()}_${processed.name.replace(/[^\w.\-]+/g,"_")}`;
          const { error: upErr } = await db.storage.from("avatars").upload(path, processed, {upsert:true});
          if(upErr) throw upErr;
          const { data: pub } = db.storage.from("avatars").getPublicUrl(path);
          await db.from("profiles").update({avatar_url: pub.publicUrl}).eq("id", this.ctx.user.id).throwOnError();
          this.ctx.profile.avatar_url = pub.publicUrl;
          m.el.querySelector("#editAvatarPreview").innerHTML = `<img src="${CodeUp.escapeHtml(pub.publicUrl)}" alt="">`;
          this.refreshTopAvatar();
          CodeUp.toast("تم تحديث الصورة", "success");
        });
      }catch(err){ CodeUp.toast(err.message||"تعذّر رفع الصورة", "error"); }
    };

    m.el.querySelector("#saveProfileBtn").onclick = async (e)=>{
      const v = id=>m.el.querySelector(id).value.trim();
      const newName = v("#editFullName");
      if(!newName){ CodeUp.toast("الاسم لا يمكن أن يكون فارغًا","error"); return; }
      // المهارات: فواصل عربية/إنجليزية/أسطر، بلا تكرار، حتى 20 مهارة
      const skills = [...new Set(v("#editSkills").split(/[,،\n]+/).map(x=>x.trim()).filter(Boolean))];
      if(skills.length > 20){ CodeUp.toast("الحد الأقصى 20 مهارة","error"); return; }
      if(skills.some(x=>x.length > 40)){ CodeUp.toast("اسم المهارة الواحدة حتى 40 حرفًا","error"); return; }
      if(skills.join(",").length > 600){ CodeUp.toast("قائمة المهارات طويلة جدًا","error"); return; }
      const achievements = v("#editAchievements").split("\n").map(x=>x.trim()).filter(Boolean);
      if(achievements.length > 20){ CodeUp.toast("الحد الأقصى 20 إنجازًا","error"); return; }
      if(achievements.join("\n").length > 4000){ CodeUp.toast("قائمة الإنجازات طويلة جدًا","error"); return; }
      // الروابط اختيارية؛ نضيف https:// تلقائيًا ونتحقق من النطاق (نفس قيد القاعدة)
      const fixUrl = x=> x && !/^https?:\/\//i.test(x) ? "https://"+x : x;
      const github = fixUrl(v("#editGithub")), linkedin = fixUrl(v("#editLinkedin"));
      if(github && !/^https:\/\/(www\.)?github\.com\/.+/i.test(github)){ CodeUp.toast("رابط GitHub يجب أن يكون من github.com","error"); return; }
      if(linkedin && !/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/.+/i.test(linkedin)){ CodeUp.toast("رابط LinkedIn يجب أن يكون من linkedin.com","error"); return; }
      const payload = {
        full_name: newName, university: v("#editUniversity")||null, major: v("#editMajor")||null, study_level: v("#editStudyLevel")||null,
        skills, achievements, github_url: github||null, linkedin_url: linkedin||null
      };
      try{
        await CodeUp.withBtnLoading(e.target, async ()=>{
          await db.from("profiles").update(payload).eq("id", this.ctx.user.id).throwOnError();
          Object.assign(this.ctx.profile, payload);
          this.refreshTopAvatar();
          CodeUp.toast("تم حفظ التعديلات", "success");
        });
        if(this.view.name==="profile") this.renderProfile(this.view.profileId);
      }catch(err){ CodeUp.toast(err.message||"تعذّر الحفظ", "error"); }
    };

    // ---------- Google Wallet ----------
    (async ()=>{
      const btn = m.el.querySelector("#googleWalletBtn");
      const label = m.el.querySelector("#googleWalletBtnLabel");
      let currentStatus = "not_created";

      const setState = (state)=>{
        currentStatus = state;
        btn.classList.remove("danger");
        btn.disabled = false;
        if(state==="loading"){ label.textContent = "جاري تجهيز البطاقة..."; btn.disabled = true; }
        else if(state==="updating"){ label.textContent = "جاري التحديث..."; btn.disabled = true; }
        else if(state==="active"){ label.textContent = "فتح Google Wallet"; }
        else if(state==="sync_failed"){ label.textContent = "تعذّر تجهيز البطاقة — إعادة المحاولة"; btn.classList.add("danger"); }
        else{ label.textContent = "إضافة إلى Google Wallet"; }
      };

      // الحالة الأولية من قاعدة البيانات مباشرة (بدون استدعاء الدالة) — توفير على الاستدعاءات
      try{
        const { data: existing } = await db.from("membership_wallet_passes").select("status").eq("user_id", this.ctx.user.id).maybeSingle();
        if(existing) setState(existing.status);
      }catch(_e){ /* أول مرة للمستخدم: العمود لسه مش موجود، تبقى الحالة الافتراضية */ }

      btn.onclick = async ()=>{
        const wasReady = currentStatus === "active";
        setState(wasReady ? "updating" : "loading");
        try{
          const {data:{session}} = await db.auth.getSession();
          const res = await fetch(`${SUPABASE_URL}/functions/v1/google-wallet`, {
            method:"POST",
            headers:{"Authorization":`Bearer ${session.access_token}`, "Content-Type":"application/json"},
            body: JSON.stringify({action:"get_or_create"})
          });
          const out = await res.json();
          if(!res.ok || out.error) throw new Error(out.error || "تعذّر تجهيز البطاقة");
          setState("active");
          window.open(out.add_to_wallet_url, "_blank");
        }catch(err){
          setState("sync_failed");
          CodeUp.toast("تعذّر تجهيز بطاقة Google Wallet، حاول مرة أخرى", "error");
        }
      };
    })();

    m.el.querySelector("#deleteAccountStep1").onclick = async ()=>{
      const step1 = await this.confirmDialog({title:"حذف الحساب نهائيًا", message:"هذا الإجراء نهائي ولا يمكن التراجع عنه.", confirmLabel:"متابعة", danger:true});
      if(!step1) return;
      const typed = await this.promptDialog({title:"تأكيد نهائي", message:'اكتب كلمة "حذف" بالضبط للمتابعة:', confirmLabel:"حذف حسابي", danger:true});
      if(typed !== "حذف"){ if(typed!==null) CodeUp.toast("لم يتطابق النص — تم الإلغاء", "info"); return; }
      try{
        const {data:{session}} = await db.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
          method:"POST", headers:{"Authorization":`Bearer ${session.access_token}`}
        });
        const json = await res.json();
        if(!res.ok || json.error) throw new Error(json.error||"تعذّر حذف الحساب");
        await db.auth.signOut();
        window.location.reload();
      }catch(e){ CodeUp.toast(e.message,"error"); }
    };
  },

  async renderSearch(){
    this.crumbTrail([], {title:"البحث", back: ()=>this.go({name:"home", homeTab:"feed"})});
    this.root.innerHTML = `
      <div class="card2" style="margin-top:14px">
        <input type="text" id="globalSearchInput" placeholder="ابحث عن منشور أو شخص…" style="width:100%">
      </div>
      <div id="searchResults" style="margin-top:14px"><div class="emptyState">اكتب للبحث.</div></div>`;
    document.getElementById("globalSearchInput").oninput = CodeUp.debounce(async (e)=>{
      const q = e.target.value.trim();
      const box = document.getElementById("searchResults");
      if(q.length < 2){ box.innerHTML = `<div class="emptyState">اكتب حرفين على الأقل.</div>`; return; }
      box.innerHTML = skeletonRowsHtml(4);
      try{
        const [peopleRes, postsRes] = await Promise.all([
          db.from("profiles").select("id,full_name").ilike("full_name", `%${q}%`).neq("id", this.ctx.user.id).limit(10),
          db.from("posts").select("*, profiles(full_name)").eq("status","published").ilike("content", `%${q}%`).order("created_at",{ascending:false}).limit(15)
        ]);
        if(peopleRes.error) throw peopleRes.error;
        if(postsRes.error) throw postsRes.error;
        const people = peopleRes.data, posts = postsRes.data;
        box.innerHTML = `
          ${(people||[]).length?`<h3 class="eyebrow">أشخاص</h3>${(people||[]).map(p=>`<div class="convRow" data-goprofile="${p.id}"><div class="convAvatar">${CodeUp.escapeHtml((p.full_name||"?")[0])}</div><div class="convInfo"><b>${CodeUp.escapeHtml(p.full_name||"")}</b></div></div>`).join("")}`:""}
          ${(posts||[]).length?`<h3 class="eyebrow" style="margin-top:14px">منشورات</h3>${(posts||[]).map(p=>`<div class="card2"><b>${CodeUp.escapeHtml(p.profiles?.full_name||"")}</b><div class="body">${CodeUp.escapeHtml(p.content||"")}</div></div>`).join("")}`:""}
          ${!(people||[]).length && !(posts||[]).length ? `<div class="emptyState">لا نتائج.</div>` : ""}
        `;
        box.querySelectorAll("[data-goprofile]").forEach(row=> row.onclick = ()=> this.go({name:"profile", profileId: row.dataset.goprofile}));
      }catch(err){
        box.innerHTML = `<div class="emptyState">تعذّر إتمام البحث الآن.</div>`;
        CodeUp.toast(err.message || "خطأ بالبحث", "error");
      }
    }, 300);
  },

  openTabDrawer(tabs, activeTab, onSelect){
    const bg=document.createElement("div");bg.className="drawerBg";
    const drawer=document.createElement("div");drawer.className="drawer";
    drawer.innerHTML = `<h4>القائمة</h4>` + tabs.map(([key,label])=>
      `<button class="drawerItem ${key===activeTab?'active':''}" data-tab="${key}">${label}</button>`).join("");
    bg.appendChild(drawer);
    document.body.appendChild(bg);
    requestAnimationFrame(()=>{bg.classList.add("open");drawer.classList.add("open")});
    function close(){
      bg.classList.remove("open");drawer.classList.remove("open");
      setTimeout(()=>bg.remove(),220);
    }
    bg.addEventListener("click",e=>{if(e.target===bg)close()});
    drawer.querySelectorAll("[data-tab]").forEach(b=>{
      b.onclick=()=>{ close(); if(b.dataset.tab!==activeTab) onSelect(b.dataset.tab); };
    });
  },

  modal(innerHtml, onClose){
    const bg=document.createElement("div");bg.className="modalBg";
    bg.innerHTML=`<div class="modal">${innerHtml}<div style="margin-top:16px;text-align:end"><button class="btn" id="modalClose">إغلاق</button></div></div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click",e=>{if(e.target===bg)close()});
    function close(){bg.remove();if(onClose)onClose();}
    bg.querySelector("#modalClose").onclick=close;
    return {close, el:bg};
  },

  // نافذة تأكيد مخصصة بديل confirm()/window.confirm() الافتراضي بالمتصفح — بنفس هوية CodeUp
  // البصرية (ألوان، حواف، Dark mode، RTL). ترجع Promise<boolean> بدل قيمة confirm() المباشرة.
  // مثال: if(!await App.confirmDialog({title:"مغادرة الفريق", message:"..."})) return;
  confirmDialog({title, message, confirmLabel="تأكيد", cancelLabel="إلغاء", danger=false}){
    return new Promise(resolve=>{
      const bg=document.createElement("div");bg.className="modalBg";
      bg.innerHTML=`<div class="modal confirmDialog">
        <h3>${CodeUp.escapeHtml(title)}</h3>
        ${message?`<p>${CodeUp.escapeHtml(message)}</p>`:""}
        <div class="confirmActions">
          <button class="btn" id="cdCancel">${CodeUp.escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger?"danger":"dark"}" id="cdConfirm">${CodeUp.escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
      const finish = (result)=>{ bg.remove(); resolve(result); };
      bg.addEventListener("click", e=>{ if(e.target===bg) finish(false); });
      bg.querySelector("#cdCancel").onclick = ()=>finish(false);
      bg.querySelector("#cdConfirm").onclick = ()=>finish(true);
    });
  },

  // نافذة إدخال قيمة واحدة بديل prompt() الافتراضي — ترجع Promise<string|null>.
  promptDialog({title, message, defaultValue="", placeholder="", confirmLabel="تأكيد", danger=false}){
    return new Promise(resolve=>{
      const bg=document.createElement("div");bg.className="modalBg";
      bg.innerHTML=`<div class="modal confirmDialog">
        <h3>${CodeUp.escapeHtml(title)}</h3>
        ${message?`<p>${CodeUp.escapeHtml(message)}</p>`:""}
        <input id="pdInput" style="margin-top:10px" value="${CodeUp.escapeHtml(defaultValue)}" placeholder="${CodeUp.escapeHtml(placeholder)}">
        <div class="confirmActions">
          <button class="btn" id="pdCancel">إلغاء</button>
          <button class="btn ${danger?"danger":"dark"}" id="pdConfirm">${CodeUp.escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
      const input = bg.querySelector("#pdInput");
      input.focus();
      const finish = (result)=>{ bg.remove(); resolve(result); };
      bg.addEventListener("click", e=>{ if(e.target===bg) finish(null); });
      bg.querySelector("#pdCancel").onclick = ()=>finish(null);
      bg.querySelector("#pdConfirm").onclick = ()=>finish(input.value);
      input.onkeydown = (e)=>{ if(e.key==="Enter") finish(input.value); };
    });
  },

  // نافذة سفلية (Bottom Sheet) على الموبايل، ومنتصف الشاشة على الشاشات الأكبر — لأي نموذج
  // (مثل إنشاء فريق) بدل prompt() الافتراضي بالمتصفح. innerHtml يحدد محتواه بالكامل (تسمية،
  // حقول، زر حفظ)؛ العنصر نفسه يُغلق تلقائيًا بالنقر خارج الورقة.
  sheet(innerHtml, onClose){
    const bg=document.createElement("div");bg.className="modalBg sheetMode";
    bg.innerHTML=`<div class="modal"><div class="sheetGrip"></div>${innerHtml}</div>`;
    document.body.appendChild(bg);
    function close(){bg.remove();if(onClose)onClose();}
    bg.addEventListener("click",e=>{if(e.target===bg)close()});
    return {close, el:bg};
  },

  // نافذة بترويسة ثابتة (عنوان + زر إغلاق دائم الظهور) ومنطقة تمرير مستقلة للمحتوى —
  // تُستخدم لأي قائمة يُحتمل أن تطول (الإشعارات مثلاً) حتى يبقى زر الإغلاق قابلاً للوصول دومًا.
  modalScrollable(title, bodyHtml, onClose){
    const bg=document.createElement("div");bg.className="modalBg";
    bg.innerHTML=`<div class="modal modalFixedShell">
      <div class="modalStickyHead"><h3>${title}</h3><button class="btn" id="modalScrollClose">إغلاق</button></div>
      <div class="modalScrollBody">${bodyHtml}</div>
    </div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click",e=>{if(e.target===bg)close()});
    function close(){
      bg.remove();
      if(App._openNotifModal===api) App._openNotifModal=null;
      if(onClose) onClose();
    }
    bg.querySelector("#modalScrollClose").onclick=close;
    const api = {close, el:bg, body: bg.querySelector(".modalScrollBody")};
    return api;
  },

  async render(){
    this.root.innerHTML = `${loadingHtml()}`;
    this.updateBottomNavActive();
    if(this.view.name==="home") return this.renderHome(this.view.homeTab);
    if(this.view.name==="course") return this.renderCourse(this.view.courseId, this.view.tab||"learning");
    if(this.view.name==="lesson") return this.renderLessonPage(this.view.courseId, this.view.courseSlug, this.view.lessonId);
    if(this.view.name==="messages") return this.renderMessages(this.view.conversationId);
    if(this.view.name==="profile") return this.renderProfile(this.view.profileId);
    if(this.view.name==="search") return this.renderSearch();
    if(this.view.name==="marketplace_listing") return this.renderMarketplaceListing(this.view.listingId);
  },

  async renderHome(tab){
    tab = tab || this.view.homeTab || "feed";
    this.crumbs.classList.add("hidden");

    // التابات تُرسم داخل الفتحة الدائمة #mobileTabSlot (بمنطقة الهيدر الموحّدة) بدل
    // #viewRoot — حتى تنزلق مع بقية الهيدر كوحدة واحدة أثناء التمرير بالهاتف، بدل
    // ما تكون عنصر مستقل يتحرك بسرعة مختلفة عن باقي شريط التنقل العلوي.
    const tabSlot = document.getElementById("mobileTabSlot");
    tabSlot.innerHTML = `
      <div class="fbTabBar">
        <button data-hometab="feed" class="${tab==='feed'?'active':''}"><span class="tabIcon">${Icon('home')}</span>الرئيسية</button>
        <button data-hometab="courses" class="${tab==='courses'?'active':''}"><span class="tabIcon">${Icon('learning')}</span>الكورسات</button>
        <button data-hometab="university" class="${tab==='university'?'active':''}"><span class="tabIcon">${Icon('university')}</span>University</button>
        ${this.ctx.techWeekEnabled?`<button data-hometab="tech_week" class="${tab==='tech_week'?'active':''}"><span class="tabIcon">${Icon('zap')}</span>الأسبوع التقني</button>`:""}
        ${this.ctx.marketplaceEnabled?`<button data-hometab="marketplace" class="${tab==='marketplace'?'active':''}"><span class="tabIcon">${Icon('shopping_bag')}</span>Marketplace</button>`:""}
      </div>`;
    tabSlot.querySelectorAll("[data-hometab]").forEach(b=>{
      b.onclick = ()=>{ this.view = {name:"home", homeTab:b.dataset.hometab}; this.renderHome(b.dataset.hometab); };
    });
    // يضمن إن التاب النشط يظهر كاملًا (بدون قصّ زي "ketplace") حتى لو كان بطرف الشريط
    const activeTabBtn = tabSlot.querySelector("[data-hometab].active");
    if(activeTabBtn) activeTabBtn.scrollIntoView({inline:"nearest", block:"nearest"});
    this.root.innerHTML = `<div id="homeBody"></div>`;
    this.syncHeaderHeight();

    const body = document.getElementById("homeBody");
    // لو المستخدم وصل لتاب متوقف حاليًا (رابط قديم محفوظ، أو الأدمن أوقفه
    // أثناء تصفّحه) — رجوع آمن للرئيسية بدل صفحة فاضية أو خطأ.
    if(tab === "tech_week" && !this.ctx.techWeekEnabled){ this.view = {name:"home", homeTab:"feed"}; return this.renderHome("feed"); }
    if(tab === "marketplace" && !this.ctx.marketplaceEnabled){ this.view = {name:"home", homeTab:"feed"}; return this.renderHome("feed"); }
    if(tab === "courses") return this.renderHomeCourses(body);
    if(tab === "university") return this.renderHomeUniversity(body);
    if(tab === "tech_week") return this.renderHomeTechWeek(body);
    if(tab === "marketplace") return this.renderHomeMarketplace(body);
    return this.renderHomeFeed(body);
  },

  // الأسبوع التقني — قسم مستقل تمامًا عن الكورسات والجامعة (تنظيم طلابي، فعاليات
  // ومسابقات وورش). عدد المسجّلين الفعلي لكل فعالية لا يظهر هنا عمدًا (RLS تمنع
  // الطالب من رؤية تسجيلات غيره) — يظهر فقط بلوحة تحكم الأدمن.
  async renderHomeTechWeek(body){
    body.innerHTML = `${loadingHtml()}`;
    const [{ data: events, error }, { data: myRegs }, { data: announcements }, { data: allTeams }] = await Promise.all([
      db.from("tech_week_events").select("*").eq("status","published").order("starts_at",{ascending:true,nullsFirst:false}),
      db.from("tech_week_registrations").select("event_id,status,team_id").eq("profile_id", this.ctx.user.id),
      db.from("tech_week_announcements").select("*").order("created_at",{ascending:false}).limit(10),
      db.from("tech_week_teams").select("*, tech_week_registrations(id,profile_id,status,profiles(full_name,avatar_url))")
    ]);
    if(error){
      body.innerHTML = `<div class="emptyState">تعذّر تحميل الأسبوع التقني. <button class="btn" id="twRetryBtn">إعادة المحاولة</button></div>`;
      const retryBtn = document.getElementById("twRetryBtn");
      if(retryBtn) retryBtn.onclick = ()=> this.renderHomeTechWeek(body);
      return;
    }

    const myRegMap = {};
    (myRegs||[]).forEach(r=>{ myRegMap[r.event_id] = r; });
    const TYPE_LABEL = {workshop:"ورشة", course:"دورة", competition:"مسابقة", talk:"جلسة نقاشية"};
    const teamsByEvent = {};
    (allTeams||[]).forEach(t=>{ (teamsByEvent[t.event_id] ||= []).push(t); });
    const myId = this.ctx.user.id;

    const teamCardHtml = (e, myTeamId, myStatus)=>{
      const teams = (teamsByEvent[e.id]||[]);
      if(myTeamId){
        const myTeam = teams.find(t=>t.id===myTeamId);
        const isLeader = myTeam?.leader_id === myId;
        const members = (myTeam?.tech_week_registrations||[]).filter(r=>r.status==='registered'||r.status==='attended');
        const pending = isLeader ? (myTeam?.tech_week_registrations||[]).filter(r=>r.status==='pending') : [];
        const isFull = e.team_max_size && members.length >= e.team_max_size;

        if(myStatus === 'pending'){
          return `
            <div class="twTeamCard">
              <div class="twTeamHead"><b>${CodeUp.escapeHtml(myTeam?.name||"")}</b><span class="pill neutral">قيد المراجعة</span></div>
              <p class="twTeamDesc">طلب انضمامك بانتظار موافقة قائد الفريق — بيوصلك إشعار إذا تم قبولك.</p>
              <div class="twActionsRow"><button class="btn danger" data-cancelreg="${e.id}" data-cancelkind="pending">إلغاء الطلب</button></div>
            </div>`;
        }

        return `
          <div class="twTeamCard" data-teamid="${myTeam.id}">
            <div class="twTeamHead">
              <b>${CodeUp.escapeHtml(myTeam?.name||"")}</b>
              <span class="pill ${isFull?'approved':'neutral'}">${isFull?'مكتمل':'مفتوح للانضمام'}</span>
            </div>
            ${myTeam?.description?`<p class="twTeamDesc">${CodeUp.escapeHtml(myTeam.description)}</p>`:""}
            <div class="twMetaRow">
              <span>👑 ${CodeUp.escapeHtml(members.find(m=>m.profile_id===myTeam?.leader_id)?.profiles?.full_name||"")}</span>
              <span>•</span>
              <span>${members.length}${e.team_max_size?`/${e.team_max_size}`:""} أعضاء</span>
              ${isLeader?`<span>•</span><span>${myTeam.join_policy==='approval'?'انضمام بموافقتك':'انضمام مفتوح'}</span>`:""}
            </div>
            <div class="twActionsRow"><button class="btn dark" data-teamchat="${myTeam?.id}">💬 محادثة الفريق (تيليجرام)</button></div>

            <div class="twSection">
              <p class="twSectionTitle">الأعضاء</p>
              ${members.map(m=>`
                <div class="twMemberRow">
                  ${CodeUp.avatarHtml(m.profiles?.full_name, m.profiles?.avatar_url, 30)}
                  <span class="twMemberName">${CodeUp.escapeHtml(m.profiles?.full_name||"")}${m.profile_id===myTeam?.leader_id?" — القائد":""}</span>
                  ${isLeader && m.profile_id!==myId ? `<div class="twMemberActions"><button class="btn danger" data-removemember="${m.id}" data-removemembername="${CodeUp.escapeHtml(m.profiles?.full_name||"")}">إزالة</button></div>` : ""}
                </div>`).join("")}
            </div>

            ${isLeader && pending.length ? `
              <div class="twSection">
                <p class="twSectionTitle">طلبات انضمام بانتظار موافقتك</p>
                ${pending.map(p=>`
                  <div class="twMemberRow">
                    ${CodeUp.avatarHtml(p.profiles?.full_name, p.profiles?.avatar_url, 30)}
                    <span class="twMemberName">${CodeUp.escapeHtml(p.profiles?.full_name||"")}</span>
                    <div class="twMemberActions">
                      <button class="btn dark" data-approvejoin="${p.id}">قبول</button>
                      <button class="btn danger" data-rejectjoin="${p.id}" data-rejectjoinname="${CodeUp.escapeHtml(p.profiles?.full_name||"")}">رفض</button>
                    </div>
                  </div>`).join("")}
              </div>` : ""}

            ${isLeader && members.length > 1 ? `
              <div class="twSection">
                <p class="twSectionTitle">تسليم القيادة</p>
                <select data-newleaderselect="${myTeam.id}" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)">
                  ${members.filter(m=>m.profile_id!==myId).map(m=>`<option value="${m.profile_id}" data-name="${CodeUp.escapeHtml(m.profiles?.full_name||"")}">${CodeUp.escapeHtml(m.profiles?.full_name||"")}</option>`).join("")}
                </select>
                <div class="twActionsRow"><button class="btn" data-transferleader="${myTeam.id}">تسليم القيادة</button></div>
              </div>` : ""}

            ${(!isLeader || members.length===1) ? `
              <div class="twActionsRow"><button class="btn danger" data-cancelreg="${e.id}" data-isleader="${isLeader}">مغادرة الفريق</button></div>
            ` : `<p class="small" style="margin-top:12px">لازم تسلّم القيادة لعضو آخر أولًا قبل ما تقدر تغادر الفريق.</p>`}
            ${isLeader ? `<div class="twActionsRow"><button class="btn danger" data-deleteteam="${myTeam.id}" data-deleteteamname="${CodeUp.escapeHtml(myTeam?.name||"")}">حذف الفريق نهائيًا</button></div>` : ""}
          </div>`;
      }
      const joinable = teams.filter(t=>{
        const active = (t.tech_week_registrations||[]).filter(r=>r.status==='registered'||r.status==='attended').length;
        return !e.team_max_size || active < e.team_max_size;
      });
      return `
        <div class="twActionsRow" style="margin-top:10px">
          <button class="btn dark" data-newteam="${e.id}">+ أنشئ فريق جديد</button>
        </div>
        ${joinable.length ? joinable.map(t=>{
          const active = (t.tech_week_registrations||[]).filter(r=>r.status==='registered'||r.status==='attended').length;
          return `<div class="twTeamCard">
            <div class="twTeamHead"><b>${CodeUp.escapeHtml(t.name)}</b><span class="pill neutral">${active}${e.team_max_size?`/${e.team_max_size}`:""}</span></div>
            ${t.description?`<p class="twTeamDesc">${CodeUp.escapeHtml(t.description)}</p>`:""}
            <div class="twActionsRow">
              <button class="btn" data-viewteam="${t.id}" data-viewteamevent="${e.id}">التفاصيل والأعضاء</button>
              <button class="btn ${t.join_policy==='approval'?'':'dark'}" data-jointeam="${t.id}" data-jointeamevent="${e.id}" data-jointeampolicy="${t.join_policy}">${t.join_policy==='approval'?'اطلب الانضمام':'انضم للفريق'}</button>
            </div>
          </div>`;
        }).join("") : `<p class="small" style="margin-top:8px">ما فيه فرق متاحة بعد — كون أول فريق!</p>`}`;
    };

    const eventCard = (e)=>{
      const myReg = myRegMap[e.id];
      const myStatus = myReg?.status;
      const isRegistered = myStatus === "registered" || myStatus === "attended";
      // بعد "مغادرة الفريق" أو "إلغاء الطلب" يصير status = "cancelled"، لكن team_id يبقى
      // بالصف كما هو (ما نصفّره عمدًا للحفاظ على السجل التاريخي) — فلازم هنا تحديدًا
      // نتجاهله ونعامل الشخص كأنه مو بفريق، وإلا يظل عالقًا يشوف واجهة "إدارة الفريق"
      // لفريق غادره فعلًا، بلا أي أعضاء فعّالين تظهر له (بما فيهم هو نفسه).
      const activeTeamId = (myStatus === "registered" || myStatus === "attended" || myStatus === "pending") ? (myReg?.team_id || null) : null;
      let actionHtml;
      if(e.registration_mode === "team"){
        if(myStatus === "attended"){
          actionHtml = `<span class="pill approved">حضر فريقك هذي الفعالية</span>`;
        }else if(!e.registration_open && !activeTeamId){
          actionHtml = `<span class="pill neutral">التسجيل مغلق حاليًا</span>`;
        }else{
          actionHtml = teamCardHtml(e, activeTeamId, myStatus);
        }
      }else if(myStatus === "attended"){
        actionHtml = `<span class="pill approved">حضرت هذي الفعالية</span>`;
      }else if(isRegistered){
        actionHtml = `<button class="btn danger" data-cancelreg="${e.id}" data-cancelkind="individual">إلغاء التسجيل</button>`;
      }else if(!e.registration_open){
        actionHtml = `<span class="pill neutral">التسجيل مغلق حاليًا</span>`;
      }else{
        actionHtml = `<button class="btn dark" data-register="${e.id}">سجّل الآن</button>`;
      }
      return `
        <div class="card2" data-eventcard="${e.id}">
          <div class="row" style="align-items:flex-start">
            <div style="min-width:0;flex:1">
              <span class="pill info">${TYPE_LABEL[e.type]||e.type}</span>
              ${e.registration_mode==='team'?`<span class="pill neutral">تسجيل بالفرق</span>`:""}
              <h3 style="margin:6px 0 2px">${CodeUp.escapeHtml(e.title)}</h3>
              ${e.description?`<p class="small" style="margin:0 0 6px">${CodeUp.escapeHtml(e.description)}</p>`:""}
              <div class="small" style="display:flex;flex-direction:column;gap:2px">
                ${e.starts_at?`<span><bdi dir="ltr">${CodeUp.formatDate(e.starts_at)}</bdi></span>`:""}
                ${e.location?`<span>${CodeUp.escapeHtml(e.location)}</span>`:""}
                ${e.speaker?`<span>${CodeUp.escapeHtml(e.speaker)}</span>`:""}
              </div>
            </div>
          </div>
          <div style="margin-top:10px">${actionHtml}</div>
        </div>`;
    };

    body.innerHTML = `
      ${(announcements||[]).length ? `
      <div class="sectionHead"><h3 class="eyebrow">إعلانات</h3></div>
      ${announcements.map(a=>`
        <div class="card2">
          <b>${CodeUp.escapeHtml(a.title)}</b>
          ${a.content?`<p class="small" style="margin-top:4px">${CodeUp.escapeHtml(a.content)}</p>`:""}
          <div class="small" style="margin-top:4px;color:var(--ink40)">${CodeUp.timeAgo(a.created_at)}</div>
        </div>`).join("")}
      ` : ""}

      <div class="sectionHead"><h3 class="eyebrow">الفعاليات</h3></div>
      ${(events||[]).length ? events.map(eventCard).join("") : `<div class="emptyState">لا توجد فعاليات منشورة حاليًا — تابعونا قريبًا.</div>`}
    `;

    body.querySelectorAll("[data-register]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        try{
          await db.from("tech_week_registrations").upsert({
            event_id: btn.dataset.register, profile_id: this.ctx.user.id, status: "registered"
          }, {onConflict: "event_id,profile_id"}).throwOnError();
          CodeUp.toast("تم تسجيلك بالفعالية", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر التسجيل — قد تكون السعة اكتملت أو التسجيل مغلق", "error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-cancelreg]").forEach(btn=>{
      btn.onclick = async ()=>{
        const kind = btn.dataset.cancelkind; // "individual" | "pending" | undefined (leaving an active team)
        const dialogText = kind === "individual"
          ? {title:"إلغاء التسجيل", message:"هل أنت متأكد أنك تريد إلغاء تسجيلك بهذي الفعالية؟", confirmLabel:"إلغاء التسجيل"}
          : kind === "pending"
          ? {title:"إلغاء طلب الانضمام", message:"هل أنت متأكد أنك تريد إلغاء طلب انضمامك لهذا الفريق؟", confirmLabel:"إلغاء الطلب"}
          : {title:"مغادرة الفريق", message:"هل أنت متأكد أنك تريد مغادرة هذا الفريق؟", confirmLabel:"مغادرة الفريق"};
        const ok = await this.confirmDialog({...dialogText, danger:true});
        if(!ok) return;
        btn.disabled = true;
        try{
          const { data, error } = await db.from("tech_week_registrations").update({status:"cancelled"})
            .eq("event_id", btn.dataset.cancelreg).eq("profile_id", this.ctx.user.id)
            .neq("status","cancelled").select();
          if(error) throw error;
          if(!data || !data.length){ CodeUp.toast("يبدو إنك خارج الفريق أصلًا — جارِ تحديث الصفحة", "error"); this.renderHomeTechWeek(body); return; }
          CodeUp.toast("تم إلغاء التسجيل", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message,"error"); btn.disabled = false; }
      };
    });

    body.querySelectorAll("[data-newteam]").forEach(btn=>{
      btn.onclick = ()=>{
        const eventId = btn.dataset.newteam;
        const sh = this.sheet(`
          <h3 style="margin:0 0 16px">إنشاء فريق جديد</h3>
          <label class="small">اسم الفريق</label>
          <input id="ntName" placeholder="مثال: The Debuggers" style="width:100%;margin-top:4px">
          <label class="small" style="margin-top:12px;display:block">وصف مختصر (اختياري)</label>
          <textarea id="ntDesc" rows="2" placeholder="فكرة سريعة عن فريقكم..." style="width:100%;margin-top:4px"></textarea>
          <label class="small" style="margin-top:14px;display:block">من يقدر ينضم؟</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
            <div class="choiceCard selected" data-policychoice="open">
              <b>انضمام مفتوح</b><span>أي طالب يقدر ينضم مباشرة بدون موافقتك</span>
            </div>
            <div class="choiceCard" data-policychoice="approval">
              <b>بموافقتي</b><span>لازم توافق أنت على كل طلب انضمام قبل ما يصير عضو</span>
            </div>
          </div>
          <div id="ntMsg" class="small" style="display:none;color:var(--red);margin-top:10px"></div>
          <div class="twActionsRow" style="margin-top:18px">
            <button class="btn" id="ntCancel">إلغاء</button>
            <button class="btn dark" id="ntSubmit">إنشاء الفريق</button>
          </div>
        `);
        let policy = "open";
        sh.el.querySelectorAll("[data-policychoice]").forEach(c=>{
          c.onclick = ()=>{
            sh.el.querySelectorAll("[data-policychoice]").forEach(x=>x.classList.remove("selected"));
            c.classList.add("selected");
            policy = c.dataset.policychoice;
          };
        });
        sh.el.querySelector("#ntCancel").onclick = sh.close;
        sh.el.querySelector("#ntSubmit").onclick = async ()=>{
          const nameInput = sh.el.querySelector("#ntName");
          const msgEl = sh.el.querySelector("#ntMsg");
          const name = nameInput.value.trim();
          if(!name){ msgEl.style.display="block"; msgEl.textContent="لازم تكتب اسم للفريق"; return; }
          const submitBtn = sh.el.querySelector("#ntSubmit");
          submitBtn.disabled = true;
          try{
            const { data: newTeam, error: rpcErr } = await db.rpc("tech_week_create_team", {
              p_event_id: eventId, p_name: name,
              p_description: sh.el.querySelector("#ntDesc").value.trim() || null, p_join_policy: policy
            });
            if(rpcErr) throw rpcErr;
            if(newTeam?.id) CodeUp.callTeamTopic(newTeam.id); // إنشاء Topic تيليجرام بالخلفية، فشله لا يمنع إنشاء الفريق
            CodeUp.toast("تم إنشاء الفريق والانضمام له", "success");
            sh.close();
            this.renderHomeTechWeek(body);
          }catch(e){
            const msg = e.code === "23505" ? "فيه فريق بنفس الاسم بهذي الفعالية بالفعل — اختر اسمًا آخر." : (e.message || "تعذّر إنشاء الفريق");
            msgEl.style.display="block"; msgEl.textContent = msg; submitBtn.disabled = false;
          }
        };
      };
    });

    const doJoinTeam = async (teamId, eventId, isApproval)=>{
      // قائد الفريق ينضم لفريقه مباشرة (registered) — سياسة القاعدة ترفض "pending" من القائد نفسه
      const { data: tm } = await db.from("tech_week_teams").select("leader_id").eq("id", teamId).maybeSingle();
      const isOwnTeam = tm?.leader_id === this.ctx.user.id;
      await db.from("tech_week_registrations").upsert({
        event_id: eventId, profile_id: this.ctx.user.id,
        status: (isApproval && !isOwnTeam) ? "pending" : "registered", team_id: teamId
      }, {onConflict: "event_id,profile_id"}).throwOnError();
    };

    body.querySelectorAll("[data-teamchat]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        const res = await CodeUp.callTeamTopic(btn.dataset.teamchat);
        btn.disabled = false;
        if(!res){ CodeUp.toast("تعذّر فتح محادثة الفريق حاليًا، حاول بعد قليل", "error"); return; }
        const sh = this.sheet(`
          <h3 style="margin:0 0 12px">محادثة الفريق</h3>
          <a class="btn dark" href="${res.url}" target="_blank" rel="noopener" style="display:block;text-align:center">فتح محادثة الفريق في تيليجرام</a>
          ${res.invite_url?`<p class="small" style="margin:12px 0 6px">أول مرة؟ انضم لمجتمع CodeUp أولًا ثم افتح المحادثة:</p>
          <a class="btn" href="${res.invite_url}" target="_blank" rel="noopener" style="display:block;text-align:center">الانضمام للمجتمع</a>`:""}
        `);
      };
    });

    body.querySelectorAll("[data-viewteam]").forEach(btn=>{
      btn.onclick = ()=>{
        const teamId = btn.dataset.viewteam;
        const eventId = btn.dataset.viewteamevent;
        const t = (teamsByEvent[eventId]||[]).find(x=>x.id===teamId);
        if(!t) return;
        const members = (t.tech_week_registrations||[]).filter(r=>r.status==='registered'||r.status==='attended');
        const isApproval = t.join_policy === "approval";
        const sh = this.sheet(`
          <h3 style="margin:0 0 4px">${CodeUp.escapeHtml(t.name)}</h3>
          ${t.description?`<p class="small" style="margin:0 0 12px">${CodeUp.escapeHtml(t.description)}</p>`:""}
          <div class="small" style="margin-bottom:10px">${members.length} ${members.length===1?"عضو":"أعضاء"} • ${isApproval?"انضمام بموافقة القائد":"انضمام مفتوح"}</div>
          <div class="twSection">
            <p class="twSectionTitle">الأعضاء</p>
            ${members.length ? members.map(m=>`
              <div class="twMemberRow">
                ${CodeUp.avatarHtml(m.profiles?.full_name, m.profiles?.avatar_url, 30)}
                <span class="twMemberName">${CodeUp.escapeHtml(m.profiles?.full_name||"")}${m.profile_id===t.leader_id?" — القائد":""}</span>
              </div>`).join("") : `<p class="small">ما فيه أعضاء بعد</p>`}
          </div>
          <div class="twActionsRow" style="margin-top:18px">
            <button class="btn" id="vtClose">رجوع</button>
            <button class="btn dark" id="vtJoin">${isApproval?"اطلب الانضمام":"انضم للفريق"}</button>
          </div>
        `);
        sh.el.querySelector("#vtClose").onclick = sh.close;
        sh.el.querySelector("#vtJoin").onclick = async ()=>{
          const joinBtn = sh.el.querySelector("#vtJoin");
          joinBtn.disabled = true;
          try{
            await doJoinTeam(teamId, eventId, isApproval);
            CodeUp.toast(isApproval ? "تم إرسال طلب الانضمام، بانتظار موافقة القائد" : "انضممت للفريق", "success");
            sh.close();
            this.renderHomeTechWeek(body);
          }catch(e){ CodeUp.toast(e.message || "تعذّر الانضمام — قد يكون الفريق اكتمل", "error"); joinBtn.disabled = false; }
        };
      };
    });

    body.querySelectorAll("[data-jointeam]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        const isApproval = btn.dataset.jointeampolicy === "approval";
        try{
          await doJoinTeam(btn.dataset.jointeam, btn.dataset.jointeamevent, isApproval);
          CodeUp.toast(isApproval ? "تم إرسال طلب الانضمام، بانتظار موافقة القائد" : "انضممت للفريق", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر الانضمام — قد يكون الفريق اكتمل", "error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-approvejoin]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        try{
          const { data, error } = await db.from("tech_week_registrations").update({status:"registered"}).eq("id", btn.dataset.approvejoin).select();
          if(error) throw error;
          if(!data || !data.length){ CodeUp.toast("تعذّر القبول — قد يكون الفريق اكتمل أو الطلب انسحب", "error"); this.renderHomeTechWeek(body); return; }
          CodeUp.toast("تم قبول العضو بالفريق", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر القبول — قد يكون الفريق اكتمل", "error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-rejectjoin]").forEach(btn=>{
      btn.onclick = async ()=>{
        const ok = await this.confirmDialog({
          title: "رفض طلب الانضمام",
          message: `هل أنت متأكد أنك تريد رفض طلب ${btn.dataset.rejectjoinname||"هذا الطالب"}؟`,
          confirmLabel: "رفض الطلب", danger: true
        });
        if(!ok) return;
        btn.disabled = true;
        try{
          const { data, error } = await db.from("tech_week_registrations").update({status:"cancelled"}).eq("id", btn.dataset.rejectjoin).select();
          if(error) throw error;
          if(!data || !data.length){ CodeUp.toast("الطلب مو موجود بعد الحين — جارِ تحديث الصفحة", "error"); this.renderHomeTechWeek(body); return; }
          CodeUp.toast("تم رفض الطلب", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message,"error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-removemember]").forEach(btn=>{
      btn.onclick = async ()=>{
        const ok = await this.confirmDialog({
          title: "إزالة عضو",
          message: `هل أنت متأكد أنك تريد إزالة ${btn.dataset.removemembername||"هذا العضو"} من الفريق؟`,
          confirmLabel: "إزالة العضو", danger: true
        });
        if(!ok) return;
        btn.disabled = true;
        try{
          const { data, error } = await db.from("tech_week_registrations").update({status:"cancelled"}).eq("id", btn.dataset.removemember).select();
          if(error) throw error;
          if(!data || !data.length){ CodeUp.toast("تعذّر إزالة العضو — جرّب تحدّث الصفحة", "error"); this.renderHomeTechWeek(body); return; }
          CodeUp.toast("تمت إزالة العضو من الفريق", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر إزالة العضو", "error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-transferleader]").forEach(btn=>{
      btn.onclick = async ()=>{
        const teamId = btn.dataset.transferleader;
        const select = body.querySelector(`[data-newleaderselect="${teamId}"]`);
        const newLeaderId = select?.value;
        const newLeaderName = select?.selectedOptions?.[0]?.dataset?.name || "هذا العضو";
        if(!newLeaderId) return;
        const ok = await this.confirmDialog({
          title: "نقل قيادة الفريق",
          message: `هل أنت متأكد من نقل القيادة إلى ${newLeaderName}؟ بعد النقل تصبح عضوًا عاديًا بالفريق.`,
          confirmLabel: "نقل القيادة"
        });
        if(!ok) return;
        btn.disabled = true;
        try{
          const { data, error } = await db.from("tech_week_teams").update({leader_id: newLeaderId}).eq("id", teamId).select();
          if(error) throw error;
          if(!data || !data.length){ CodeUp.toast("تعذّر تسليم القيادة — جرّب تحدّث الصفحة", "error"); this.renderHomeTechWeek(body); return; }
          CodeUp.toast("تم تسليم القيادة", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر تسليم القيادة", "error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-deleteteam]").forEach(btn=>{
      btn.onclick = async ()=>{
        const ok = await this.confirmDialog({
          title: "حذف الفريق نهائيًا",
          message: `هل أنت متأكد أنك تريد حذف فريق "${btn.dataset.deleteteamname||""}"؟ سيتم إخراج كل الأعضاء منه ولا يمكن التراجع عن هذا الإجراء.`,
          confirmLabel: "حذف الفريق", danger: true
        });
        if(!ok) return;
        btn.disabled = true;
        try{
          const { data, error } = await db.from("tech_week_teams").delete().eq("id", btn.dataset.deleteteam).select();
          if(error) throw error;
          if(!data || !data.length){ CodeUp.toast("تعذّر حذف الفريق — جرّب تحدّث الصفحة", "error"); this.renderHomeTechWeek(body); return; }
          CodeUp.toast("تم حذف الفريق", "success");
          this.renderHomeTechWeek(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر حذف الفريق", "error"); btn.disabled = false; }
      };
    });
  },

  // ---------------- CodeUp Marketplace ----------------
  // نفس منطق الصلاحيات والحالات المُنفَّذ بالكامل بقاعدة البيانات (RPCs ذرية +
  // Trigger يمنع تعديل status مباشرة) — الواجهة هنا للعرض والاستدعاء فقط،
  // بدون أي منطق حساس على الفرونت إند.
  mpTypeLabel(t){ return {sale:"للبيع", exchange:"للاستبدال", borrow:"للإعارة", free:"مجاني"}[t] || t; },
  mpStatusLabel(s, listingType){
    if(listingType==='sale' && s==='reserved') return "تم الاتفاق";
    return {pending_review:"بانتظار مراجعة الأدمن", active:"متاح", reserved:"محجوز", sold:"تم البيع",
      borrowed:"معار حاليًا", exchanged:"تم الاستبدال", given_away:"تم الإهداء", cancelled:"ملغى", rejected:"مرفوض"}[s] || s;
  },
  mpConditionLabel(c){ return {new:"جديد", like_new:"شبه جديد", good:"جيد", acceptable:"مقبول", needs_repair:"يحتاج إصلاح"}[c] || c; },

  async renderHomeMarketplace(body){
    body.innerHTML = `${loadingHtml()}`;
    const [{ data: categories }, { data: listings, error }, { data: isAdminRes }] = await Promise.all([
      db.from("marketplace_categories").select("*").order("order_index"),
      db.from("marketplace_listings").select("id,title,price,listing_type,status,category_id,owner_id,created_at, marketplace_categories(name), owner:profiles!marketplace_listings_owner_id_fkey(full_name,avatar_url)")
        .order("created_at",{ascending:false}).limit(60),
      db.rpc("is_super_admin", {uid: this.ctx.user.id})
    ]);
    if(error){
      body.innerHTML = `<div class="emptyState">تعذّر تحميل Marketplace. <button class="btn" id="mpRetryBtn">إعادة المحاولة</button></div>`;
      body.querySelector("#mpRetryBtn").onclick = ()=> this.renderHomeMarketplace(body);
      return;
    }
    // file_uploads.related_id عمود عام بدون FK حقيقي (يُستخدم لأنواع محتوى متعددة)،
    // فما يقدر Supabase يدمجه تلقائيًا داخل استعلام marketplace_listings — نجيبه بطلب واحد مجمّع (مو طلب
    // منفصل لكل منتج، عشان ما نطيح بمشكلة N+1) ونربطه يدويًا.
    const listingIds = listings.map(l=>l.id);
    const { data: allFiles } = listingIds.length
      ? await db.from("file_uploads").select("id,storage_path,related_id").eq("related_type","marketplace_listing").in("related_id", listingIds)
      : { data: [] };
    const filesByListing = {};
    (allFiles||[]).forEach(f=>{ (filesByListing[f.related_id] ||= []).push(f); });

    const isAdmin = !!isAdminRes;
    const mine = listings.filter(l=>l.owner_id===this.ctx.user.id);
    const pendingReview = isAdmin ? listings.filter(l=>l.status==='pending_review') : [];

    let activeCategory = "";
    let searchQuery = "";

    // أول 4 بطاقات (أول صفّين تقريبًا بشبكة عمودين) تُحمَّل فورًا (loading="eager") عشان الصورة الأولى
    // تظهر بسرعة بدون تأخير الـlazy loading — الباقي أسفل الشاشة يتحمّل lazy فقط عند الحاجة.
    const cardHtml = (l, idx)=>{
      const img = (filesByListing[l.id]||[])[0];
      const eager = idx < 4;
      return `<button class="mpCard" data-mplisting="${l.id}">
        <div class="mpCardImgWrap">
          ${img ? `
            <div class="skeleton" data-mpskeleton></div>
            <img class="mpCardImg" data-mpthumb="${img.id}"
                 alt="صورة منتج: ${CodeUp.escapeHtml(l.title)}"
                 loading="${eager?'eager':'lazy'}" decoding="async" width="400" height="300">
          ` : `<div class="mpCardImgPlaceholder">${Icon('shopping_bag')}<span>لا توجد صورة</span></div>`}
        </div>
        <div class="mpCardBody">
          <div class="mpCardTitle">${CodeUp.escapeHtml(l.title)}</div>
          ${l.listing_type==='sale' && l.price!=null ? `<div class="mpCardPrice">${l.price} ج.س</div>` : ""}
          <div class="mpCardFooter">
            <span class="mpBadge ${l.listing_type}">${this.mpTypeLabel(l.listing_type)}</span>
            ${l.status!=='active' ? `<span class="mpBadge ${l.status==='sold'?'status-active':l.status==='reserved'?'status-warn':'status-neutral'}">${this.mpStatusLabel(l.status, l.listing_type)}</span>` : ""}
            <span class="mpCardSeller">${CodeUp.avatarHtml(l.owner?.full_name, l.owner?.avatar_url, 16)}</span>
          </div>
        </div>
      </button>`;
    };

    const renderResultsGrid = ()=>{
      const gridEl = body.querySelector("#mpResultsGrid");
      if(!gridEl) return;
      let results = listings.filter(l=> l.status==='active' || l.owner_id===this.ctx.user.id);
      if(activeCategory) results = results.filter(l=>l.category_id===activeCategory);
      if(searchQuery) results = results.filter(l=>l.title.toLowerCase().includes(searchQuery));
      if(!results.length){
        gridEl.outerHTML = `<p class="emptyState" id="mpResultsGrid" style="display:block">ما فيه نتائج مطابقة.</p>`;
        return;
      }
      gridEl.className = "mpGrid";
      gridEl.innerHTML = results.map((l,i)=>cardHtml(l,i)).join("");
      wireCardClicks();
      loadThumbs();
    };

    const wireCardClicks = ()=>{
      body.querySelectorAll("[data-mplisting]").forEach(btn=>{
        btn.onclick = ()=> this.go({name:"marketplace_listing", listingId: btn.dataset.mplisting});
      });
    };
    // كل بطاقة: نجرّب رابط صورة محسّن (مصغّر ومضغوط) أولًا؛ لو الميزة غير مفعّلة أو فشلت،
    // CodeUp.getOptimizedSignedUrl نفسها ترجع تلقائيًا للرابط الأصلي (بدون كسر). ولو فشل تحميل
    // الصورة بالمتصفح نفسه (onerror) نجرّب مرة واحدة إضافية بالرابط الأصلي الكامل، وإلا نعرض Placeholder.
    const loadThumbs = ()=>{
      body.querySelectorAll("[data-mpthumb]").forEach(async (img)=>{
        const fileId = img.dataset.mpthumb;
        const owner = (allFiles||[]).find(f=>f.id===fileId);
        const wrap = img.closest(".mpCardImgWrap");
        if(!owner?.storage_path){ return; }
        const showPlaceholder = ()=>{
          if(wrap) wrap.innerHTML = `<div class="mpCardImgPlaceholder">${Icon('shopping_bag')}<span>تعذّر تحميل الصورة</span></div>`;
        };
        img.onload = ()=>{
          img.classList.add("loaded");
          wrap?.querySelector("[data-mpskeleton]")?.remove();
        };
        let triedFallback = false;
        img.onerror = async ()=>{
          if(triedFallback){ showPlaceholder(); return; }
          triedFallback = true;
          try{ img.src = await CodeUp.getSignedUrl("submissions", owner.storage_path); }
          catch(e){ showPlaceholder(); }
        };
        try{
          img.src = await CodeUp.getOptimizedSignedUrl("submissions", owner.storage_path, {width:400, quality:65});
        }catch(e){ showPlaceholder(); }
      });
    };

    body.innerHTML = `
      <div class="mpHeader">
        <h2>CodeUp Marketplace</h2>
        <p class="mpHeaderDesc">سوق مجتمعي للبيع والشراء والاستبدال والإعارة ومشاركة المنتجات بين أعضاء CodeUp.</p>
      </div>
      <div class="mpToolbar">
        <div class="mpSearchWrap">${Icon('search')}<input id="mpSearchInput" placeholder="ابحث عن منتج…"></div>
        <button class="btn dark mpAddBtn" id="mpNewBtn">+ إضافة منتج</button>
      </div>
      <div class="mpChipsRow" id="mpChipsRow">
        <button class="mpChip active" data-mpchip="">الكل</button>
        ${(categories||[]).map(c=>`<button class="mpChip" data-mpchip="${c.id}">${CodeUp.escapeHtml(c.name)}</button>`).join("")}
      </div>

      ${pendingReview.length ? `
      <p class="mpSectionLabel">بانتظار مراجعتك (أدمن)</p>
      <div class="mpGrid">${pendingReview.map(l=>`
        <div class="mpCard" style="cursor:default;flex-direction:column;align-items:stretch">
          <div class="mpCardTitle">${CodeUp.escapeHtml(l.title)}</div>
          <div class="mpCardPrice">${l.price??''} ج.س</div>
          <div class="twActionsRow" style="margin-top:2px">
            <button class="btn dark" data-mpadminapprove="${l.id}" style="padding:6px 10px;font-size:12px">اعتماد</button>
            <button class="btn" data-mpadminreject="${l.id}" style="padding:6px 10px;font-size:12px">رفض</button>
          </div>
        </div>`).join("")}</div>
      ` : ""}

      ${mine.length ? `<p class="mpSectionLabel">إعلاناتي</p>` : ""}
      <div class="mpGrid" id="mpResultsGrid"></div>
    `;

    // نعرض إعلاناتي دائمًا أولًا ثم المتاح — يتحقق من خلال ترتيب results نفسه (owner أولًا غير مضمون ترتيبًا،
    // فنكتفي بتضمينها ضمن النتائج القابلة للفلترة نفسها بدل تكرار قسم منفصل يعقّد البحث/الفلاتر)
    renderResultsGrid();
    wireCardClicks();

    body.querySelector("#mpSearchInput").oninput = CodeUp.debounce((e)=>{
      searchQuery = e.target.value.trim().toLowerCase();
      renderResultsGrid();
    }, 200);

    body.querySelectorAll("[data-mpchip]").forEach(chip=>{
      chip.onclick = ()=>{
        body.querySelectorAll("[data-mpchip]").forEach(c=>c.classList.remove("active"));
        chip.classList.add("active");
        activeCategory = chip.dataset.mpchip;
        renderResultsGrid();
      };
    });

    body.querySelector("#mpNewBtn").onclick = ()=> this.openMarketplaceCreateForm(categories, ()=> this.renderHomeMarketplace(body));

    body.querySelectorAll("[data-mpadminapprove]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        try{
          await db.rpc("marketplace_admin_review_listing", {p_listing_id: btn.dataset.mpadminapprove, p_decision: "active"}).throwOnError();
          CodeUp.toast("تم اعتماد الإعلان", "success");
          this.renderHomeMarketplace(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر الاعتماد", "error"); btn.disabled = false; }
      };
    });
    body.querySelectorAll("[data-mpadminreject]").forEach(btn=>{
      btn.onclick = async ()=>{
        const ok = await this.confirmDialog({title:"رفض الإعلان", message:"هل أنت متأكد من رفض هذا الإعلان؟", confirmLabel:"رفض", danger:true});
        if(!ok) return;
        btn.disabled = true;
        try{
          await db.rpc("marketplace_admin_review_listing", {p_listing_id: btn.dataset.mpadminreject, p_decision: "rejected"}).throwOnError();
          CodeUp.toast("تم رفض الإعلان", "success");
          this.renderHomeMarketplace(body);
        }catch(e){ CodeUp.toast(e.message || "تعذّر الرفض", "error"); btn.disabled = false; }
      };
    });
  },

  // نموذج إضافة إعلان — نافذة بترويسة ثابتة (المحتوى قد يطول مع اختيار النوع والصور)
  openMarketplaceCreateForm(categories, onDone){
    const catOptions = (categories||[]).map(c=>`<option value="${c.id}">${CodeUp.escapeHtml(c.name)}</option>`).join("");
    const pendingFiles = []; // {file, previewUrl}
    const modal = this.modalScrollable("إضافة منتج جديد", `
      <div class="mpFormRow"><label>عنوان المنتج</label><input id="mpfTitle" maxlength="100" placeholder="مثال: كتاب Algorithms"></div>
      <div class="mpFormRow"><label>الوصف</label><textarea id="mpfDesc" rows="3" placeholder="تفاصيل إضافية عن المنتج"></textarea></div>
      <div class="mpFormRow"><label>التصنيف</label><select id="mpfCategory"><option value="">بدون تصنيف</option>${catOptions}</select></div>
      <div class="mpFormRow"><label>الحالة</label>
        <select id="mpfCondition">
          <option value="new">جديد</option><option value="like_new">شبه جديد</option>
          <option value="good" selected>جيد</option><option value="acceptable">مقبول</option>
          <option value="needs_repair">يحتاج إصلاح</option>
        </select>
      </div>
      <div class="mpFormRow"><label>نوع العرض</label>
        <select id="mpfType">
          <option value="sale">للبيع</option><option value="exchange">للاستبدال</option>
          <option value="borrow">للإعارة</option><option value="free">مجاني</option>
        </select>
      </div>
      <div class="mpFormRow" id="mpfPriceRow"><label>السعر (ج.س)</label><input id="mpfPrice" type="number" min="0" step="1"></div>
      <div class="mpFormRow" id="mpfExchangeRow" style="display:none"><label>أرغب في استبداله بـ</label><input id="mpfExchange" placeholder="مثال: كتاب Calculus أو آلة حاسبة"></div>
      <div class="mpFormRow" id="mpfBorrowRow" style="display:none"><label>مدة الإعارة (أيام)</label><input id="mpfBorrowDays" type="number" min="1" step="1" value="7"></div>
      <div class="mpWarnBox" id="mpfSaleWarn">إعلانات البيع تحتاج موافقة أدمن قبل الظهور للعموم. الدفع والتسليم يتمان مباشرة بينك وبين الطرف الآخر — CodeUp لا يستلم أو يضمن أي مبلغ.</div>

      <div class="mpFormRow"><label>وسيلة التواصل (اختر واحدة على الأقل)</label></div>
      <div class="mpFormRow" style="display:flex;align-items:center;gap:8px;margin-top:0">
        <input type="checkbox" id="mpfWaEnable" style="width:auto"><label for="mpfWaEnable" style="margin:0">WhatsApp</label>
      </div>
      <div class="mpFormRow" id="mpfWaRow" style="display:none"><input id="mpfWaNumber" placeholder="+249912345678 (بصيغة دولية تبدأ بـ +)"></div>
      <div class="mpFormRow" style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <input type="checkbox" id="mpfTgEnable" style="width:auto"><label for="mpfTgEnable" style="margin:0">Telegram</label>
      </div>
      <div class="mpFormRow" id="mpfTgRow" style="display:none"><input id="mpfTgUsername" placeholder="@username"></div>

      <div class="mpFormRow"><label>الصور (حتى 3 صور)</label>
        <div class="mpImgPickRow" id="mpfImgRow"><button type="button" class="mpAddImgBtn" id="mpfAddImgBtn">+</button></div>
        <input type="file" id="mpfImgInput" accept="image/*" multiple style="display:none">
      </div>
      <div class="twActionsRow">
        <button class="btn" id="mpfCancelBtn">إلغاء</button>
        <button class="btn dark" id="mpfSubmitBtn">نشر الإعلان</button>
      </div>
    `);

    const waEnable = modal.el.querySelector("#mpfWaEnable"), waRow = modal.el.querySelector("#mpfWaRow");
    const tgEnable = modal.el.querySelector("#mpfTgEnable"), tgRow = modal.el.querySelector("#mpfTgRow");
    waEnable.onchange = ()=> waRow.style.display = waEnable.checked ? "" : "none";
    tgEnable.onchange = ()=> tgRow.style.display = tgEnable.checked ? "" : "none";

    const typeSelect = modal.el.querySelector("#mpfType");
    const syncTypeFields = ()=>{
      const t = typeSelect.value;
      modal.el.querySelector("#mpfPriceRow").style.display = t==='sale' ? "" : "none";
      modal.el.querySelector("#mpfExchangeRow").style.display = t==='exchange' ? "" : "none";
      modal.el.querySelector("#mpfBorrowRow").style.display = t==='borrow' ? "" : "none";
      modal.el.querySelector("#mpfSaleWarn").style.display = t==='sale' ? "" : "none";
    };
    typeSelect.onchange = syncTypeFields;
    syncTypeFields();

    const imgRow = modal.el.querySelector("#mpfImgRow");
    const addImgBtn = modal.el.querySelector("#mpfAddImgBtn");
    const imgInput = modal.el.querySelector("#mpfImgInput");
    const renderImgPicks = ()=>{
      imgRow.querySelectorAll(".mpImgPickThumb").forEach(n=>n.remove());
      pendingFiles.forEach((pf,i)=>{
        const div = document.createElement("div");
        div.className = "mpImgPickThumb";
        div.innerHTML = `<img src="${pf.previewUrl}"><button type="button" data-removeimg="${i}">×</button>`;
        imgRow.insertBefore(div, addImgBtn);
      });
      addImgBtn.style.display = pendingFiles.length >= 3 ? "none" : "";
      imgRow.querySelectorAll("[data-removeimg]").forEach(b=>{
        b.onclick = ()=>{ pendingFiles.splice(+b.dataset.removeimg,1); renderImgPicks(); };
      });
    };
    addImgBtn.onclick = ()=> imgInput.click();
    imgInput.onchange = ()=>{
      for(const f of imgInput.files){
        if(pendingFiles.length >= 3) break;
        if(!f.type.startsWith("image/")) continue;
        pendingFiles.push({file: f, previewUrl: URL.createObjectURL(f)});
      }
      imgInput.value = "";
      renderImgPicks();
    };

    modal.el.querySelector("#mpfCancelBtn").onclick = modal.close;
    modal.el.querySelector("#mpfSubmitBtn").onclick = async ()=>{
      const submitBtn = modal.el.querySelector("#mpfSubmitBtn");
      const title = modal.el.querySelector("#mpfTitle").value.trim();
      const description = modal.el.querySelector("#mpfDesc").value.trim();
      const category_id = modal.el.querySelector("#mpfCategory").value || null;
      const condition = modal.el.querySelector("#mpfCondition").value;
      const listing_type = typeSelect.value;
      const price = listing_type==='sale' ? Number(modal.el.querySelector("#mpfPrice").value||0) : null;
      const exchange_wanted_for = listing_type==='exchange' ? modal.el.querySelector("#mpfExchange").value.trim() : null;
      const borrow_duration_days = listing_type==='borrow' ? Number(modal.el.querySelector("#mpfBorrowDays").value||0) : null;
      const whatsapp = waEnable.checked ? modal.el.querySelector("#mpfWaNumber").value.trim() : null;
      const telegram = tgEnable.checked ? modal.el.querySelector("#mpfTgUsername").value.trim() : null;

      if(!title){ CodeUp.toast("اكتب عنوان المنتج", "error"); return; }
      if(listing_type==='sale' && !(price>=0)){ CodeUp.toast("أدخل سعرًا صحيحًا", "error"); return; }
      if(listing_type==='exchange' && !exchange_wanted_for){ CodeUp.toast("اكتب وش ترغب تستبدله", "error"); return; }
      if(listing_type==='borrow' && !(borrow_duration_days>0)){ CodeUp.toast("أدخل مدة إعارة صحيحة", "error"); return; }
      if(!whatsapp && !telegram){ CodeUp.toast("اختر وسيلة تواصل واحدة على الأقل (WhatsApp أو Telegram)", "error"); return; }
      if(waEnable.checked && !whatsapp){ CodeUp.toast("أدخل رقم WhatsApp أو ألغِ تفعيله", "error"); return; }
      if(tgEnable.checked && !telegram){ CodeUp.toast("أدخل يوزرنيم Telegram أو ألغِ تفعيله", "error"); return; }

      await CodeUp.withBtnLoading(submitBtn, async ()=>{
        try{
          // إنشاء الإعلان + وسيلة التواصل بعملية ذرية واحدة (RPC) — بدون تحقق إضافي هنا؛
          // كل قواعد العمل (السعر، الاستبدال، مدة الإعارة، صيغة الأرقام) تُفرض داخل قاعدة البيانات
          const { data: listing, error } = await db.rpc("marketplace_create_listing", {
            p_title: title, p_description: description || null, p_category_id: category_id,
            p_condition: condition, p_listing_type: listing_type, p_price: price,
            p_exchange_wanted_for: exchange_wanted_for, p_borrow_duration_days: borrow_duration_days,
            p_whatsapp: whatsapp, p_telegram: telegram
          }).single();
          if(error) throw error;

          for(const pf of pendingFiles){
            try{
              const up = await CodeUp.uploadMarketplaceImage(pf.file, this.ctx.user.id, listing.id);
              const { data: fileRow, error: fErr } = await db.from("file_uploads").insert({
                uploader_id: this.ctx.user.id, related_type: "marketplace_listing", related_id: listing.id,
                storage_path: up.path, file_name: up.name, mime_type: up.type, file_size: up.size
              }).select().single();
              if(fErr) throw fErr;
              CodeUp.triggerTelegramSend(fileRow.id);
            }catch(imgErr){ CodeUp.toast("تعذّر رفع إحدى الصور — يمكنك إضافتها لاحقًا", "error"); }
          }

          CodeUp.toast(listing_type==='sale' ? "تم إرسال إعلانك لمراجعة الأدمن" : "تم نشر إعلانك", "success");
          modal.close();
          if(onDone) onDone();
        }catch(e){ CodeUp.toast(e.message || "تعذّر نشر الإعلان", "error"); }
      });
    };
  },

  async renderMarketplaceListing(listingId){
    this.crumbTrail([{label:"Marketplace", onClick: ()=> this.go({name:"home", homeTab:"marketplace"})}], {title:"Marketplace", back: ()=> this.go({name:"home", homeTab:"marketplace"})});
    this.root.innerHTML = `${loadingHtml()}`;

    const [{ data: l, error }, { data: files }, { data: myReq }] = await Promise.all([
      db.from("marketplace_listings").select("*, marketplace_categories(name), owner:profiles!marketplace_listings_owner_id_fkey(id,full_name,avatar_url)").eq("id", listingId).single(),
      db.from("file_uploads").select("id,storage_path").eq("related_type","marketplace_listing").eq("related_id", listingId),
      db.from("marketplace_requests").select("*").eq("listing_id", listingId).eq("requester_id", this.ctx.user.id).order("created_at",{ascending:false}).limit(1)
    ]);
    if(error || !l){ this.root.innerHTML = `<div class="emptyState">تعذّر تحميل الإعلان.</div>`; return; }

    const isOwner = l.owner_id === this.ctx.user.id;
    const myActiveReq = (myReq||[]).find(r=>r.status==='pending'||r.status==='accepted');

    let ownerRequests = [];
    if(isOwner){
      const { data } = await db.from("marketplace_requests")
        .select("*, requester:profiles!marketplace_requests_requester_id_fkey(id,full_name,avatar_url)")
        .eq("listing_id", listingId).order("created_at",{ascending:false});
      ownerRequests = data || [];
    }

    const statusClass = l.status==='active' ? 'status-active' : (['sold','given_away','exchanged','cancelled','rejected'].includes(l.status) ? 'status-neutral' : 'status-warn');

    const ctaHtml = ()=>{
      if(isOwner){
        const canCancel = !['sold','given_away','exchanged','cancelled','rejected'].includes(l.status);
        let extra = "";
        if(l.status==='borrowed') extra = `<button class="btn dark" id="mpMarkReturnedBtn">تعليم كـ تم الإرجاع</button>`;
        if(l.status==='reserved' && l.listing_type==='exchange') extra = `<button class="btn dark" id="mpCompleteExchangeBtn">تعليم كـ تم الاستبدال</button>`;
        if(l.status==='reserved' && l.listing_type==='free') extra = `<button class="btn dark" id="mpMarkGivenBtn">تعليم كـ تم الإهداء</button>`;
        if(l.listing_type==='sale' && l.status==='active') extra = `<button class="btn dark" id="mpAgreeBtn">تم الاتفاق</button>`;
        if(l.listing_type==='sale' && l.status==='reserved') extra = `<button class="btn dark" id="mpSoldBtn">تم البيع</button><button class="btn" id="mpUnagreeBtn">إلغاء الاتفاق</button>`;
        return `<div class="twActionsRow" style="margin-top:14px">${extra}${canCancel?`<button class="btn" id="mpCancelBtn">إلغاء الإعلان</button>`:""}</div>
                <div class="twActionsRow" style="margin-top:8px"><button class="btn" id="mpDeleteBtn" style="color:#F2555F">حذف الإعلان نهائيًا</button></div>`;
      }
      if(l.status === 'sold') return `<div class="mpStateBanner rejected">هذا الإعلان تم بيعه بالفعل.</div>`;
      if(l.status === 'reserved' && l.listing_type==='sale') return `<div class="mpStateBanner pending">تم الاتفاق على هذا الإعلان — غير متاح للطلب حاليًا.</div>`;
      if(l.status !== 'active') return "";
      if(myActiveReq){
        const map = {pending:{cls:"pending",text:"طلبك بانتظار رد صاحب الإعلان."}, accepted:{cls:"accepted",text:"تم قبول طلبك."}, rejected:{cls:"rejected",text:"تم رفض الطلب."}};
        const s = map[myActiveReq.status];
        return s ? `<div class="mpStateBanner ${s.cls}">${s.text}</div>` : "";
      }
      const label = {sale:"شراء", exchange:"عرض استبدال", borrow:"طلب الإعارة", free:"طلب المنتج"}[l.listing_type];
      return `<button class="btn dark" id="mpRequestBtn" style="width:100%;margin-top:14px">${label}</button>`;
    };

    this.root.innerHTML = `<div id="mpDetailBody">
      ${files.length ? `
      <div class="mpMainImgWrap"><img id="mpMainImg" data-mpfull="${files[0].id}" alt=""></div>
      ${files.length>1 ? `<div class="mpThumbRow">${files.map((f,i)=>`<img class="mpThumb ${i===0?'active':''}" data-mpthumbsel="${f.id}" alt="">`).join("")}</div>` : ""}
      ` : `<div class="mpMainImgWrap">${Icon('shopping_bag')}</div>`}

      <div class="mpTitleRow">
        <h2>${CodeUp.escapeHtml(l.title)}</h2>
        ${l.listing_type==='sale' && l.price!=null ? `<span class="mpPriceBig">${l.price} ج.س</span>` : ""}
      </div>
      <div class="mpBadgeRow">
        <span class="mpBadge ${l.listing_type}">${this.mpTypeLabel(l.listing_type)}</span>
        <span class="mpBadge ${statusClass}">${this.mpStatusLabel(l.status, l.listing_type)}</span>
      </div>

      <div class="mpInfoList">
        <span><b>الحالة:</b> ${this.mpConditionLabel(l.condition)}</span>
        ${l.marketplace_categories?.name ? `<span><b>التصنيف:</b> ${CodeUp.escapeHtml(l.marketplace_categories.name)}</span>` : ""}
        ${l.listing_type==='exchange' ? `<span><b>مرغوب استبداله بـ:</b> ${CodeUp.escapeHtml(l.exchange_wanted_for||'')}</span>` : ""}
        ${l.listing_type==='borrow' ? `<span><b>مدة الإعارة:</b> ${l.borrow_duration_days} يوم</span>` : ""}
      </div>
      ${l.description ? `<p class="mpDesc">${CodeUp.escapeHtml(l.description)}</p>` : ""}

      ${l.listing_type==='sale' ? `<div class="mpDisclaimer">${Icon('alert_triangle')}<span>الدفع والتسليم يتمان مباشرة بينك وبين البائع — CodeUp لا تستلم أو تضمن أي مبلغ أو تسليم.</span></div>` : ""}

      <div class="mpSellerCard" id="mpOwnerRow">
        ${CodeUp.avatarHtml(l.owner?.full_name, l.owner?.avatar_url, 38)}
        <div class="mpSellerInfo">
          <div class="mpSellerName">${CodeUp.escapeHtml(l.owner?.full_name||"")}</div>
          <div class="mpSellerLabel">صاحب الإعلان</div>
        </div>
      </div>
      ${!isOwner && l.status==='active' ? `
      <div class="mpFormRow">
        <label>تواصل مع صاحب الإعلان</label>
        <div class="mpContactBtns">
          <button class="mpContactBtn whatsapp" data-mpcontact="whatsapp">${Icon('whatsapp')}WhatsApp</button>
          <button class="mpContactBtn telegram" data-mpcontact="telegram">${Icon('telegram')}Telegram</button>
        </div>
      </div>` : ""}

      ${ctaHtml()}

      ${isOwner && ownerRequests.length ? `
      <div class="mpRequestsSection">
        <p class="mpSectionLabel">الطلبات الواردة</p>
        ${ownerRequests.map(r=>`
          <div class="mpReqRow">
            ${CodeUp.avatarHtml(r.requester?.full_name, r.requester?.avatar_url, 30)}
            <div class="mpReqInfo">
              <div class="mpSellerName">${CodeUp.escapeHtml(r.requester?.full_name||"")}</div>
              <span class="mpBadge status-${r.status==='accepted'?'active':r.status==='pending'?'warn':'neutral'}">${{pending:"بانتظار الرد",accepted:"مقبول",rejected:"مرفوض",cancelled:"ملغى",completed:"مكتمل"}[r.status]}</span>
              ${r.message ? `<p class="small" style="margin:4px 0 0">${CodeUp.escapeHtml(r.message)}</p>` : ""}
              ${r.exchange_offer_description ? `<p class="small" style="margin:4px 0 0">الاستبدال: ${CodeUp.escapeHtml(r.exchange_offer_description)}</p>` : ""}
              ${r.borrow_agreed_return_date ? `<p class="small" style="margin:4px 0 0">الإرجاع: ${CodeUp.formatDate(r.borrow_agreed_return_date)}</p>` : ""}
            </div>
            ${r.status==='pending' ? `
            <div class="mpReqActions">
              <button class="btn dark" data-mpreqaccept="${r.id}">قبول</button>
              <button class="btn" data-mpreqreject="${r.id}">رفض</button>
            </div>` : ""}
          </div>`).join("")}
      </div>` : ""}
    </div>`;

    const dbody = document.getElementById("mpDetailBody");
    this.syncHeaderHeight();

    const setMainImg = async (fileId)=>{
      const f = files.find(x=>x.id===fileId);
      const mainImg = dbody.querySelector("#mpMainImg");
      if(!f || !mainImg) return;
      try{ mainImg.src = await CodeUp.getSignedUrl("submissions", f.storage_path); }catch(e){}
    };
    if(files.length) setMainImg(files[0].id);
    dbody.querySelectorAll("[data-mpthumbsel]").forEach(thumb=>{
      setMainImg(thumb.dataset.mpthumbsel).then(()=>{}); // preload signed urls for thumbs too (below)
      (async ()=>{
        const f = files.find(x=>x.id===thumb.dataset.mpthumbsel);
        if(!f) return;
        try{ thumb.src = await CodeUp.getSignedUrl("submissions", f.storage_path); }catch(e){}
      })();
      thumb.onclick = ()=>{
        dbody.querySelectorAll(".mpThumb").forEach(t=>t.classList.remove("active"));
        thumb.classList.add("active");
        setMainImg(thumb.dataset.mpthumbsel);
      };
    });
    const mainImgEl = dbody.querySelector("#mpMainImg");
    if(mainImgEl) mainImgEl.onclick = ()=>{
      const bg = document.createElement("div");
      bg.className = "mpLightboxBg";
      bg.innerHTML = `<img src="${mainImgEl.src}">`;
      bg.onclick = ()=> bg.remove();
      document.body.appendChild(bg);
    };

    const ownerRow = dbody.querySelector("#mpOwnerRow");
    if(ownerRow && !isOwner) ownerRow.onclick = ()=> this.go({name:"profile", profileId:l.owner.id});
    if(ownerRow) ownerRow.style.cursor = isOwner ? "default" : "pointer";

    const requestBtn = dbody.querySelector("#mpRequestBtn");
    if(requestBtn) requestBtn.onclick = ()=> this.openMarketplaceRequestForm(l, ()=> this.renderMarketplaceListing(listingId));

    dbody.querySelectorAll("[data-mpcontact]").forEach(btn=>{
      btn.onclick = async ()=>{
        const method = btn.dataset.mpcontact;
        // نفتح نافذة فارغة فورًا ضمن نفس نقرة المستخدم (قبل أي await) — بعض المتصفحات وWebView
        // بالأندرويد تحظر window.open() لو صار بعد عملية غير متزامنة، حتى لو كانت النتيجة من نفس الضغطة
        const win = window.open("", "_blank");
        btn.disabled = true;
        try{
          const { data: url, error } = await db.rpc("marketplace_get_contact_link", {p_listing_id: l.id, p_method: method});
          if(error) throw error;
          if(win) win.location.href = url; else location.href = url;
        }catch(e){
          if(win) win.close();
          CodeUp.toast(e.message || "تعذّر فتح وسيلة التواصل", "error");
        }finally{ btn.disabled = false; }
      };
    });

    const cancelBtn = dbody.querySelector("#mpCancelBtn");
    if(cancelBtn) cancelBtn.onclick = async ()=>{
      const ok = await this.confirmDialog({title:"إلغاء الإعلان", message:"هل أنت متأكد من إلغاء هذا الإعلان؟", confirmLabel:"إلغاء الإعلان", danger:true});
      if(!ok) return;
      cancelBtn.disabled = true;
      try{ await db.rpc("marketplace_cancel_listing", {p_listing_id: l.id}).throwOnError(); CodeUp.toast("تم إلغاء الإعلان","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message || "تعذّر الإلغاء","error"); cancelBtn.disabled=false; }
    };

    const agreeBtn = dbody.querySelector("#mpAgreeBtn");
    if(agreeBtn) agreeBtn.onclick = async ()=>{
      const ok = await this.confirmDialog({title:"تم الاتفاق؟", message:"هل تم الاتفاق فعلًا مع المشتري؟ سيتم تغيير حالة الإعلان إلى \"تم الاتفاق\". يمكنك لاحقًا تأكيد إتمام البيع أو إلغاء الاتفاق.", confirmLabel:"نعم، تم الاتفاق"});
      if(!ok) return;
      agreeBtn.disabled = true; agreeBtn.textContent = "جارٍ التحديث…";
      try{ await db.rpc("marketplace_update_listing_status", {p_listing_id: l.id, p_new_status:"reserved"}).throwOnError(); CodeUp.toast("تم تعليم الإعلان كـ تم الاتفاق","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message || "تعذّر تحديث حالة الإعلان","error"); agreeBtn.disabled=false; agreeBtn.textContent="تم الاتفاق"; }
    };

    const soldBtn = dbody.querySelector("#mpSoldBtn");
    if(soldBtn) soldBtn.onclick = async ()=>{
      const ok = await this.confirmDialog({title:"تأكيد إتمام البيع", message:"هل تمت عملية البيع بالفعل؟ سيتم تغيير حالة الإعلان إلى \"تم البيع\"، ولن يُعتبر الإعلان متاحًا للبيع بعد ذلك.", confirmLabel:"نعم، تم البيع"});
      if(!ok) return;
      soldBtn.disabled = true; soldBtn.textContent = "جارٍ التحديث…";
      try{ await db.rpc("marketplace_update_listing_status", {p_listing_id: l.id, p_new_status:"sold"}).throwOnError(); CodeUp.toast("تم تعليم الإعلان كـ تم البيع","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message || "تعذّر تحديث حالة الإعلان","error"); soldBtn.disabled=false; soldBtn.textContent="تم البيع"; }
    };

    const unagreeBtn = dbody.querySelector("#mpUnagreeBtn");
    if(unagreeBtn) unagreeBtn.onclick = async ()=>{
      const ok = await this.confirmDialog({title:"إلغاء الاتفاق؟", message:"سيعود الإعلان إلى حالة \"متاح للبيع\".", confirmLabel:"نعم، إلغاء الاتفاق"});
      if(!ok) return;
      unagreeBtn.disabled = true; unagreeBtn.textContent = "جارٍ التحديث…";
      try{ await db.rpc("marketplace_update_listing_status", {p_listing_id: l.id, p_new_status:"active"}).throwOnError(); CodeUp.toast("تم إلغاء الاتفاق","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message || "تعذّر تحديث حالة الإعلان","error"); unagreeBtn.disabled=false; unagreeBtn.textContent="إلغاء الاتفاق"; }
    };

    const deleteBtn = dbody.querySelector("#mpDeleteBtn");
    if(deleteBtn) deleteBtn.onclick = async ()=>{
      const statusNote = l.status==='reserved' ? "هذا الإعلان عليه اتفاق حالي. حذف الإعلان سيزيله من Marketplace، لكن لن يُعتبر ذلك إتمامًا للبيع."
        : l.status==='sold' ? "تم تسجيل هذا الإعلان كـ \"تم البيع\". سيتم إزالة الإعلان من Marketplace مع الاحتفاظ بسجل الصفقة حسب النظام."
        : "هل أنت متأكد من حذف هذا الإعلان؟";
      const ok = await this.confirmDialog({title:"حذف الإعلان؟", message:statusNote, confirmLabel:"حذف الإعلان", danger:true});
      if(!ok) return;
      deleteBtn.disabled = true; deleteBtn.textContent = "جارٍ الحذف…";
      try{
        const { data: paths, error } = await db.rpc("marketplace_delete_listing", {p_listing_id: l.id});
        if(error) throw error;
        if(paths && paths.length){
          try{ await db.storage.from("submissions").remove(paths); }catch(se){ /* الإعلان اتحذف من القاعدة بنجاح؛ فشل تنظيف Storage مو حرج ولا يُوقف العملية */ }
        }
        CodeUp.toast("تم حذف الإعلان", "success");
        this.go({name:"home", homeTab:"marketplace"});
      }catch(e){ CodeUp.toast(e.message || "تعذّر حذف الإعلان — لم يتم إجراء أي تغيير","error"); deleteBtn.disabled=false; deleteBtn.textContent="حذف الإعلان نهائيًا"; }
    };

    const returnedBtn = dbody.querySelector("#mpMarkReturnedBtn");
    if(returnedBtn) returnedBtn.onclick = async ()=>{
      returnedBtn.disabled = true;
      try{ await db.rpc("marketplace_mark_returned", {p_listing_id: l.id}).throwOnError(); CodeUp.toast("تم تعليم المنتج كمُرجَع","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message,"error"); returnedBtn.disabled=false; }
    };
    const exchBtn = dbody.querySelector("#mpCompleteExchangeBtn");
    if(exchBtn) exchBtn.onclick = async ()=>{
      exchBtn.disabled = true;
      try{ await db.rpc("marketplace_complete_exchange", {p_listing_id: l.id}).throwOnError(); CodeUp.toast("تم إتمام الاستبدال","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message,"error"); exchBtn.disabled=false; }
    };
    const givenBtn = dbody.querySelector("#mpMarkGivenBtn");
    if(givenBtn) givenBtn.onclick = async ()=>{
      givenBtn.disabled = true;
      try{ await db.rpc("marketplace_mark_given_away", {p_listing_id: l.id}).throwOnError(); CodeUp.toast("تم تعليم المنتج كمُهدى","success"); this.renderMarketplaceListing(listingId); }
      catch(e){ CodeUp.toast(e.message,"error"); givenBtn.disabled=false; }
    };

    dbody.querySelectorAll("[data-mpreqaccept]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        try{ await db.rpc("marketplace_decide_request", {p_request_id: btn.dataset.mpreqaccept, p_decision:"accepted"}).throwOnError(); CodeUp.toast("تم قبول الطلب","success"); this.renderMarketplaceListing(listingId); }
        catch(e){ CodeUp.toast(e.message || "تعذّر القبول","error"); btn.disabled=false; }
      };
    });
    dbody.querySelectorAll("[data-mpreqreject]").forEach(btn=>{
      btn.onclick = async ()=>{
        btn.disabled = true;
        try{ await db.rpc("marketplace_decide_request", {p_request_id: btn.dataset.mpreqreject, p_decision:"rejected"}).throwOnError(); CodeUp.toast("تم رفض الطلب","success"); this.renderMarketplaceListing(listingId); }
        catch(e){ CodeUp.toast(e.message || "تعذّر الرفض","error"); btn.disabled=false; }
      };
    });
  },

  openMarketplaceRequestForm(listing, onDone){
    const t = listing.listing_type;
    const extraHtml = t==='exchange'
      ? `<div class="mpFormRow"><label>وش تعرضه للاستبدال</label><textarea id="mpreqExchange" rows="2" placeholder="مثال: كتاب Calculus بحالة ممتازة"></textarea></div>`
      : t==='borrow'
      ? `<div class="mpFormRow"><label>تاريخ الإرجاع المتفق عليه</label><input id="mpreqReturnDate" type="date"></div>`
      : "";
    const sh = this.sheet(`
      <h3 style="margin:0 0 10px">${{sale:"طلب شراء",exchange:"عرض استبدال",borrow:"طلب إعارة",free:"طلب المنتج"}[t]}</h3>
      <div class="mpFormRow"><label>رسالة لصاحب الإعلان (اختياري)</label><textarea id="mpreqMsg" rows="2" placeholder="أي تفاصيل تحب تضيفها"></textarea></div>
      ${extraHtml}
      <div class="twActionsRow">
        <button class="btn" id="mpreqCancelBtn">إلغاء</button>
        <button class="btn dark" id="mpreqSubmitBtn">إرسال الطلب</button>
      </div>
    `);
    sh.el.querySelector("#mpreqCancelBtn").onclick = sh.close;
    sh.el.querySelector("#mpreqSubmitBtn").onclick = async ()=>{
      const submitBtn = sh.el.querySelector("#mpreqSubmitBtn");
      const message = sh.el.querySelector("#mpreqMsg").value.trim() || null;
      const exchangeOffer = t==='exchange' ? sh.el.querySelector("#mpreqExchange").value.trim() : null;
      const returnDate = t==='borrow' ? sh.el.querySelector("#mpreqReturnDate").value : null;
      if(t==='exchange' && !exchangeOffer){ CodeUp.toast("اكتب وش تعرضه للاستبدال","error"); return; }
      if(t==='borrow' && !returnDate){ CodeUp.toast("اختر تاريخ الإرجاع","error"); return; }
      await CodeUp.withBtnLoading(submitBtn, async ()=>{
        try{
          await db.rpc("marketplace_submit_request", {
            p_listing_id: listing.id, p_type: t, p_message: message,
            p_exchange_offer: exchangeOffer, p_borrow_return_date: returnDate
          }).throwOnError();
          CodeUp.toast("تم إرسال طلبك", "success");
          sh.close();
          if(onDone) onDone();
        }catch(e){ CodeUp.toast(e.message || "تعذّر إرسال الطلب", "error"); }
      });
    };
  },

  // مسارات التعلّم (patch_54): ترتيب الكورسات في مراحل. لو الجداول غير موجودة أو فارغة يرجع "" ولا يتأثر عرض الكورسات
  async trackSectionHtml(){
    try{
      const {data: tracks, error} = await db.from("tracks").select("id,name,description,track_courses(course_id,stage,stage_title,order_index,is_optional,prereq_note,courses(id,name,slug,status))").eq("is_active", true).order("created_at");
      if(error || !tracks || !tracks.length) return "";
      const pub = t=>(t.track_courses||[]).filter(tc=>tc.courses && tc.courses.status==="published");
      const courseIds = [...new Set(tracks.flatMap(t=>pub(t).map(tc=>tc.course_id)))];
      if(!courseIds.length) return "";
      const {data: unitsRows} = await db.from("units").select("course_id, lessons(id)").in("course_id", courseIds);
      const lessonIds = {}, all = [];
      (unitsRows||[]).forEach(u=>{ const ids=(u.lessons||[]).map(l=>l.id); lessonIds[u.course_id]=(lessonIds[u.course_id]||[]).concat(ids); all.push(...ids); });
      let doneSet = new Set();
      if(all.length){
        const {data: doneRows} = await db.from("lesson_progress").select("lesson_id").eq("profile_id", this.ctx.user.id).eq("status","completed").in("lesson_id", all);
        doneSet = new Set((doneRows||[]).map(r=>r.lesson_id));
      }
      const info = cid=>{ const ids=lessonIds[cid]||[]; const done=ids.filter(i=>doneSet.has(i)).length; return {total:ids.length, done, complete: ids.length>0 && done>=ids.length}; };
      const esc = CodeUp.escapeHtml;
      return tracks.map(t=>{
        const rows = pub(t);
        if(!rows.length) return "";
        const byStage = {};
        rows.forEach(tc=>{ (byStage[tc.stage] ||= []).push(tc); });
        const nums = Object.keys(byStage).map(Number).sort((a,b)=>a-b);
        nums.forEach(n=>byStage[n].sort((a,b)=>a.order_index-b.order_index));
        const req = rows.filter(tc=>!tc.is_optional);
        const base = req.length ? req : rows;
        const doneBase = base.filter(tc=>info(tc.course_id).complete).length;
        const stageDone = n=>{ const r=byStage[n].filter(tc=>!tc.is_optional); return (r.length?r:byStage[n]).every(tc=>info(tc.course_id).complete); };
        const curStage = nums.find(n=>!stageDone(n));
        const stageTitle = n=>byStage[n].find(tc=>tc.stage_title)?.stage_title || `المرحلة ${n}`;
        const pct = Math.round(doneBase/base.length*100);
        const curIdx = nums.indexOf(curStage);
        const stagesHtml = nums.map((n,i)=>{
          const state = stageDone(n) ? "done" : (n===curStage ? "cur" : "");
          return `<div class="pathStage ${state}">
            <div class="pathRail"><span class="pathDot">${state==="done"?"✓":(i+1)}</span><i></i></div>
            <div class="pathBody"><h4>${esc(stageTitle(n))}</h4>
            ${byStage[n].map(tc=>{
              const c = info(tc.course_id);
              const st = c.complete ? "completed" : (c.done>0 ? "current" : "");
              const label = c.complete ? "مكتمل" : (c.done>0 ? "قيد التعلم" : "لم يبدأ");
              const pctC = c.total ? Math.round(c.done/c.total*100) : 0;
              const note = (curStage!==undefined && n>curStage && tc.prereq_note) ? `<div class="pathWarn">${esc(tc.prereq_note)}</div>` : "";
              return `<div class="card2 pathCourse ${st==="current"?"lpHere":""}" data-pathcourse="${tc.course_id}" data-slug="${esc(tc.courses.slug||"")}" role="button" tabindex="0">
                <div class="row" style="margin:0"><b>${esc(tc.courses.name)}</b><span class="pathStat ${st}">${label}</span></div>
                <div class="small">${tc.is_optional?"اختياري · ":""}<bdi dir="ltr">${c.done} / ${c.total}</bdi> دروس</div>
                ${c.done?`<div class="progressTrack" style="margin-top:8px"><div class="progressFill" style="width:${pctC}%"></div></div>`:""}
                ${note}
              </div>`;
            }).join("")}</div>
          </div>`;
        }).join("");
        return `<div class="card2 pathHead">
            <div class="row" style="margin:0"><b>${esc(t.name)}</b><bdi dir="ltr" class="mono small">${doneBase} / ${base.length} كورسات</bdi></div>
            ${curStage!==undefined?`<div class="small" style="margin:2px 0 10px">أنت الآن في المرحلة ${curIdx+1} من ${nums.length}: ${esc(stageTitle(curStage))}</div>`:`<div class="small" style="margin:2px 0 10px">أكملت جميع مراحل المسار</div>`}
            <div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>
          </div>
          <div class="pathList">${stagesHtml}</div>`;
      }).join("");
    }catch(_e){ return ""; }
  },

  async renderHomeCourses(body){
    // Skeleton فوري قبل أي تحقق كاش/طلب — يُستبدل بالمحتوى الحقيقي بدون أي إعادة رسم إضافية
    body.innerHTML = `<div class="grid">${Array.from({length:4}, ()=>`<div class="courseCard skeleton-row" aria-hidden="true" style="pointer-events:none">
      <div class="skeleton skeleton-line w60" style="height:15px;margin-bottom:10px"></div>
      <div class="skeleton skeleton-line w80" style="height:11px"></div>
    </div>`).join("")}</div>`;
    // كاش بسيط بذاكرة الجلسة (60 ثانية) — قائمة الكورسات المنشورة تتغيّر نادرًا،
    // وتبديل التابات (الرئيسية/الكورسات) المتكرر كان يعيد جلبها من الصفر كل مرة بلا داعٍ.
    const CACHE_TTL = 60000;
    let courses;
    if(this._coursesCache && (Date.now() - this._coursesCache.at) < CACHE_TTL){
      courses = this._coursesCache.data;
    }else{
      const res = await db.from("courses").select("*").eq("status","published").order("created_at");
      if(res.error){
        body.innerHTML = `<div class="emptyState">تعذّر تحميل الكورسات. <button class="btn" id="coursesRetryBtn">إعادة المحاولة</button></div>`;
        const retryBtn = document.getElementById("coursesRetryBtn");
        if(retryBtn) retryBtn.onclick = ()=> this.renderHomeCourses(body);
        return;
      }
      courses = res.data;
      this._coursesCache = {data: courses, at: Date.now()};
    }
    const enrolledIds = new Set(this.ctx.enrollments.map(e=>e.course_id));
    const myCourses = this.ctx.enrollments;
    let html = await this.trackSectionHtml();

    if(myCourses.length){
      // تقدّم "المحتوى التعليمي" (lesson_progress) منفصل تمامًا عن enrollments.progress/xp/streak
      // (المرتبط بالواجبات) — نجيبه هنا باستعلامين شاملين فقط لكل كورسات الطالب دفعة وحدة، مو لكل كورس لحاله
      const myCourseIds = myCourses.map(e=>e.course_id);
      const { data: unitsRows } = await db.from("units").select("course_id, lessons(id)").in("course_id", myCourseIds);
      const totalByCourse = {}, lessonIdsByCourse = {}, allLessonIds = [];
      (unitsRows||[]).forEach(u=>{
        const ids = (u.lessons||[]).map(l=>l.id);
        totalByCourse[u.course_id] = (totalByCourse[u.course_id]||0) + ids.length;
        lessonIdsByCourse[u.course_id] = (lessonIdsByCourse[u.course_id]||[]).concat(ids);
        allLessonIds.push(...ids);
      });
      let completedSet = new Set();
      if(allLessonIds.length){
        const { data: doneRows } = await db.from("lesson_progress").select("lesson_id").eq("profile_id", this.ctx.user.id).eq("status","completed").in("lesson_id", allLessonIds);
        completedSet = new Set((doneRows||[]).map(r=>r.lesson_id));
      }

      html += `<div class="sectionHead"><h3 class="eyebrow">كورساتي</h3></div><div class="grid">`;
      html += myCourses.map(e=>{
        const total = totalByCourse[e.course_id]||0;
        const done = (lessonIdsByCourse[e.course_id]||[]).filter(id=>completedSet.has(id)).length;
        const pct = total ? Math.round((done/total)*100) : 0;
        const contentState = total===0 ? null : (done===0 ? "لم تبدأ الدروس بعد" : (done>=total ? "أكملت كل الدروس" : "قيد التعلم"));
        const ctaLabel = (total>0 && done>0) ? "متابعة التعلم" : "ابدأ التعلم";
        return `
        <div class="courseCard courseCardV2" data-course="${e.course_id}" data-slug="${CodeUp.escapeHtml(e.courses?.slug||"")}">
          <div class="ccHead">
            <div class="ccIcon">${Icon("learning")}</div>
            <div style="min-width:0;flex:1">
              <div class="row" style="margin:0"><h3 style="margin:0">${CodeUp.escapeHtml(e.courses?.name||"")}</h3></div>
              <p style="margin-top:2px">${CodeUp.escapeHtml(e.courses?.description||(e.squads?e.squads.name:"بلا مجموعة بعد"))}</p>
            </div>
            <span class="tag ${e.status}">${statusLabel(e.status)}</span>
          </div>
          ${total>0?`
          <div class="ccProgress">
            <div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>
            <div class="ccProgressRow">
              <span class="small"><bdi dir="ltr">${done} / ${total}</bdi> دروس</span>
              <span class="small mono">${pct}%</span>
            </div>
          </div>`:""}
          <div class="ccMeta small mono">
            ${contentState?`<span>${CodeUp.escapeHtml(contentState)}</span>`:""}
            <span>${e.xp} XP</span>
            <span>streak ${e.streak}</span>
          </div>
          <button class="btn dark ccCta" data-course="${e.course_id}" data-slug="${CodeUp.escapeHtml(e.courses?.slug||"")}">${ctaLabel}</button>
        </div>`;
      }).join("");
      html += `</div>`;
    }

    const otherCourses = (courses||[]).filter(c=>!enrolledIds.has(c.id));
    if(otherCourses.length){
      html += `<div class="sectionHead"><h3 class="eyebrow">كورسات متاحة</h3></div><div class="grid">`;
      html += otherCourses.map(c=>`
        <div class="courseCard courseCardV2" data-course="${c.id}" data-slug="${CodeUp.escapeHtml(c.slug||"")}">
          <div class="ccHead">
            <div class="ccIcon">${Icon("learning")}</div>
            <div style="min-width:0;flex:1">
              <h3>${CodeUp.escapeHtml(c.name)}</h3>
              <p>${CodeUp.escapeHtml(c.description||"")}</p>
            </div>
          </div>
          <button class="btn dark ccCta" data-course="${c.id}" data-slug="${CodeUp.escapeHtml(c.slug||"")}">ابدأ الكورس</button>
        </div>`).join("");
      html += `</div>`;
    }

    if(!myCourses.length && !otherCourses.length){
      html += `<div class="emptyState">لا توجد كورسات متاحة حاليًا.</div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-pathcourse]").forEach(el=>{
      const open = ()=> this.go({name:"course", courseId: el.dataset.pathcourse, courseSlug: el.dataset.slug, tab:"learning"});
      el.onclick = open;
      el.onkeydown = (ev)=>{ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); open(); } };
    });
    body.querySelectorAll(".courseCard").forEach(el=>{
      el.onclick = (ev)=>{
        if(ev.target.closest(".ccCta")) return; // الزر يفتح نفس الشي، نتجنب فتح مزدوج للحدث
        this.go({name:"course", courseId: el.dataset.course, courseSlug: el.dataset.slug, tab:"learning"});
      };
    });
    body.querySelectorAll(".ccCta").forEach(btn=>{
      btn.onclick = (ev)=>{
        ev.stopPropagation();
        this.go({name:"course", courseId: btn.dataset.course, courseSlug: btn.dataset.slug, tab:"learning"});
      };
    });
  },

  // قسم "الجامعة" — مستقل تمامًا عن نظام الكورسات البرمجية. تصفّح محلي
  // (جامعة → فصل → مادة → روابط) بدون تغيير الـ hash، مشابه لتصفح كورس عادي.
  async renderHomeUniversity(body){
    const showUniversities = async ()=>{
      body.innerHTML = `${loadingHtml()}`;
      const CACHE_TTL = 60000; // الجامعات تتغيّر نادرًا جدًا (إدارة فقط)
      let universities;
      if(this._universitiesCache && (Date.now() - this._universitiesCache.at) < CACHE_TTL){
        universities = this._universitiesCache.data;
      }else{
        const res = await db.from("universities").select("*").order("order_index");
        if(res.error){
          body.innerHTML = `<div class="emptyState">تعذّر تحميل الجامعات. <button class="btn" id="univsRetryBtn">إعادة المحاولة</button></div>`;
          const retryBtn = document.getElementById("univsRetryBtn");
          if(retryBtn) retryBtn.onclick = showUniversities;
          return;
        }
        universities = res.data;
        this._universitiesCache = {data: universities, at: Date.now()};
      }
      if(!universities || !universities.length){
        body.innerHTML = `<div class="emptyState">لا توجد جامعات مضافة بعد.</div>`;
        return;
      }
      // جامعة واحدة فقط حاليًا → تخطَّ قائمة الاختيار مباشرة لمحتواها (خطوة أقل بدون فائدة)
      if(universities.length === 1){
        await showSemesters(universities[0], true);
        return;
      }
      body.innerHTML = `<div class="sectionHead"><h3 class="eyebrow">University</h3></div><div class="grid">` +
        universities.map(u=>`<div class="courseCard" data-university="${u.id}"><h3>${CodeUp.escapeHtml(u.name)}</h3></div>`).join("") +
        `</div>`;
      body.querySelectorAll("[data-university]").forEach(el=>{
        el.onclick = ()=> showSemesters(universities.find(u=>u.id===el.dataset.university), universities.length===1);
      });
    };

    const showSemesters = async (university, isOnlyUniversity)=>{
      body.innerHTML = `${loadingHtml()}`;
      const CACHE_TTL = 60000; // نفس منطق كاش الكورسات — فصول الجامعة تتغيّر نادرًا (إدارة فقط)
      const cacheKey = "_universitySemestersCache_" + university.id;
      let semesters;
      if(this[cacheKey] && (Date.now() - this[cacheKey].at) < CACHE_TTL){
        semesters = this[cacheKey].data;
      }else{
        const res = await db.from("university_semesters").select("*").eq("university_id", university.id).order("order_index");
        if(res.error){
          body.innerHTML = `<div class="emptyState">تعذّر تحميل الفصول الدراسية. <button class="btn" id="semRetryBtn">إعادة المحاولة</button></div>`;
          const retryBtn = document.getElementById("semRetryBtn");
          if(retryBtn) retryBtn.onclick = ()=> showSemesters(university, isOnlyUniversity);
          return;
        }
        semesters = res.data;
        this[cacheKey] = {data: semesters, at: Date.now()};
      }
      const backRow = isOnlyUniversity ? "" : `<button class="btn" id="uniBackToUniversities" style="margin-bottom:10px"><span class="inlineBtnIcon">${Icon("arrow_right")}</span> رجوع للجامعات</button>`;
      if(!semesters || !semesters.length){
        body.innerHTML = backRow + `<div class="emptyState">لا توجد فصول دراسية مضافة بعد.</div>`;
      }else{
        body.innerHTML = backRow +
          `<div class="sectionHead"><h3 class="eyebrow">${isOnlyUniversity?"الفصول الدراسية":CodeUp.escapeHtml(university.name)}</h3></div><div class="grid">` +
          semesters.map(s=>`<div class="courseCard" data-semester="${s.id}"><h3>${CodeUp.escapeHtml(s.title)}</h3></div>`).join("") +
          `</div>`;
        body.querySelectorAll("[data-semester]").forEach(el=>{
          el.onclick = ()=> showSubjects(semesters.find(s=>s.id===el.dataset.semester), university, isOnlyUniversity);
        });
      }
      if(!isOnlyUniversity) document.getElementById("uniBackToUniversities").onclick = showUniversities;
    };

    const showSubjects = async (semester, university, isOnlyUniversity)=>{
      body.innerHTML = `${loadingHtml()}`;
      const {data: subjects} = await db.from("university_subjects").select("*").eq("semester_id", semester.id).order("order_index");
      const backRow = `<button class="btn" id="uniBackToSemesters" style="margin-bottom:10px"><span class="inlineBtnIcon">${Icon("arrow_right")}</span> رجوع للفصول</button>`;
      if(!subjects || !subjects.length){
        body.innerHTML = backRow + `<div class="emptyState">لا توجد مواد مضافة لهذا الفصل بعد.</div>`;
      }else{
        body.innerHTML = backRow +
          `<div class="sectionHead"><h3 class="eyebrow">${CodeUp.escapeHtml(semester.title)}</h3></div><div class="grid">` +
          subjects.map(s=>`<div class="courseCard" data-subject="${s.id}"><h3>${CodeUp.escapeHtml(s.title)}</h3></div>`).join("") +
          `</div>`;
        body.querySelectorAll("[data-subject]").forEach(el=>{
          el.onclick = ()=> showMaterials(subjects.find(s=>s.id===el.dataset.subject), semester, university, isOnlyUniversity);
        });
      }
      document.getElementById("uniBackToSemesters").onclick = ()=> showSemesters(university, isOnlyUniversity);
    };

    // صفحة المادة = نفس أقسام صفحة الدرس: المصدر الأساسي / بدائل / شرح مكتوب / تعمّق / للمذاكرة (PDF وAnki)
    const UNI_TYPE = {video:"youtube_video", telegram:"telegram", link:"website"};
    const showMaterials = async (subject, semester, university, isOnlyUniversity)=>{
      body.innerHTML = `${loadingHtml()}`;
      const {data: materials} = await db.from("university_materials").select("*").eq("subject_id", subject.id).order("order_index");
      const backRow = `<button class="btn" id="uniBackToSubjects" style="margin-bottom:10px"><span class="inlineBtnIcon">${Icon("arrow_right")}</span> رجوع لمواد ${CodeUp.escapeHtml(semester.title)}</button>`;
      const rank = {recommended:0, alternative:1, deep_dive:2, study:3};
      const rows = (materials||[]).slice().sort((a,b)=>((rank[a.role]??1)-(rank[b.role]??1)) || ((a.order_index||0)-(b.order_index||0)));
      const norm = m=>({id:m.id, type:UNI_TYPE[m.material_type]||m.material_type, title:m.title, url:m.url, publisher:m.publisher, language:m.language, duration_minutes:m.duration_minutes});
      const rec = rows.find(m=>m.role==="recommended");
      const study = [
        ...(subject.pdf_url ? [{legacy:true, type:"pdf", title:"ملف المادة PDF", url:subject.pdf_url, _sub:"ملخص للمراجعة"}] : []),
        ...(subject.anki_ar_url ? [{legacy:true, type:"anki", title:"بطاقات Anki", url:subject.anki_ar_url, _sub:"العربية"}] : []),
        ...(subject.anki_en_url ? [{legacy:true, type:"anki", title:"Anki Cards", url:subject.anki_en_url, _sub:"English"}] : []),
        ...rows.filter(m=>m.role==="study").map(norm)
      ];
      body.innerHTML = backRow +
        `<div class="sectionHead"><h3 class="eyebrow">${CodeUp.escapeHtml(subject.title)}</h3></div>` +
        lpSectionsHtml({
          rec: rec ? norm(rec) : null,
          alts: rows.filter(m=>m.role==="alternative" || !m.role).map(norm),
          text: subject.text_content,
          deep: rows.filter(m=>m.role==="deep_dive").map(norm),
          study,
          note: "تُفتح المصادر في نافذة جديدة.",
          emptyText: "لا توجد مصادر لهذه المادة بعد."
        });
      lpWireSections(body);
      document.getElementById("uniBackToSubjects").onclick = ()=> showSubjects(semester, university, isOnlyUniversity);
    };

    await showUniversities();
  },

  // الرئيسية المجمّعة: إعلانات عامة + منشورات حرة + تسليمات وتعليقات ولايكات من كل الكورسات المسجّل فيها الطالب
  async renderHomeFeed(body){
    const PAGE_SIZE = 15;
    const myCourseIds = this.ctx.enrollments.map(e=>e.course_id);
    body.innerHTML = `
      <div id="pullRefreshIndicator" class="pullRefreshIndicator">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-inline-end:6px"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
        <span id="pullRefreshLabel">اسحب للتحديث</span>
      </div>
      <div class="subtabs" id="feedModeTabs" style="margin-bottom:10px">
        <button data-feedmode="smart" class="active">الرئيسية</button>
        <button data-feedmode="latest">الأحدث</button>
      </div>
      <div id="newPostsBanner" class="hidden" style="text-align:center;margin-bottom:10px">
        <button class="btn dark" id="newPostsBtn" style="border-radius:20px">منشورات جديدة — اضغط للتحديث</button>
      </div>
      <div id="feedList"></div><div id="feedMore"></div>
      <button class="fabComposeBtn" id="openComposeBtn" title="منشور جديد" aria-label="منشور جديد">+</button>`;

    let pendingPostFile = null;
    let isComposeOpen = false; // يمنع فتح أكثر من Modal إنشاء منشور عند الضغط المتكرر/السريع على زر +
    let postsMode = "smart"; // "smart" = ترتيب ذكي (Recency+Engagement+Pinned+Diversity) عبر get_ranked_posts، "latest" = زمني بحت
    body.querySelectorAll("[data-feedmode]").forEach(b=>{
      b.onclick = ()=>{
        if(b.dataset.feedmode === postsMode) return;
        postsMode = b.dataset.feedmode;
        body.querySelectorAll("[data-feedmode]").forEach(x=>x.classList.toggle("active", x===b));
        loadFeed(true);
      };
    });

    const openComposeModal = ()=>{
      if(isComposeOpen) return; // ضغطة إضافية على + والنافذة مفتوحة أصلًا — تُتجاهل بدل فتح Modal ثانٍ
      isComposeOpen = true;
      const isAdmin = !!this.ctx.isPlatformAdmin;
      const typeOptions = [
        {v:"general", l:"منشور عادي"}, {v:"question", l:"سؤال"}, {v:"educational", l:"محتوى تعليمي"},
        ...(isAdmin ? [{v:"announcement", l:"إعلان"}, {v:"course_announcement", l:"إعلان دورة"}, {v:"contest_result", l:"نتيجة مسابقة"}, {v:"admin", l:"منشور من الإدارة"}] : [])
      ];
      const m = this.modal(`
        <h3 style="margin-top:0">منشور جديد</h3>
        <textarea id="newPostText" rows="4" placeholder="شارك تحديثًا أو سؤالًا مع الجميع…" style="width:100%;resize:vertical"></textarea>
        <label class="small" style="margin-top:8px;display:block">نوع المنشور</label>
        <select id="newPostType">${typeOptions.map(o=>`<option value="${o.v}">${o.l}</option>`).join("")}</select>
        <div class="commentAttachRow" style="margin-top:8px">
          <input type="file" accept="image/*" id="newPostImage" style="display:none">
          <button class="btn iconBtn" id="newPostAttachBtn" title="إرفاق صورة">${Icon("paperclip")}</button>
          <div style="flex:1"></div>
          <button class="btn dark" id="newPostBtn">نشر</button>
        </div>
        <div id="newPostPreview" style="margin-top:6px"></div>`, ()=>{ isComposeOpen = false; }); // يعيد فتح الزر بشكل طبيعي بعد أي إغلاق (نشر أو إلغاء)

      const postPreview = m.el.querySelector("#newPostPreview");
      m.el.querySelector("#newPostAttachBtn").onclick = ()=> m.el.querySelector("#newPostImage").click();
      m.el.querySelector("#newPostImage").onchange = (e)=>{
        const f = e.target.files[0]; if(!f) return;
        pendingPostFile = f;
        postPreview.innerHTML = `<span class="small">${Icon("paperclip")} ${CodeUp.escapeHtml(f.name)}</span> <button class="btn" id="clearPostAttach">إزالة</button>`;
        m.el.querySelector("#clearPostAttach").onclick = ()=>{ pendingPostFile=null; postPreview.innerHTML=""; };
      };
      m.el.querySelector("#newPostBtn").onclick = async ()=>{
        const ta = m.el.querySelector("#newPostText");
        const val = ta.value.trim();
        if(!val && !pendingPostFile) return;
        const btn = m.el.querySelector("#newPostBtn");
        btn.disabled = true;
        try{
          const postType = m.el.querySelector("#newPostType").value;
          const {data: row, error} = await db.from("posts").insert({profile_id:this.ctx.user.id, content: val || "مرفق", post_type: postType}).select().single();
          if(error) throw error;
          const uploadedHadFile = !!pendingPostFile;
          if(pendingPostFile){
            const uploaded = await CodeUp.uploadCommentAttachment(pendingPostFile, this.ctx.user.id, row.id); // نفس منطق الرفع، مسار عام تحت posts
            await db.from("file_uploads").insert({
              uploader_id: this.ctx.user.id, related_type:"post", related_id: row.id,
              storage_path: uploaded.path, file_name: uploaded.name, mime_type: uploaded.type, file_size: uploaded.size
            });
            const fileRow = await db.from("file_uploads").select("id").eq("related_type","post").eq("related_id", row.id).single();
            if(fileRow.data) CodeUp.triggerTelegramSend(fileRow.data.id);
          }
          pendingPostFile=null;
          m.close();
          if(uploadedHadFile){
            // منشور بمرفق: نعتمد حاليًا على تحديث الفيد لضمان ظهور الملف بشكل صحيح بعد اكتمال الرفع والتوقيع
            loadFeed(true);
          }else{
            // منشور نصّي بدون مرفق (الحالة الأشيع): إدراج محلي فوري بدون أي طلب/إعادة تحميل للفيد
            list.insertAdjacentHTML("afterbegin", buildOwnPostHtml(row));
            renderedIds.add(row.id);
            wireFeedInteractions(list);
          }
          CodeUp.toast("تم النشر","success");
        }catch(e){ CodeUp.toast(e.message,"error"); }
        finally{ btn.disabled = false; }
      };
    };
    document.getElementById("openComposeBtn").onclick = openComposeModal;

    const list = body.querySelector("#feedList");
    const moreBox = body.querySelector("#feedMore");
    const renderedIds = new Set(); // منع أي تكرار للعنصر نفسه بين صفحات pagination والبث الحي
    let postsCursor = null, subsCursor = null; // keyset pagination بدل range/offset — ما يتأثر بإضافة صفوف جديدة أثناء التصفح
    let postsDone = false, subsDone = false;
    let loadingFeed = false;

    // يبني نفس بطاقة المنشور المستخدمة داخل loadFeed، لكن لمنشور نصّي جديد لسّه ما وصل من الخادم بعد
    // (بدون تفاعلات/تعليقات — طبيعي لمنشور لحظة نشره) — يُستخدم للإدراج المحلي الفوري بعد النشر
    // بدل إعادة تحميل الفيد بالكامل.
    const buildOwnPostHtml = (row)=>{
      const cBlock = CodeUp.buildCommentsBlock([], row.id, {});
      return `<div class="timelinePost" data-feeditem="${row.id}" data-type="post">
        <span class="feedTag">${Icon("check")} منشور</span>
        <div class="metaWithAvatar" data-gotoprofile="${this.ctx.user.id}">${CodeUp.avatarHtml(this.ctx.profile?.full_name||"طالب", this.ctx.profile?.avatar_url)}<div class="metaTextCol"><b>${CodeUp.escapeHtml(this.ctx.profile?.full_name||"طالب")}</b><span class="mono">${CodeUp.timeAgo(row.created_at)}</span></div></div>
        <div class="body">${CodeUp.escapeHtml(row.content||"")}</div>
        <div class="reactBar">
          <button class="pillBtn" data-like="${row.id}" data-liketype="post" aria-label="إعجاب"><span class="tabIcon">${Icon("heart")}</span><span>0</span></button>
          ${cBlock.toggleHtml}
          <button class="pillBtn pillRound" data-share="${row.id}" data-sharename="${CodeUp.escapeHtml(this.ctx.profile?.full_name||"")}" data-sharetitle="منشور" aria-label="مشاركة"><span class="tabIcon">${Icon("share_pill")}</span></button>
          ${this.ctx.isPlatformAdmin?`<button class="pillBtn pillRound" data-pinpost="${row.id}" data-pinned="0" aria-label="تثبيت"><span class="tabIcon">${Icon("more_vertical")}</span></button>`:""}
        </div>
        ${cBlock.listHtml}
        ${commentComposerHtml(row.id, "post")}
      </div>`;
    };

    // ===== تفاعلات بطاقة المنشور/التسليم (إعجاب/تعليق/مشاركة/حفظ/تثبيت) =====
    // مستخرجة بدالة واحدة تُستدعى مرتين: بعد كل صفحة تحميل من loadFeed، وبعد أي إدراج محلي
    // فوري (منشور جديد) — الاعتماد على `:not([data-wired])` يضمن عدم تكرار أي مستمع حدث.
    const wireFeedInteractions = (container)=>{
      container.querySelectorAll("[data-gotoprofile]:not([data-wired])").forEach(el=>{
        el.dataset.wired = "1";
        el.style.cursor = "pointer";
        el.onclick = ()=> this.go({name:"profile", profileId: el.dataset.gotoprofile});
      });

      // ===== حفظ (Bookmark) — للتسليمات فقط، toggle بسيط محمي بـRLS =====
      container.querySelectorAll("[data-save]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const submissionId = b.dataset.save;
          const isSaved = b.classList.contains("active");
          b.disabled = true;
          try{
            if(isSaved){
              await db.from("saved_submissions").delete().eq("submission_id", submissionId).eq("profile_id", this.ctx.user.id).throwOnError();
              b.classList.remove("active");
            }else{
              await db.from("saved_submissions").insert({submission_id: submissionId, profile_id: this.ctx.user.id}).throwOnError();
              b.classList.add("active");
            }
          }catch(e){ CodeUp.toast(e.message, "error"); }
          finally{ b.disabled = false; }
        };
      });

      // ===== مشاركة — Web Share API مع بديل نسخ للحافظة =====
      container.querySelectorAll("[data-share]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const shareText = `${b.dataset.sharename} — ${b.dataset.sharetitle} — CodeUp`;
          const shareUrl = window.location.href;
          if(navigator.share){
            try{ await navigator.share({title:"CodeUp", text:shareText, url:shareUrl}); }catch(_e){ /* المستخدم ألغى المشاركة */ }
          }else{
            try{ await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`); CodeUp.toast("تم نسخ الرابط", "success"); }
            catch(_e){ CodeUp.toast("تعذّر النسخ", "error"); }
          }
        };
      });

      // ===== تثبيت/إلغاء تثبيت — سوبر أدمن فقط (الزر أصلًا لا يظهر لغيره، والدالة تتحقق بنفسها أيضًا) =====
      container.querySelectorAll("[data-pinpost]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const isPinned = b.dataset.pinned === "1";
          try{
            if(isPinned){
              await db.rpc("unpin_post", {p_post_id: b.dataset.pinpost}).throwOnError();
              CodeUp.toast("تم إلغاء التثبيت", "success");
            }else{
              const days = await this.promptDialog({title:"تثبيت المنشور", message:"عدد أيام التثبيت (اتركه فارغًا للتثبيت الدائم):", defaultValue:"3", confirmLabel:"تثبيت"});
              if(days===null) return;
              const until = days.trim() ? new Date(Date.now() + Number(days)*86400000).toISOString() : null;
              await db.rpc("pin_post", {p_post_id: b.dataset.pinpost, p_pinned_until: until}).throwOnError();
              CodeUp.toast("تم تثبيت المنشور", "success");
            }
            loadFeed(true); // إعادة الترتيب فعليًا تتأثر بالتثبيت، فالتحديث الكامل هنا مقصود وصحيح (إجراء إداري نادر، وليس تفاعل متكرر كالإعجاب/التعليق)
          }catch(e){ CodeUp.toast(e.message,"error"); }
        };
      });

      // ===== إعجاب — تحديث فوري (Optimistic UI) بدون أي إعادة تحميل للفيد؛ رجوع تلقائي للحالة السابقة عند فشل الطلب =====
      container.querySelectorAll("[data-like]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          if(b.disabled) return; // يمنع ضغط متكرر/سريع يسبب تسابق طلبات (race condition)
          const countEl = b.querySelector("span:last-child");
          const wasLiked = b.classList.contains("active");
          const prevCount = Number(countEl.textContent)||0;
          b.classList.toggle("active", !wasLiked);
          countEl.textContent = wasLiked ? Math.max(0, prevCount-1) : prevCount+1;
          b.disabled = true;
          try{
            await CodeUp.rpc.toggleReaction(b.dataset.liketype, b.dataset.like, "like");
          }catch(e){
            b.classList.toggle("active", wasLiked); // فشل الطلب — رجوع فوري للحالة قبل الضغط
            countEl.textContent = prevCount;
            CodeUp.toast(e.message,"error");
          } finally { b.disabled = false; }
        };
      });

      // ===== تعليق — إضافة محلية فورية للتعليق وتحديث العدّاد، بدون إعادة تحميل الفيد =====
      container.querySelectorAll("[data-commentsend]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        const targetId = b.dataset.commentsend;
        const commentType = b.dataset.commenttype;
        b.onclick = async ()=>{
          const input = container.querySelector(`[data-commentinput="${targetId}"]`);
          const val = input.value.trim();
          if(!val || b.disabled) return;
          b.disabled = true;
          try{
            const payload = {user_id:this.ctx.user.id, content: val};
            if(commentType === "post") payload.post_id = targetId;
            else payload.submission_id = targetId;
            await db.from("comments").insert(payload).throwOnError();
            input.value = "";
            const commentsList = container.querySelector(`[data-commentslist="${targetId}"]`);
            if(commentsList){
              const empty = commentsList.querySelector("p.small");
              if(empty) empty.remove();
              commentsList.insertAdjacentHTML("beforeend", `<div class="comment">
                <div class="commentHead"><b>${CodeUp.escapeHtml(this.ctx.profile?.full_name||"مستخدم")}</b></div>
                <div>${CodeUp.escapeHtml(val)}</div>
              </div>`);
              commentsList.classList.remove("hidden");
            }
            const toggleBtn = container.querySelector(`[data-toggleComments="${targetId}"]`);
            const countSpan = toggleBtn?.querySelector("span:last-child");
            if(countSpan) countSpan.textContent = (Number(countSpan.textContent)||0) + 1;
          }catch(e){ CodeUp.toast(e.message,"error"); }
          finally{ b.disabled = false; }
        };
      });
    };

    let newestSeenAt = null; // أحدث created_at شفناه فعليًا — نستخدمه للحاق أي منشور فاتنا بعد انقطاع الاتصال

    // ===== بث حي: تنبيه "منشورات جديدة" + تحديث/حذف محلي بدون إعادة تحميل الفيد كامل =====
    const newPostsBanner = document.getElementById("newPostsBanner");
    const newPostsBtn = document.getElementById("newPostsBtn");
    newPostsBtn.onclick = ()=>{
      newPostsBanner.classList.add("hidden");
      loadFeed(true);
    };

    const patchPostLocally = (row)=>{
      if(row.status && row.status !== "published"){ removePostLocally(row.id); return; } // حذف/إخفاء ناعم = يختفي من الفيد فورًا، بدون إعادة تحميل كامل
      const el = list.querySelector(`[data-feeditem="${row.id}"][data-type="post"] .body`);
      if(el) el.textContent = row.content || "";
    };
    const removePostLocally = (id)=>{
      const el = list.querySelector(`[data-feeditem="${id}"][data-type="post"]`);
      if(el) el.remove();
      renderedIds.delete(id);
    };

    if(this._feedRealtimeChannel){ db.removeChannel(this._feedRealtimeChannel); this._feedRealtimeChannel = null; }
    let hadSubscribedBefore = false;
    this._feedRealtimeChannel = db.channel("home-feed-posts")
      .on("postgres_changes", {event:"INSERT", schema:"public", table:"posts"}, (payload)=>{
        if(payload.new?.profile_id === this.ctx.user.id) return; // منشورك أنت نضيفه محليًا فورًا لحظة الضغط على "نشر" (buildOwnPostHtml)، فما نكرره هنا
        if(renderedIds.has(payload.new.id)) return; // منشور وصلنا فعليًا بصفحة سابقة (نادر لكن ممكن أثناء إعادة الاتصال)
        newPostsBanner.classList.remove("hidden");
      })
      .on("postgres_changes", {event:"UPDATE", schema:"public", table:"posts"}, (payload)=>{
        patchPostLocally(payload.new); // تحديث محلي فوري بدل تحميل الفيد كامل
      })
      .on("postgres_changes", {event:"DELETE", schema:"public", table:"posts"}, (payload)=>{
        removePostLocally(payload.old.id); // حذف محلي فوري بدل تحميل الفيد كامل
      })
      .subscribe((status)=>{
        // أول اشتراك ناجح: مجرد تسجيل حالة. أي اشتراك ناجح بعده (SUBSCRIBED مرة ثانية) يعني
        // كان في انقطاع اتصال وأُعيد الاتصال تلقائيًا — نتحقق حينها هل فاتنا منشور أثناء الانقطاع
        // بدل ما نفترض عدم وجود جديد بصمت.
        if(status === "SUBSCRIBED"){
          if(hadSubscribedBefore && newestSeenAt){
            db.from("posts").select("id", {count:"exact", head:true}).gt("created_at", newestSeenAt).then(({count})=>{
              if(count) newPostsBanner.classList.remove("hidden");
            });
          }
          hadSubscribedBefore = true;
        }
      });

    // ===== سحب للتحديث (Pull to refresh) — لمس بسيط بدون مكتبات خارجية =====
    const pullIndicator = document.getElementById("pullRefreshIndicator");
    const pullLabel = document.getElementById("pullRefreshLabel");
    let pullStartY = null, pulling = false;
    const PULL_THRESHOLD = 70;
    body.addEventListener("touchstart", (e)=>{
      if(window.scrollY <= 0){ pullStartY = e.touches[0].clientY; pulling = true; }
    }, {passive:true});
    body.addEventListener("touchmove", (e)=>{
      if(!pulling || pullStartY===null) return;
      const dy = e.touches[0].clientY - pullStartY;
      if(dy > 0){
        pullIndicator.style.height = Math.min(dy, PULL_THRESHOLD) + "px";
        pullLabel.textContent = dy > PULL_THRESHOLD ? "حرّر للتحديث" : "اسحب للتحديث";
      }
    }, {passive:true});
    body.addEventListener("touchend", (e)=>{
      if(!pulling) return;
      const dy = (e.changedTouches[0].clientY - pullStartY);
      pulling = false; pullStartY = null;
      if(dy > PULL_THRESHOLD){
        pullIndicator.classList.add("spinning");
        pullLabel.textContent = "جارِ التحديث…";
        loadFeed(true).finally(()=>{
          pullIndicator.classList.remove("spinning");
          pullIndicator.style.height = "0px";
        });
      }else{
        pullIndicator.style.height = "0px";
      }
    });

    const loadFeed = async (reset)=>{
      if(loadingFeed) return;
      loadingFeed = true;
      if(reset){
        postsCursor = postsMode === "smart" ? 0 : null;
        subsCursor = null; postsDone = false; subsDone = false;
        renderedIds.clear(); newestSeenAt = null;
        list.innerHTML = skeletonPostsHtml(3); // Skeleton يظهر فورًا قبل بداية أي طلب شبكة، بدل تفريغ الشاشة أو نص "جارِ التحميل…"
        moreBox.innerHTML = "";
        feedScrollObserver.observe(moreBox); // إعادة تفعيل التمرير اللانهائي لو كان قد تعطّل بعد وصوله لآخر صفحة سابقًا
      }else{
        moreBox.innerHTML = skeletonPostsHtml(1); // تحميل صفحة تالية: Skeleton صغير أسفل القائمة فقط، بدون مسّ المنشورات المعروضة أصلًا
      }

      try{
      let postsPromise;
      if(postsDone){
        postsPromise = Promise.resolve({data:[]});
      }else if(postsMode === "smart"){
        // ترتيب ذكي (حداثة+تفاعل+أهمية النوع+تثبيت+تنويع) — محسوب بالكامل داخل قاعدة البيانات (get_ranked_posts)
        postsPromise = db.rpc("get_ranked_posts", {p_cursor_rank: postsCursor||0, p_limit: PAGE_SIZE});
      }else{
        let latestQ = db.from("posts").select("*, profiles(full_name,avatar_url)").eq("status","published").order("created_at",{ascending:false}).limit(PAGE_SIZE);
        if(postsCursor) latestQ = latestQ.lt("created_at", postsCursor);
        postsPromise = latestQ;
      }
      let subsQ = (myCourseIds.length && !subsDone)
        ? db.from("submissions").select("*, assignments(title,course_id,courses(name)), profiles(full_name,avatar_url)").in("assignments.course_id", myCourseIds).in("visibility",["course","squad"]).order("created_at",{ascending:false}).limit(PAGE_SIZE)
        : null;
      if(subsQ && subsCursor) subsQ = subsQ.lt("created_at", subsCursor);

      const [{data: announcements}, postsRes, subsRes] = await Promise.all([
        reset ? db.from("announcements").select("*, profiles(full_name,avatar_url)").is("course_id", null).order("created_at",{ascending:false}).limit(10) : Promise.resolve({data:[]}),
        postsPromise,
        subsQ || Promise.resolve({data:[]})
      ]);
      const posts = postsRes.data, subs = subsRes.data;
      const safeSubs = (subs||[]).filter(s=>s.assignments); // استبعاد أي صف ما رجع بسبب inner join
      // منطقة الترتيب الذكي ترجع الاسم/الصورة كأعمدة مباشرة بدل علاقة profiles متداخلة — نطبّعها لنفس الشكل
      const safePosts = (posts || []).map(p=>
        postsMode === "smart"
          ? {...p, profiles:{full_name:p.full_name, avatar_url:p.avatar_url}, sortKey:p.effective_created_at}
          : {...p, sortKey:p.created_at}
      );

      // تحديث حالة "خلصت الصفحات" لكل مصدر لحاله (كل واحد يوقف طلبه لما يرجع أقل من PAGE_SIZE)
      if(safePosts.length < PAGE_SIZE) postsDone = true;
      if((subs||[]).length < PAGE_SIZE) subsDone = true;
      if(safePosts.length) postsCursor = postsMode === "smart" ? safePosts[safePosts.length-1].global_rank : safePosts[safePosts.length-1].created_at;
      if((subs||[]).length) subsCursor = subs[subs.length-1].created_at;

      if(reset && !safeSubs.length && !safePosts.length && !(announcements||[]).length){
        list.innerHTML = `<div class="emptyState">لا توجد منشورات بعد. كن أول من يشارك شيئًا!</div>`; moreBox.innerHTML = ""; return;
      }

      const [{data: reactions}, {data: comments}, {data: postFiles}, {data: savedRows}] = await Promise.all([
        db.from("reactions").select("*").in("target_type",["submission","post"]).in("target_id", [...safeSubs.map(s=>s.id), ...safePosts.map(p=>p.id)]),
        db.from("comments").select("*, profiles(full_name)").or(`submission_id.in.(${safeSubs.map(s=>s.id).join(",")||"00000000-0000-0000-0000-000000000000"}),post_id.in.(${safePosts.map(p=>p.id).join(",")||"00000000-0000-0000-0000-000000000000"})`).order("created_at"),
        db.from("file_uploads").select("*").eq("related_type","submission").in("related_id", safeSubs.map(s=>s.id)),
        safeSubs.length ? db.from("saved_submissions").select("submission_id").eq("profile_id", this.ctx.user.id).in("submission_id", safeSubs.map(s=>s.id)) : Promise.resolve({data:[]})
      ]);
      const savedIds = new Set((savedRows||[]).map(s=>s.submission_id));
      const filesByPost = {};
      for(const f of (postFiles||[])) (filesByPost[f.related_id] ||= []).push(f);
      const {data: commentFilesReal} = await db.from("file_uploads").select("*").eq("related_type","comment").in("related_id", (comments||[]).map(c=>c.id));
      const filesByComment = Object.fromEntries((commentFilesReal||[]).map(f=>[f.related_id, f]));

      // منع التكرار: أي عنصر سبق عرضه فعليًا (مثلاً وصل قبل كذا عبر تحديث سابق) يُستبعد هنا
      const newAnnouncements = (reset?(announcements||[]):[]);
      const newPosts = safePosts.filter(p=>!renderedIds.has(p.id));
      const newSubs = safeSubs.filter(s=>!renderedIds.has(s.id));

      const feed = [
        ...newAnnouncements.map(a=>({type:"announcement", created_at:a.created_at, data:a})),
        ...newPosts.map(p=>({type:"post", created_at:p.sortKey||p.created_at, data:p})),
        ...newSubs.map(s=>({type:"submission", created_at:s.created_at, data:s}))
      ].sort((x,y)=> new Date(y.created_at) - new Date(x.created_at));

      for(const it of feed){ if(it.type!=="announcement") renderedIds.add(it.data.id); }
      if(feed.length){
        const latest = feed.reduce((m,it)=> !m || new Date(it.created_at) > new Date(m) ? it.created_at : m, newestSeenAt);
        newestSeenAt = latest;
      }

      const reactionsFor = (type,id)=> (reactions||[]).filter(r=>r.target_type===type && r.target_id===id);
      const commentsFor = (type,id)=> (comments||[]).filter(c=> type==='post' ? c.post_id===id : c.submission_id===id);

      const html = feed.map(item=>{
        if(item.type==="announcement"){
          const a = item.data;
          return `<div class="timelinePost feedAnnouncement"><span class="feedTag">${Icon("announcement")} إعلان عام</span>
            <div class="metaWithAvatar" ${a.created_by?`data-gotoprofile="${a.created_by}"`:""}>${CodeUp.avatarHtml(a.profiles?.full_name||"إدارة CodeUp", a.profiles?.avatar_url)}<div class="metaTextCol"><b>${CodeUp.escapeHtml(a.profiles?.full_name||"إدارة CodeUp")}</b><span class="mono">${CodeUp.timeAgo(a.created_at)}</span></div></div>
            <div class="body"><b>${CodeUp.escapeHtml(a.title)}</b>${a.content?`<br>${CodeUp.escapeHtml(a.content)}`:""}</div></div>`;
        }
        const isPost = item.type==="post";
        const d = item.data;
        const POST_TYPE_LABEL = {question:"سؤال", educational:"محتوى تعليمي", announcement:"إعلان", course_announcement:"إعلان دورة", contest_result:"نتيجة مسابقة", admin:"من الإدارة"};
        const typeLabel = isPost && POST_TYPE_LABEL[d.post_type];
        const myLiked = reactionsFor(item.type, d.id).some(r=>r.user_id===this.ctx.user.id);
        const likeCount = reactionsFor(item.type, d.id).length;
        const itemComments = commentsFor(item.type, d.id);
        const cBlock = CodeUp.buildCommentsBlock(itemComments, d.id, {filesByComment});
        return `<div class="timelinePost" data-feeditem="${d.id}" data-type="${item.type}">
          <span class="feedTag">${Icon("check")} ${isPost?"منشور":"تسليم واجب"}${!isPost && d.assignments?.courses?.name ? " · " + CodeUp.escapeHtml(d.assignments.courses.name) : ""}${typeLabel?" · "+typeLabel:""}${isPost && d.is_pinned?` · ${Icon("bookmark")} مثبَّت`:""}</span>
          <div class="metaWithAvatar" data-gotoprofile="${d.profile_id}">${CodeUp.avatarHtml(d.profiles?.full_name||"طالب", d.profiles?.avatar_url)}<div class="metaTextCol"><b>${CodeUp.escapeHtml(d.profiles?.full_name||"طالب")}</b><span class="mono">${CodeUp.timeAgo(d.created_at)}</span></div></div>
          ${!isPost?`<div class="small mono" style="margin-bottom:6px">${CodeUp.escapeHtml(d.assignments?.title||"")}</div>`:""}
          <div class="body">${CodeUp.escapeHtml(d.content||"")}</div>
          ${!isPost?(filesByPost[d.id]||[]).map(f=>renderFileCard(f,"submissions")).join(""):""}
          <div class="reactBar">
            <button class="pillBtn ${myLiked?'active':''}" data-like="${d.id}" data-liketype="${item.type}" aria-label="إعجاب"><span class="tabIcon">${Icon("heart")}</span><span>${likeCount||0}</span></button>
            ${cBlock.toggleHtml}
            <button class="pillBtn pillRound" data-share="${d.id}" data-sharename="${CodeUp.escapeHtml(d.profiles?.full_name||'')}" data-sharetitle="${CodeUp.escapeHtml(isPost?'منشور':(d.assignments?.title||''))}" aria-label="مشاركة"><span class="tabIcon">${Icon("share_pill")}</span></button>
            ${!isPost?`<button class="pillBtn pillRound ${savedIds.has(d.id)?'active':''}" data-save="${d.id}" aria-label="حفظ"><span class="tabIcon">${Icon("bookmark")}</span></button>`:""}
            ${isPost && this.ctx.isPlatformAdmin?`<button class="pillBtn pillRound ${d.is_pinned?'active':''}" data-pinpost="${d.id}" data-pinned="${d.is_pinned?'1':'0'}" aria-label="${d.is_pinned?'إلغاء التثبيت':'تثبيت'}"><span class="tabIcon">${Icon("more_vertical")}</span></button>`:""}
          </div>
          ${cBlock.listHtml}
          ${commentComposerHtml(d.id, isPost?"post":"submission")}
        </div>`;
      }).join("");
      if(reset) list.innerHTML = ""; // يستبدل الـSkeleton بالمحتوى الحقيقي دفعة واحدة (بدون وميض/flash ملحوظ)
      list.insertAdjacentHTML("beforeend", html);
      wireFileCardPreviews(list);
      CodeUp.wireCommentsToggle(list);

      wireFeedInteractions(list);

      if(postsDone && subsDone){
        moreBox.innerHTML = list.children.length ? `<div class="emptyState small">وصلت لآخر المنشورات</div>` : "";
        feedScrollObserver.disconnect();
      }else{
        moreBox.innerHTML = "";
      }
      }catch(e){
        // فشل الطلب: نزيل الـSkeleton فورًا ونعرض حالة الخطأ الموجودة أصلًا بالتطبيق (toast) —
        // بدون ترك Skeleton عالقًا، وبدون تغيير أي استعلام Supabase. عند "تحميل المزيد" (reset=false)
        // لا نلمس المنشورات المعروضة أصلًا أبدًا — فقط نفرّغ Skeleton الصغير أسفل القائمة.
        if(reset) list.innerHTML = `<div class="emptyState">تعذّر تحميل المنشورات. اسحب للأسفل للمحاولة مرة أخرى.</div>`;
        moreBox.innerHTML = "";
        CodeUp.toast(e.message || "تعذّر تحميل المنشورات", "error");
      }finally{
        loadingFeed = false; // مسار مضمون دائمًا (نجاح/فشل/فارغ) — لا تبقى حالة التحميل عالقة أبدًا
      }
    };

    // ===== تمرير لا نهائي (Infinite Scroll) — Sentinel ثابت بدل زر "تحميل المزيد" =====
    const feedScrollObserver = new IntersectionObserver((entries)=>{
      if(entries[0].isIntersecting && !loadingFeed && !(postsDone && subsDone)) loadFeed(false);
    }, {rootMargin:"300px"});
    feedScrollObserver.observe(moreBox);

    loadFeed(true);
  },

  async renderCourse(courseId, tab){
    this.root.innerHTML = `<div class="courseHeader skeleton-row" aria-hidden="true">
      <div class="courseHeaderTop"><div class="skeleton skeleton-avatar" style="width:44px;height:44px;border-radius:10px"></div>
        <div style="flex:1"><div class="skeleton skeleton-line w40" style="height:16px;margin-bottom:8px"></div><div class="skeleton skeleton-line w80"></div></div>
      </div>
    </div>`;
    const {data: course, error: courseErr} = await db.from("courses").select("*").eq("id", courseId).single();
    if(courseErr || !course){
      this.root.innerHTML = `<div class="emptyState">تعذّر تحميل الكورس. <button class="btn" id="courseRetryBtn">إعادة المحاولة</button></div>`;
      const retryBtn = document.getElementById("courseRetryBtn");
      if(retryBtn) retryBtn.onclick = ()=> this.renderCourse(courseId, tab);
      return;
    }

    let myEnrollment = this.ctx.enrollments.find(e=>e.course_id===courseId);

    this.crumbTrail([{label: course.name, onClick: ()=>this.go({name:"course",courseId,tab:"learning"})}], {title: course.name, back: ()=>this.go({name:"home", homeTab:"courses"})});

    const isAdmin = this.ctx.courseAdminCourseIds.includes(courseId);
    const isLeader = this.ctx.leaderCourseIds.includes(courseId);

    // تقدّم المحتوى التعليمي (lesson_progress) — يُحسب مرة وحدة هنا ويُستخدم بالهيدر
    // وبتبويب "التعلم"، بدل ما يتكرر الاستعلام بكل تبويب
    const { data: unitsForHeader, error: unitsErr } = await db.from("units").select("id, lessons(id)").eq("course_id", courseId);
    const allLessonIdsForHeader = unitsErr ? [] : (unitsForHeader||[]).flatMap(u=>(u.lessons||[]).map(l=>l.id));
    let headerDoneCount = 0;
    if(allLessonIdsForHeader.length){
      const { data: doneRows } = await db.from("lesson_progress").select("lesson_id").eq("profile_id", this.ctx.user.id).eq("status","completed").in("lesson_id", allLessonIdsForHeader);
      headerDoneCount = (doneRows||[]).length;
    }
    const headerTotal = allLessonIdsForHeader.length;
    const headerPct = headerTotal ? Math.round((headerDoneCount/headerTotal)*100) : 0;
    const headerCta = (headerTotal>0 && headerDoneCount>0) ? "متابعة التعلم" : "ابدأ التعلم";

    const tabIcons = {learning:"learning",assignments:"assignments",timeline:"timeline",squads:"squads",progress:"progress",leaderboard:"leaderboard"};
    const tabs = [
      ["learning","التعلم"],["assignments","الواجبات"],["timeline","المستجدات"],
      ["squads","المجموعات"],["progress","تقدمي"],["leaderboard","المتصدرون"]
    ];
    let html = `
      <div class="courseHeader">
        <div class="courseHeaderTop">
          <div class="ccIcon courseHeaderIcon">${Icon("learning")}</div>
          <div style="min-width:0;flex:1">
            <h2 class="courseHeaderTitle">${CodeUp.escapeHtml(course.name)}</h2>
            ${course.description?`<p class="courseHeaderDesc">${CodeUp.escapeHtml(course.description)}</p>`:""}
          </div>
        </div>
        ${headerTotal>0?`
        <div class="courseHeaderProgress">
          <div class="progressTrack"><div class="progressFill" style="width:${headerPct}%"></div></div>
          <div class="ccProgressRow">
            <span class="small"><bdi dir="ltr">${headerDoneCount} / ${headerTotal}</bdi> دروس</span>
            <span class="small mono">${headerPct}%</span>
          </div>
        </div>
        <button class="btn dark courseHeaderCta" id="courseHeaderCtaBtn">${headerCta}</button>
        `:``}
      </div>
      <div class="fbTabBar">
        ${tabs.map(([key,label])=>`<button data-tab="${key}" class="${key===tab?'active':''}"><span class="tabIcon">${Icon(tabIcons[key])}</span>${label}</button>`).join("")}
      </div>
      ${!myEnrollment ? `
      <div class="joinBanner">
        <p>أنت تتصفح هذا الكورس فقط. انضم للمشاركة بالواجبات والمستجدات وتتبع تقدمك.</p>
        <button class="btn dark" id="joinCourseBtn" style="flex-shrink:0">انضمام للكورس</button>
      </div>` : ``}
      <div id="tabBody"></div>`;
    this.root.innerHTML = html;
    const headerCtaBtn = document.getElementById("courseHeaderCtaBtn");
    if(headerCtaBtn) headerCtaBtn.onclick = ()=>{ if(tab!=="learning") this.go({name:"course",courseId,courseSlug:course.slug,tab:"learning"}); else document.getElementById("tabBody")?.scrollIntoView({behavior:"smooth"}); };
    this.root.querySelectorAll(".fbTabBar [data-tab]").forEach(b=>{
      b.onclick = ()=>{ if(b.dataset.tab!==tab) this.go({name:"course",courseId,courseSlug:course.slug,tab:b.dataset.tab}); };
    });
    const joinBtn = document.getElementById("joinCourseBtn");
    if(joinBtn) joinBtn.onclick = async ()=>{
      joinBtn.disabled = true;
      try{
        await CodeUp.rpc.enrollInCourse(courseId);
        this.ctx = await CodeUp.loadMyContext();
        CodeUp.toast("تم الانضمام للكورس", "success");
        this.go({name:"course",courseId,courseSlug:course.slug,tab});
      }catch(e){ CodeUp.toast(e.message||"تعذّر الانضمام", "error"); joinBtn.disabled = false; }
    };

    const body = document.getElementById("tabBody");
    body.innerHTML = `${loadingHtml()}`;

    if(tab==="learning") return this.renderLearning(body, course);
    if(tab==="assignments") return this.renderAssignments(body, course, myEnrollment);
    if(tab==="timeline") return this.renderTimeline(body, course, myEnrollment);
    if(tab==="squads") return this.renderSquads(body, course, myEnrollment, isAdmin, isLeader);
    if(tab==="progress") return this.renderProgress(body, course, myEnrollment);
    if(tab==="leaderboard") return this.renderLeaderboard(body, course);
  },

  async renderLessonPage(courseId, courseSlug, lessonId){
    this.root.innerHTML = `<div class="lessonPageBody">
      <div class="lessonMain skeleton-row" aria-hidden="true">
        <div class="skeleton skeleton-line w40" style="height:14px;margin-bottom:10px"></div>
        <div class="skeleton skeleton-line w80" style="height:20px;margin-bottom:14px"></div>
        <div class="skeleton skeleton-media" style="height:220px"></div>
      </div>
    </div>`;
    const [{data: course, error: courseErr}, {data: units, error: unitsErr}, {data: linkedAssignments}] = await Promise.all([
      db.from("courses").select("*").eq("id", courseId).single(),
      db.from("units").select("*, lessons(*)").eq("course_id", courseId).order("order_index"),
      db.from("assignments").select("*").eq("lesson_id", lessonId)
    ]);
    if(courseErr || unitsErr || !course || !units){
      this.root.innerHTML = `<div class="emptyState">تعذّر تحميل الدرس. <button class="btn" id="lessonRetryBtn">إعادة المحاولة</button></div>`;
      const retryBtn = document.getElementById("lessonRetryBtn");
      if(retryBtn) retryBtn.onclick = ()=> this.renderLessonPage(courseId, courseSlug, lessonId);
      return;
    }

    const sortedUnits = units.map(u=>({...u, lessons:(u.lessons||[]).sort((a,b)=>a.order_index-b.order_index)}));
    const flatLessons = sortedUnits.flatMap(u=>u.lessons.map(l=>({...l, unitTitle:u.title, unitId:u.id})));
    const lesson = flatLessons.find(l=>l.id===lessonId);
    if(!lesson){ this.root.innerHTML = `<div class="emptyState">الدرس غير موجود أو تم حذفه.</div>`; return; }

    const allLessonIds = flatLessons.map(l=>l.id);
    const {data: myProgress} = await db.from("lesson_progress").select("lesson_id,status").eq("profile_id", this.ctx.user.id).in("lesson_id", allLessonIds);
    const doneSet = new Set((myProgress||[]).filter(p=>p.status==="completed").map(p=>p.lesson_id));
    const {currentLessonId} = computeCurrentLesson(sortedUnits, doneSet);

    const idx = flatLessons.findIndex(l=>l.id===lessonId);
    const prevLesson = idx>0 ? flatLessons[idx-1] : null;
    const nextLesson = idx<flatLessons.length-1 ? flatLessons[idx+1] : null;
    const isLast = idx === flatLessons.length-1;
    const doneCount = flatLessons.filter(l=>doneSet.has(l.id)).length;
    const donePct = flatLessons.length ? Math.round((doneCount/flatLessons.length)*100) : 0;
    const numberInUnit = sortedUnits.find(u=>u.id===lesson.unitId).lessons.findIndex(l=>l.id===lessonId)+1;

    // مصادر التعلّم من الجداول الجديدة — لو فشل الطلب (الجدول غير موجود بعد) نكمل بالحقول القديمة فقط
    let dbRes = [];
    try{
      const rr = await db.from("lesson_resources").select("id, role, order_index, resources(id,type,title,url,publisher,language,start_at,duration_minutes,is_active)").eq("lesson_id", lessonId).order("order_index");
      if(!rr.error && rr.data) dbRes = rr.data.filter(x=>x.resources && x.resources.is_active!==false);
    }catch(_e){}
    const roleRank = {recommended:0, alternative:1, deep_dive:2, study:3};
    dbRes.sort((a,b)=>(roleRank[a.role]-roleRank[b.role]) || (a.order_index-b.order_index));
    const legacyVideo = lesson.video_url ? {legacy:true, type:"youtube_video", title:"فيديو الدرس", url:lesson.video_url} : null;
    const recDb = dbRes.find(x=>x.role==="recommended");
    const recItem = recDb ? recDb.resources : legacyVideo;
    const altItems = [
      ...(recDb && legacyVideo ? [legacyVideo] : []),
      ...dbRes.filter(x=>x.role==="alternative").map(x=>x.resources)
    ];
    const deepItems = dbRes.filter(x=>x.role==="deep_dive").map(x=>x.resources);
    const studyItems = [
      ...(lesson.pdf_url ? [{legacy:true, type:"pdf", title:"ملف الدرس PDF", url:lesson.pdf_url, _sub:"ملخص للمراجعة"}] : []),
      ...(lesson.anki_ar_url ? [{legacy:true, type:"anki", title:"بطاقات Anki", url:lesson.anki_ar_url, _sub:"العربية"}] : []),
      ...(lesson.anki_en_url ? [{legacy:true, type:"anki", title:"Anki Cards", url:lesson.anki_en_url, _sub:"English"}] : []),
      ...dbRes.filter(x=>x.role==="study").map(x=>x.resources)
    ];
    const unitLessons = sortedUnits.find(u=>u.id===lesson.unitId).lessons;
    const posHtml = unitLessons.map(l=>`<i class="${doneSet.has(l.id)?'d':(l.id===lessonId?'c':'')}"></i>`).join("");

    this.crumbTrail([
      {label: course.name, onClick: ()=>this.go({name:"course",courseId,courseSlug,tab:"learning"})},
      {label: lesson.title, onClick: ()=>{}}
    ]);

    const goLesson = (id)=> this.go({name:"lesson", courseId, courseSlug, lessonId: id});

    const sidebarHtml = `
      <div class="lessonSidebarHead"><b>محتوى الكورس</b></div>
      ${sortedUnits.map(u=>{
        const uDone = u.lessons.filter(l=>doneSet.has(l.id)).length;
        return `
        <div class="lsUnit">
          <div class="lsUnitTitle small">${CodeUp.escapeHtml(u.title)} <bdi dir="ltr" class="mono">— ${uDone}/${u.lessons.length}</bdi></div>
          ${u.lessons.map((l,i)=>{
            const st = doneSet.has(l.id) ? "completed" : (l.id===currentLessonId ? "current" : "available");
            return `<button class="lsLesson ${l.id===lessonId?'active':''}" data-golesson="${l.id}">
              <span class="lsLessonIcon lsLessonIcon-${st}">${st==="completed"?Icon("check"):String(i+1).padStart(2,"0")}</span>
              <span class="lsLessonTitle">${CodeUp.escapeHtml(l.title)}</span>
            </button>`;
          }).join("")}
        </div>`;
      }).join("")}
    `;

    const ct = lessonContentType(lesson);
    const isDone = doneSet.has(lesson.id);

    this.setAppBar({title:`الدرس ${String(numberInUnit).padStart(2,"0")} — ${lesson.title}`, back: ()=>this.go({name:"course", courseId, courseSlug, tab:"learning"})});

    this.root.innerHTML = `
      <div class="lessonPageBody">
        <div class="lessonMain">
          <div class="small">${CodeUp.escapeHtml(course.name)} · الوحدة ${sortedUnits.findIndex(u=>u.id===lesson.unitId)+1} — ${CodeUp.escapeHtml(lesson.unitTitle)}</div>
          <h2 class="lessonPageTitle">${CodeUp.escapeHtml(lesson.title)}</h2>
          <div class="lessonTypeTag" style="margin-bottom:14px">${Icon(ct.icon)} ${ct.label}</div>

          <div class="lpPos" aria-hidden="true">${posHtml}</div>

          ${lpSectionsHtml({rec:recItem, alts:altItems, text:lesson.text_content, deep:deepItems, study:studyItems, note:"تُفتح المصادر في نافذة جديدة، وإكمال الدرس يتم من الزر أسفل الصفحة.", emptyText:"لا توجد مصادر لهذا الدرس بعد."})}

          ${(linkedAssignments||[]).length ? `
          <div class="lpSecHead"><b>التطبيق العملي</b></div>
          <div class="card2 lpList">
            ${linkedAssignments.map(a=>`<div class="lpPractice">
              <span class="lpT"><b>${CodeUp.escapeHtml(a.title)}</b><span class="small">يفتح الواجب نفسه مباشرة</span></span>
              <button class="btn dark" data-openassignment="${a.id}">فتح التمرين</button>
            </div>`).join("")}
          </div>` : ""}

          ${dbRes.length ? `<button class="lpReportBtn" id="lpReportBtn" type="button">الإبلاغ عن رابط لا يعمل</button>` : ""}

          <div class="card2">
            <div class="row"><b>تقدمك في هذا الكورس</b><bdi dir="ltr" class="mono small">${doneCount} / ${flatLessons.length} — ${donePct}%</bdi></div>
            <div class="progressTrack" style="margin-top:8px"><div class="progressFill" style="width:${donePct}%"></div></div>
          </div>

          <button class="btn ${isDone?'':'dark'} lessonCompleteBtn" id="completeLessonBtn">
            ${isDone?`<span class="inlineBtnIcon">${Icon("check")}</span> تم إكمال الدرس`:"إكمال الدرس"}
          </button>

          <div class="lessonNavRow">
            ${prevLesson?`<button class="btn lessonNavBtn" data-golesson="${prevLesson.id}"><span class="inlineBtnIcon">${Icon("arrow_right")}</span><span class="lpNavTxt">الدرس السابق<small>${CodeUp.escapeHtml(prevLesson.title)}</small></span></button>`:`<span></span>`}
            ${isLast
              ? `<span class="small" style="align-self:center">${doneCount>=flatLessons.length?"أكملت جميع دروس الكورس":"هذا آخر درس بالكورس"}</span>`
              : `<button class="btn dark lessonNavBtn" data-golesson="${nextLesson.id}"><span class="lpNavTxt">الدرس التالي<small>${CodeUp.escapeHtml(nextLesson.title)}</small></span><span class="inlineBtnIcon">${Icon("arrow_left")}</span></button>`}
          </div>
        </div>

        <aside class="lessonSidebar">${sidebarHtml}</aside>
      </div>

      <button class="mobileContentToggle" id="mobileContentToggle">${Icon("learning")} محتوى الكورس</button>
      <div class="lessonDrawerBg" id="lessonDrawerBg"></div>
      <div class="lessonDrawer" id="lessonDrawer">${sidebarHtml}</div>
    `;

    lpWireSections(this.root);
    const reportBtn = document.getElementById("lpReportBtn");
    if(reportBtn){
      reportBtn.onclick = ()=>{
        const esc = CodeUp.escapeHtml;
        const sh = this.sheet(`<h3>الإبلاغ عن رابط لا يعمل</h3><p class="small" style="margin-top:0">اختر المصدر الذي لا يفتح:</p>${dbRes.map(x=>`<button class="btn lpReportItem" data-rid="${esc(x.resources.id)}">${esc(x.resources.title)}</button>`).join("")}`);
        sh.el.querySelectorAll("[data-rid]").forEach(b=>{
          b.onclick = async ()=>{
            b.disabled = true;
            try{
              await db.from("resource_reports").insert({resource_id: b.dataset.rid, profile_id: this.ctx.user.id}).throwOnError();
              CodeUp.toast("شكرًا، تم إرسال البلاغ", "success"); sh.close();
            }catch(e){
              CodeUp.toast(/duplicate|unique/i.test(e.message||"") ? "سبق أن أبلغت عن هذا الرابط" : "تعذّر إرسال البلاغ", /duplicate|unique/i.test(e.message||"") ? "info" : "error");
              if(/duplicate|unique/i.test(e.message||"")) sh.close(); else b.disabled = false;
            }
          };
        });
      };
    }
    this.root.querySelectorAll("[data-golesson]").forEach(btn=>{
      btn.onclick = ()=> goLesson(btn.dataset.golesson);
    });
    this.root.querySelectorAll("[data-openassignment]").forEach(btn=>{
      btn.onclick = ()=> this.go({name:"course",courseId,courseSlug,tab:"assignments",assignmentId:btn.dataset.openassignment});
    });

    document.getElementById("completeLessonBtn").onclick = async (e)=>{
      const btn = e.currentTarget;
      btn.disabled = true;
      const nowDone = !isDone;
      try{
        await db.from("lesson_progress").upsert({
          lesson_id: lesson.id, profile_id: this.ctx.user.id,
          status: nowDone ? "completed" : "not_started",
          completed_at: nowDone ? new Date().toISOString() : null
        }, {onConflict: "lesson_id,profile_id"}).throwOnError();
        this.renderLessonPage(courseId, courseSlug, lessonId); // إعادة رسم لتحديث التقدم والدرس الحالي وحالة القائمة الجانبية
      }catch(err){ CodeUp.toast(err.message,"error"); btn.disabled = false; }
    };

    // Drawer المحتوى بالهاتف فقط (لا Sidebar ثابت يضغط المحتوى)
    const drawerBg = document.getElementById("lessonDrawerBg");
    const drawer = document.getElementById("lessonDrawer");
    const openDrawer = ()=>{ drawerBg.classList.add("show"); drawer.classList.add("open"); };
    const closeDrawer = ()=>{ drawerBg.classList.remove("show"); drawer.classList.remove("open"); };
    document.getElementById("mobileContentToggle").onclick = openDrawer;
    drawerBg.onclick = closeDrawer;
  },

  async renderLearning(body, course){
    body.innerHTML = `<div class="card2">${Array(2).fill(`<div class="skeleton skeleton-line w60" style="height:16px;margin:10px 0"></div>`).join("")}</div>`;
    const {data: units, error} = await db.from("units").select("*, lessons(*)").eq("course_id", course.id).order("order_index");
    if(error){
      body.innerHTML = `<div class="emptyState">تعذّر تحميل محتوى الكورس. <button class="btn" id="learningRetryBtn">إعادة المحاولة</button></div>`;
      const retryBtn = document.getElementById("learningRetryBtn");
      if(retryBtn) retryBtn.onclick = ()=> this.renderLearning(body, course);
      return;
    }
    if(!units || !units.length){
      body.innerHTML = `<div class="emptyStatePro"><h4>لا يوجد محتوى تعليمي منشور بعد</h4><p>راجعنا هالمكان بعدين — الدروس بتتوفر قريبًا.</p></div>`;
      return;
    }

    const sortedUnits = units.map(u=>({...u, lessons:(u.lessons||[]).sort((a,b)=>a.order_index-b.order_index)}));
    const allLessonIds = sortedUnits.flatMap(u=>u.lessons.map(l=>l.id));
    const {data: myProgress} = allLessonIds.length
      ? await db.from("lesson_progress").select("lesson_id,status").eq("profile_id", this.ctx.user.id).in("lesson_id", allLessonIds)
      : {data:[]};
    const doneSet = new Set((myProgress||[]).filter(p=>p.status==="completed").map(p=>p.lesson_id));

    // تحديد "الدرس الحالي": أول درس غير مكتمل بترتيب الوحدات ثم الدروس — لا يوجد نظام Unlock،
    // فكل الدروس AVAILABLE بخلاف المكتمل والحالي؛ ما نضيف حالة LOCKED من عندنا
    const {currentLessonId, currentUnitId} = computeCurrentLesson(sortedUnits, doneSet);

    const contentTypeOf = lessonContentType;

    const hereLesson = currentLessonId ? sortedUnits.flatMap(u=>u.lessons.map(l=>({...l, unitTitle:u.title}))).find(l=>l.id===currentLessonId) : null;
    const hereHtml = !allLessonIds.length ? "" : (hereLesson ? `<div class="card2 lpHere">
      <div class="small">أنت هنا</div>
      <b class="lpHereTitle">${CodeUp.escapeHtml(hereLesson.title)}</b>
      <div class="small" style="margin-bottom:10px">${CodeUp.escapeHtml(hereLesson.unitTitle)}</div>
      <button class="btn dark" data-lessonid="${hereLesson.id}" data-courseslug="${CodeUp.escapeHtml(course.slug)}">متابعة التعلّم</button>
    </div>` : `<div class="card2 lpHere"><b>أكملت جميع دروس الكورس</b></div>`);

    body.innerHTML = hereHtml + sortedUnits.map(u=>{
      const total = u.lessons.length;
      const done = u.lessons.filter(l=>doneSet.has(l.id)).length;
      const pct = total ? Math.round((done/total)*100) : 0;
      const isOpen = u.id === currentUnitId;
      return `
      <div class="unitAccordion ${isOpen?'open':''}" data-unit="${u.id}">
        <button class="unitAccordionHead" data-toggleunit="${u.id}">
          <div style="min-width:0;flex:1">
            <b class="unitTitle">${CodeUp.escapeHtml(u.title)}</b>
            <div class="ccProgressRow"><span class="small"><bdi dir="ltr">${done} / ${total}</bdi> دروس</span><span class="small mono">${pct}%</span></div>
            <div class="progressTrack" style="margin-top:4px"><div class="progressFill" style="width:${pct}%"></div></div>
          </div>
          <span class="unitChevron">${Icon("chevron_down")}</span>
        </button>
        <div class="unitAccordionBody">
          ${u.lessons.map((l,i)=>{
            const status = doneSet.has(l.id) ? "completed" : (l.id===currentLessonId ? "current" : "available");
            const statusLabelAr = {completed:"مكتمل", current:"الدرس الحالي", available:"متاح"}[status];
            const ct = contentTypeOf(l);
            return `
            <button class="lessonRow status-${status}" data-lessonid="${l.id}" data-courseslug="${CodeUp.escapeHtml(course.slug)}">
              <span class="lessonNum mono">${String(i+1).padStart(2,"0")}</span>
              <div style="min-width:0;flex:1">
                <span class="lessonTitle">${CodeUp.escapeHtml(l.title)}</span>
                <div class="lessonMeta small">
                  <span class="lessonTypeTag">${Icon(ct.icon)} ${ct.label}</span>
                  <span class="lessonStatusTag lessonStatusTag-${status}">${statusLabelAr}</span>
                </div>
              </div>
              <span class="lessonRowArrow">${Icon("arrow_left")}</span>
            </button>`;
          }).join("") || `<p class="small" style="padding:10px">لا توجد دروس بعد.</p>`}
        </div>
      </div>`;
    }).join("");

    body.querySelectorAll("[data-toggleunit]").forEach(btn=>{
      btn.onclick = ()=> btn.closest(".unitAccordion").classList.toggle("open");
    });

    body.querySelectorAll("[data-lessonid]").forEach(row=>{
      row.onclick = ()=> this.go({name:"lesson", courseId: course.id, courseSlug: row.dataset.courseslug, lessonId: row.dataset.lessonid});
    });
  },

  async renderAssignments(body, course, myEnrollment){
    const {data: assignments} = await db.from("assignments").select("*").eq("course_id", course.id).order("deadline");
    if(!assignments || !assignments.length){ body.innerHTML = `<div class="emptyState">لا توجد واجبات بعد.</div>`; return; }

    const {data: mySubs} = await db.from("submissions").select("*").eq("profile_id", this.ctx.user.id).in("assignment_id", assignments.map(a=>a.id));
    const subByAssignment = Object.fromEntries((mySubs||[]).map(s=>[s.assignment_id, s]));
    const {data: attachments} = await db.from("file_uploads").select("*").eq("related_type","assignment").in("related_id", assignments.map(a=>a.id));
    const attachByAssignment = {};
    for(const f of (attachments||[])) (attachByAssignment[f.related_id] ||= []).push(f);

    body.innerHTML = assignments.map(a=>{
      const sub = subByAssignment[a.id];
      const status = sub ? sub.status : "missing";
      return `
      <div class="card2" data-assignment-card="${a.id}">
        <div class="row"><b>${CodeUp.escapeHtml(a.title)}</b><span class="tag ${status}">${statusLabel(status)}</span></div>
        <p class="small">${CodeUp.escapeHtml(a.description||"")}</p>
        <p class="small mono">deadline: ${CodeUp.formatDate(a.deadline)}</p>
        ${(attachByAssignment[a.id]||[]).map(f=>renderFileCard(f,"course-assets")).join("")}
        <div class="row" style="margin-top:8px">
          <span class="small">${sub?`قدّمت ${CodeUp.timeAgo(sub.submitted_at)}${sub.grade!=null?` · الدرجة ${sub.grade}`:""}`:"لم تُقدّم بعد"}</span>
          <button class="btn dark" data-submit="${a.id}">${sub?"تعديل التسليم":"تسليم الواجب"}</button>
        </div>
      </div>`;
    }).join("");
    wireFileCardPreviews(body);

    // قادم من "فتح التمرين" بصفحة الدرس: انتقل لنفس الواجب وميّزه مؤقتًا
    const focusId = this.view && this.view.assignmentId;
    if(focusId){
      const target = body.querySelector(`[data-assignment-card="${focusId}"]`);
      if(target){
        target.classList.add("assignmentFocus");
        target.scrollIntoView({block:"center"});
        setTimeout(()=>target.classList.remove("assignmentFocus"), 2600);
      }
      delete this.view.assignmentId;
    }

    body.querySelectorAll("[data-submit]").forEach(b=>{
      b.onclick = async ()=>{
        if(!myEnrollment){
          if(!await this.confirmDialog({title:"الانضمام للكورس", message:"للتسليم يجب الانضمام للكورس أولًا. تريد الانضمام الآن؟", confirmLabel:"انضمام"})) return;
          try{
            await CodeUp.rpc.enrollInCourse(course.id);
            this.ctx = await CodeUp.loadMyContext();
            myEnrollment = this.ctx.enrollments.find(e=>e.course_id===course.id);
          }catch(e){ CodeUp.toast(e.message||"تعذّر الانضمام", "error"); return; }
        }
        this.openSubmitModal(assignments.find(a=>a.id===b.dataset.submit), course, subByAssignment[b.dataset.submit]);
      };
    });
  },

  openSubmitModal(assignment, course, existing){
    const m = this.modal(`
      <h3>تسليم: ${CodeUp.escapeHtml(assignment.title)}</h3>
      <label>ملاحظات/شرح (اختياري)</label>
      <textarea id="subContent" rows="4">${CodeUp.escapeHtml(existing?.content||"")}</textarea>
      <label>الملفات (اختياري، تقدر ترفع أكثر من ملف)</label>
      <input type="file" id="subFile" accept="image/*,application/pdf,.doc,.docx,.txt,.zip,.py,.js,.html,.css,.json,.c,.cpp,.java" multiple>
      <div id="subFilePreview" style="margin-top:8px"></div>
      <label>رابط GitHub (اختياري — بديل أو إضافة لرفع ملف)</label>
      <input type="url" id="subGithubUrl" placeholder="https://github.com/username/project" value="${CodeUp.escapeHtml(existing?.github_url||"")}">
      <div id="subGithubMsg" class="small" style="color:#E03131"></div>
      <label>مشاركة في المستجدات</label>
      <select id="subVisibility">
        <option value="private" ${existing?.visibility==="private"?"selected":""}>خاص — لا يظهر لأحد</option>
        <option value="squad" ${existing?.visibility==="squad"?"selected":""}>مجموعتي فقط</option>
        <option value="course" ${existing?.visibility==="course"?"selected":""}>كل الكورس</option>
      </select>
      <button class="primary" id="subSubmitBtn">إرسال</button>
      <div id="subMsg" class="message"></div>
    `);
    const previewBox = m.el.querySelector("#subFilePreview");
    const MAX_FILE_MB = 8;
    m.el.querySelector("#subFile").onchange = (e)=>{
      const files = [...e.target.files];
      if(!files.length){ previewBox.innerHTML = ""; return; }
      previewBox.innerHTML = files.map(f=>{
        const sizeMb = f.size/1024/1024;
        const tooBig = sizeMb > MAX_FILE_MB && !f.type.startsWith("image/"); // الصور تُضغط تلقائيًا، باقي الملفات تُرفض فورًا لو كبيرة
        if(tooBig){
          return `<div class="small" style="color:#E03131">${CodeUp.escapeHtml(f.name)} — ${sizeMb.toFixed(1)} ميجا، أكبر من الحد المسموح (${MAX_FILE_MB} ميجا). لن يُرفع هذا الملف.</div>`;
        }
        if(f.type.startsWith("image/")){
          const url = URL.createObjectURL(f);
          return `<div style="margin-bottom:6px"><img src="${url}" style="max-width:100%;max-height:180px;border-radius:8px;display:block"><span class="small mono">${CodeUp.escapeHtml(f.name)} — ${(f.size/1024).toFixed(0)} ك.ب — ستُضغط تلقائيًا</span></div>`;
        }
        return `<div class="small mono">${CodeUp.escapeHtml(f.name)} — ${(f.size/1024).toFixed(0)} ك.ب</div>`;
      }).join("");
    };
    let submitIdempotencyKey = crypto.randomUUID();
    m.el.querySelector("#subSubmitBtn").onclick = async ()=>{
      const msgEl = m.el.querySelector("#subMsg");
      const submitBtn = m.el.querySelector("#subSubmitBtn");
      if(submitBtn.disabled) return; // منع تكرار فعلي حتى لو انضغط الزر مرتين بنفس اللحظة

      const githubUrlRaw = m.el.querySelector("#subGithubUrl").value.trim();
      const githubMsgEl = m.el.querySelector("#subGithubMsg");
      githubMsgEl.textContent = "";
      if(githubUrlRaw && !/^https?:\/\/.+/i.test(githubUrlRaw)){
        githubMsgEl.textContent = "الرابط لازم يبدأ بـ http:// أو https://";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "جارِ الإرسال…";
      try{
        const content = m.el.querySelector("#subContent").value.trim();
        const visibility = m.el.querySelector("#subVisibility").value;
        const fileInput = m.el.querySelector("#subFile");

        const payload = {
          assignment_id: assignment.id, profile_id: this.ctx.user.id,
          content, visibility, status: "submitted", submitted_at: new Date().toISOString(),
          github_url: githubUrlRaw || null
        };
        // Upsert بدل insert/update منفصلين: القيد الفريد (assignment_id, profile_id) بقاعدة البيانات
        // يمنع أي تسليم مكرر حتى لو تكرر الطلب فعليًا على مستوى الـ Backend، مو بس الواجهة.
        const {data, error} = await db.from("submissions")
          .upsert(payload, {onConflict:"assignment_id,profile_id"}).select().single();
        if(error) throw error;
        const submissionId = data.id;

        // من هنا، التسليم نفسه نجح فعليًا (submissions upsert اكتمل) — أي خطأ
        // بعد هذي النقطة يخص رفع الملفات المرفقة فقط، فلازم نميّزه للطالب بدل
        // ما نوهمه إن التسليم بالكامل فشل ويحاول يرسله من جديد بلا داعي.
        const MAX_FILE_MB = 8;
        const filesToUpload = [...fileInput.files].filter(f => f.type.startsWith("image/") || f.size/1024/1024 <= MAX_FILE_MB);
        if(filesToUpload.length){
          const failedFiles = [];
          for(let i=0; i<filesToUpload.length; i++){
            try{
              const uploaded = await CodeUp.uploadSubmissionFile(filesToUpload[i], this.ctx.user.id, submissionId);
              const {data: fileRow, error: fErr} = await db.from("file_uploads")
                .upsert({
                  course_id: course.id, uploader_id: this.ctx.user.id, related_type:"submission",
                  related_id: submissionId, submission_id: submissionId, storage_path: uploaded.path,
                  file_name: uploaded.name, mime_type: uploaded.type, file_size: uploaded.size,
                  idempotency_key: `${submitIdempotencyKey}-${i}`
                }, {onConflict:"submission_id,idempotency_key"}).select().single();
              if(fErr) throw fErr;
              CodeUp.triggerTelegramSend(fileRow.id); // إرسال فوري لتيليجرام — لا ننتظره، ولا يوقف نجاح التسليم لو فشل
            }catch(fileErr){ failedFiles.push(filesToUpload[i].name); }
          }
          if(failedFiles.length){
            CodeUp.toast(`تم إرسال التسليم، لكن تعذّر رفع: ${failedFiles.join("، ")} — جرّب ترفعها مرة ثانية من نفس الواجب`, "error");
            m.close();
            this.render();
            return;
          }
        }else if(content || githubUrlRaw){
          // ما فيه ملف مرفق، لكن فيه نص أو رابط GitHub — يُؤرشف بنفس آلية الملفات
          // (صف file_uploads بدون storage_path)، فيستفيد من نفس تتبع الحالة وإعادة المحاولة الحالية.
          try{
            const {data: fileRow, error: fErr} = await db.from("file_uploads")
              .upsert({
                course_id: course.id, uploader_id: this.ctx.user.id, related_type:"submission",
                related_id: submissionId, submission_id: submissionId, storage_path: null,
                file_name: "نص/رابط التسليم", mime_type: "text/plain",
                idempotency_key: `${submitIdempotencyKey}-text`
              }, {onConflict:"submission_id,idempotency_key"}).select().single();
            if(!fErr && fileRow) CodeUp.triggerTelegramSend(fileRow.id);
          }catch(_e){ /* لا نوقف نجاح التسليم لو فشل تسجيل الأرشفة النصية */ }
        }

        CodeUp.toast("تم إرسال التسليم بنجاح", "success");
        m.close();
        this.render();
      }catch(e){
        msgEl.className = "message show error"; msgEl.textContent = e.message || "حدث خطأ أثناء التسليم";
        submitBtn.disabled = false;
        submitBtn.textContent = "إرسال";
      }
    };
  },

  async renderTimeline(body, course, myEnrollment){
    const PAGE_SIZE = 15;
    body.innerHTML = `<div class="filterRow">
      <button data-f="all" class="active">الكل</button>
      <button data-f="mine">تسليماتي</button>
      <button data-f="squad">مجموعتي</button>
    </div><div id="timelineList"></div><div id="timelineMore"></div>`;

    const list = body.querySelector("#timelineList");
    const moreBox = body.querySelector("#timelineMore");
    let currentFilter = "all", page = 0;

    // خرائط الدور/المجموعة على مستوى الكورس (تُحسب مرة وحدة، تُستخدم لكل التعليقات بهذي الصفحة)
    const [{data: admins}, {data: squadLeaders}] = await Promise.all([
      db.from("course_admins").select("profile_id").eq("course_id", course.id),
      db.from("squad_leaders").select("profile_id, squads!inner(course_id)").eq("squads.course_id", course.id)
    ]);
    const roleById = {};
    (squadLeaders||[]).forEach(l=> roleById[l.profile_id] = "leader");
    (admins||[]).forEach(a=> roleById[a.profile_id] = "admin"); // الأدمن له أولوية على شارة القائد لو الاثنين ينطبقوا
    const {data: courseEnrollments} = await db.from("enrollments").select("profile_id, squad_id").eq("course_id", course.id);
    const squadById = Object.fromEntries((courseEnrollments||[]).map(e=>[e.profile_id, e.squad_id]));
    const mySquadId = myEnrollment?.squad_id || null;

    const load = async (filter, reset)=>{
      if(reset){ page = 0; list.innerHTML = skeletonPostsHtml(3); moreBox.innerHTML = ""; }
      else moreBox.innerHTML = skeletonPostsHtml(1);

      let q = db.from("submissions").select("*, assignments!inner(title,course_id), profiles(full_name,avatar_url)")
        .eq("assignments.course_id", course.id).order("created_at",{ascending:false})
        .range(page*PAGE_SIZE, page*PAGE_SIZE + PAGE_SIZE - 1);
      if(filter==="mine") q = q.eq("profile_id", this.ctx.user.id);
      else if(filter==="squad") q = q.eq("visibility","squad");
      else q = q.in("visibility",["course","squad"]).neq("profile_id","");

      const {data: posts, error} = await q;
      const safePosts = posts || [];

      let announcements = [];
      let proposals = [];
      if(page===0 && filter!=="mine"){
        const {data: annData} = await db.from("announcements").select("*, profiles(full_name)").eq("course_id", course.id).order("created_at",{ascending:false}).limit(15);
        announcements = (annData||[]).filter(a => filter!=="squad" || !a.target_squad_id || a.target_squad_id===myEnrollment?.squad_id);
        const {data: propData} = await db.from("squad_proposals").select("*, profiles(full_name)").eq("course_id", course.id).eq("status","open").order("created_at",{ascending:false}).limit(10);
        proposals = propData || [];
      }
      const {data: propVotes} = proposals.length ? await db.from("squad_proposal_votes").select("*").in("proposal_id", proposals.map(p=>p.id)) : {data:[]};

      if(page===0 && (error || !safePosts.length) && !announcements.length && !proposals.length){ list.innerHTML = `<div class="emptyState">لا توجد منشورات بعد.</div>`; moreBox.innerHTML = ""; return; }

      const {data: reactions} = await db.from("reactions").select("*").eq("target_type","submission").in("target_id", safePosts.map(p=>p.id));
      const {data: comments} = await db.from("comments").select("*, profiles(full_name)").in("submission_id", safePosts.map(p=>p.id)).order("created_at");
      const {data: postFiles} = await db.from("file_uploads").select("*").eq("related_type","submission").in("related_id", safePosts.map(p=>p.id));
      const {data: commentFiles} = await db.from("file_uploads").select("*").eq("related_type","comment").in("related_id", (comments||[]).map(c=>c.id));
      const {data: communityReviews} = await db.from("community_reviews").select("*").in("submission_id", safePosts.map(p=>p.id));
      const {data: savedRows} = await db.from("saved_submissions").select("submission_id").eq("profile_id", this.ctx.user.id).in("submission_id", safePosts.map(p=>p.id));
      const savedIds = new Set((savedRows||[]).map(s=>s.submission_id));
      const filesByPost = {};
      for(const f of (postFiles||[])) (filesByPost[f.related_id] ||= []).push(f);
      const filesByComment = Object.fromEntries((commentFiles||[]).map(f=>[f.related_id, f]));

      const feed = [
        ...announcements.map(a=>({type:"announcement", created_at:a.created_at, data:a})),
        ...proposals.map(p=>({type:"proposal", created_at:p.created_at, data:p})),
        ...safePosts.map(p=>({type:"submission", created_at:p.created_at, data:p}))
      ].sort((x,y)=> new Date(y.created_at) - new Date(x.created_at));

      const DAY_LABELS = {sat:"سبت",sun:"أحد",mon:"اثنين",tue:"ثلاثاء",wed:"أربعاء",thu:"خميس",fri:"جمعة"};
      const html = feed.map(item=>{
        if(item.type==="announcement"){
          const a = item.data;
          return `
          <div class="timelinePost feedAnnouncement" data-announcement="${a.id}">
            <span class="feedTag">${Icon("announcement")} إعلان</span>
            <div class="meta"><b style="color:var(--ink)">${CodeUp.escapeHtml(a.profiles?.full_name||"إدارة الكورس")}</b><span class="mono">${CodeUp.timeAgo(a.created_at)}</span></div>
            <div class="body"><b>${CodeUp.escapeHtml(a.title)}</b>${a.content?`<br>${CodeUp.escapeHtml(a.content)}`:""}</div>
          </div>`;
        }
        if(item.type==="proposal"){
          const p = item.data;
          const votes = (propVotes||[]).filter(v=>v.proposal_id===p.id);
          const iVoted = votes.some(v=>v.profile_id===this.ctx.user.id);
          const daysLabel = (p.schedule_days||[]).map(d=>DAY_LABELS[d]||d).join("، ") || "غير محدد";
          const timeLabel = p.time_from && p.time_to ? `${p.time_from.slice(0,5)} - ${p.time_to.slice(0,5)}` : "";
          return `
          <div class="timelinePost feedAnnouncement" data-proposal="${p.id}">
            <span class="feedTag">${Icon("group")} اقتراح مجموعة جديدة</span>
            <div class="meta"><b style="color:var(--ink)">${CodeUp.escapeHtml(p.profiles?.full_name||"طالب")}</b><span class="mono">${CodeUp.timeAgo(p.created_at)}</span></div>
            <div class="body"><b>${CodeUp.escapeHtml(p.name)}</b><br><span class="small">${CodeUp.escapeHtml(daysLabel)}${timeLabel?" · "+timeLabel:""}</span></div>
            <div class="row" style="margin-top:8px">
              <span class="small mono">${votes.length}/${p.min_approvals} موافقين</span>
              <button class="btn ${iVoted?'':'dark'}" data-votepropose="${p.id}" ${iVoted?"disabled":""}>${iVoted?`<span class="inlineBtnIcon">${Icon("check")}</span> وافقت`:"موافق"}</button>
            </div>
          </div>`;
        }
        const p = item.data;
        const myLiked = (reactions||[]).some(r=>r.target_id===p.id && r.user_id===this.ctx.user.id);
        const likeCount = (reactions||[]).filter(r=>r.target_id===p.id).length;
        const postComments = (comments||[]).filter(c=>c.submission_id===p.id);
        const subReviews = (communityReviews||[]).filter(r=>r.submission_id===p.id);
        const meetsCount = subReviews.filter(r=>r.review_type==="meets_requirements").length;
        const needsCount = subReviews.filter(r=>r.review_type==="needs_review").length;
        const myReview = subReviews.find(r=>r.reviewer_id===this.ctx.user.id);
        const isOwn = p.profile_id === this.ctx.user.id;
        const cBlock = CodeUp.buildCommentsBlock(postComments, p.id, {roleById, mySquadId, squadById, filesByComment});
        return `
        <div class="timelinePost" data-post="${p.id}">
          <span class="feedTag">${Icon("check")} تسليم واجب</span>
          <div class="metaWithAvatar" data-gotoprofile="${p.profile_id}">${CodeUp.avatarHtml(p.profiles?.full_name||"طالب", p.profiles?.avatar_url)}<div class="metaTextCol"><b>${CodeUp.escapeHtml(p.profiles?.full_name||"طالب")}</b><span class="mono">${CodeUp.timeAgo(p.created_at)}</span></div></div>
          <div class="small mono" style="margin-bottom:6px">${CodeUp.escapeHtml(p.assignments?.title||"")}</div>
          <div class="body">${CodeUp.escapeHtml(p.content||"")}</div>
          ${(filesByPost[p.id]||[]).map(f=>renderFileCard(f,"submissions")).join("")}
          <div class="reactBar">
            <button class="pillBtn ${myLiked?'active':''}" data-like="${p.id}" aria-label="إعجاب"><span class="tabIcon">${Icon("heart")}</span><span>${likeCount||0}</span></button>
            ${cBlock.toggleHtml}
            <button class="pillBtn pillRound" data-share="${p.id}" data-sharetitle="${CodeUp.escapeHtml(p.assignments?.title||'')}" data-sharename="${CodeUp.escapeHtml(p.profiles?.full_name||'')}" aria-label="مشاركة"><span class="tabIcon">${Icon("share_pill")}</span></button>
            <button class="pillBtn pillRound ${savedIds.has(p.id)?'active':''}" data-save="${p.id}" aria-label="حفظ"><span class="tabIcon">${Icon("bookmark")}</span></button>
          </div>
          <div class="communityReview" data-communityreview="${p.id}">
            <div class="crHead"><span class="tabIcon">${Icon("group")}</span><b style="color:var(--ink)">مراجعة المجتمع</b><span class="mono">${subReviews.length} مراجعات</span></div>
            <div class="crCounts"><span>${meetsCount} مستوفي</span><span>${needsCount} يحتاج مراجعة</span></div>
            ${isOwn ? `<p class="small">لا يمكنك مراجعة تسليمك الخاص.</p>` : `
            <div class="reactBar" style="border-top:0;padding-top:0;margin-top:0">
              <button class="pillBtn ${myReview?.review_type==='meets_requirements'?'active':''}" data-crtype="meets_requirements" data-crsub="${p.id}" aria-label="مستوفي المتطلبات"><span class="tabIcon">${Icon("check_circle")}</span><span>مستوفي المتطلبات</span></button>
              <button class="pillBtn ${myReview?.review_type==='needs_review'?'active':''}" data-crtype="needs_review" data-crsub="${p.id}" aria-label="يحتاج مراجعة"><span class="tabIcon">${Icon("flag")}</span><span>يحتاج مراجعة</span></button>
            </div>
            <textarea data-crcomment="${p.id}" rows="2" placeholder="إضافة ملاحظة تعليمية…">${CodeUp.escapeHtml(myReview?.comment||"")}</textarea>
            <button class="btn" data-crsave="${p.id}" style="margin-top:6px">حفظ الملاحظة</button>
            `}
          </div>
          ${cBlock.listHtml}
          ${commentComposerHtml(p.id)}
        </div>`;
      }).join("");
      if(reset) list.innerHTML = ""; // يستبدل Skeleton بالمحتوى الحقيقي دفعة واحدة
      list.insertAdjacentHTML("beforeend", html);
      wireFileCardPreviews(list);
      CodeUp.wireCommentsToggle(list);

      list.querySelectorAll("[data-gotoprofile]:not([data-wired])").forEach(el=>{
        el.dataset.wired = "1";
        el.style.cursor = "pointer";
        el.onclick = ()=> this.go({name:"profile", profileId: el.dataset.gotoprofile});
      });

      // ===== مراجعة المجتمع: اختيار/تبديل/حفظ ملاحظة — كلها عبر submit_community_review() فقط (RLS تمنع أي إدخال مباشر) =====
      list.querySelectorAll("[data-crtype]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const submissionId = b.dataset.crsub;
          const reviewType = b.dataset.crtype;
          const wrap = b.closest("[data-communityreview]");
          const commentVal = wrap.querySelector("[data-crcomment]")?.value || null;
          try{
            await db.rpc("submit_community_review", {p_submission_id: submissionId, p_review_type: reviewType, p_comment: commentVal}).throwOnError();
            load(currentFilter, true);
          }catch(e){ CodeUp.toast(e.message, "error"); }
        };
      });
      list.querySelectorAll("[data-crsave]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const submissionId = b.dataset.crsave;
          const wrap = b.closest("[data-communityreview]");
          const active = wrap.querySelector("[data-crtype].active");
          if(!active){ CodeUp.toast("اختر (مستوفي المتطلبات) أو (يحتاج مراجعة) أولًا", "error"); return; }
          const commentVal = wrap.querySelector("[data-crcomment]")?.value || null;
          try{
            await db.rpc("submit_community_review", {p_submission_id: submissionId, p_review_type: active.dataset.crtype, p_comment: commentVal}).throwOnError();
            CodeUp.toast("تم حفظ ملاحظتك", "success");
          }catch(e){ CodeUp.toast(e.message, "error"); }
        };
      });

      // ===== حفظ (Bookmark) — toggle بسيط، كل مستخدم يدير حفظياته فقط (RLS) =====
      list.querySelectorAll("[data-save]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const submissionId = b.dataset.save;
          const isSaved = b.classList.contains("active");
          b.disabled = true;
          try{
            if(isSaved){
              await db.from("saved_submissions").delete().eq("submission_id", submissionId).eq("profile_id", this.ctx.user.id).throwOnError();
              b.classList.remove("active");
            }else{
              await db.from("saved_submissions").insert({submission_id: submissionId, profile_id: this.ctx.user.id}).throwOnError();
              b.classList.add("active");
            }
          }catch(e){ CodeUp.toast(e.message, "error"); }
          finally{ b.disabled = false; }
        };
      });

      // ===== مشاركة — Web Share API مع بديل نسخ للحافظة لو غير متاحة =====
      list.querySelectorAll("[data-share]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          const shareText = `${b.dataset.sharename} — ${b.dataset.sharetitle} — CodeUp`;
          const shareUrl = window.location.href;
          if(navigator.share){
            try{ await navigator.share({title:"CodeUp", text:shareText, url:shareUrl}); }catch(_e){ /* المستخدم ألغى المشاركة */ }
          }else{
            try{ await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`); CodeUp.toast("تم نسخ الرابط", "success"); }
            catch(_e){ CodeUp.toast("تعذّر النسخ", "error"); }
          }
        };
      });

      const requireJoin = async ()=>{
        if(myEnrollment) return true;
        if(!await this.confirmDialog({title:"الانضمام للكورس", message:"للتفاعل يجب الانضمام للكورس أولًا. تريد الانضمام الآن؟", confirmLabel:"انضمام"})) return false;
        try{ await CodeUp.rpc.enrollInCourse(course.id); this.ctx = await CodeUp.loadMyContext(); myEnrollment = this.ctx.enrollments.find(e=>e.course_id===course.id); return true; }
        catch(e){ CodeUp.toast(e.message||"تعذّر الانضمام", "error"); return false; }
      };
      list.querySelectorAll("[data-votepropose]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          if(!(await requireJoin())) return;
          b.disabled = true;
          try{
            const {data} = await db.rpc("vote_squad_proposal", {p_proposal_id: b.dataset.votepropose});
            if(data?.status === "approved") CodeUp.toast("وصلت المجموعة للحد المطلوب — تكوّنت تلقائيًا", "success");
            else CodeUp.toast("تم تسجيل موافقتك", "success");
            load(currentFilter, true);
          }catch(e){ CodeUp.toast(e.message,"error"); b.disabled = false; }
        };
      });
      // ===== إعجاب — تحديث فوري محلي بدون إعادة تحميل الصفحة (نفس منطق فيد الرئيسية) =====
      list.querySelectorAll("[data-like]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        b.onclick = async ()=>{
          if(!(await requireJoin())) return;
          if(b.disabled) return;
          const countEl = b.querySelector("span:last-child");
          const wasLiked = b.classList.contains("active");
          const prevCount = Number(countEl.textContent)||0;
          b.classList.toggle("active", !wasLiked);
          countEl.textContent = wasLiked ? Math.max(0, prevCount-1) : prevCount+1;
          b.disabled = true;
          try{ await CodeUp.rpc.toggleReaction("submission", b.dataset.like, "like"); }
          catch(e){
            b.classList.toggle("active", wasLiked);
            countEl.textContent = prevCount;
            CodeUp.toast(e.message,"error");
          } finally { b.disabled = false; }
        };
      });
      // ===== تعليق — إضافة محلية فورية بدون إعادة تحميل الصفحة (نفس منطق فيد الرئيسية) =====
      list.querySelectorAll("[data-commentsend]:not([data-wired])").forEach(b=>{
        b.dataset.wired = "1";
        const targetId = b.dataset.commentsend;
        b.onclick = async ()=>{
          if(!(await requireJoin())) return;
          const input = list.querySelector(`[data-commentinput="${targetId}"]`);
          const val = input.value.trim();
          if(!val || b.disabled) return;
          b.disabled = true;
          try{
            await CodeUp.rpc.addComment(targetId, val);
            input.value="";
            const commentsList = list.querySelector(`[data-commentslist="${targetId}"]`);
            if(commentsList){
              const empty = commentsList.querySelector("p.small");
              if(empty) empty.remove();
              commentsList.insertAdjacentHTML("beforeend", `<div class="comment">
                <div class="commentHead"><b>${CodeUp.escapeHtml(this.ctx.profile?.full_name||"مستخدم")}</b></div>
                <div>${CodeUp.escapeHtml(val)}</div>
              </div>`);
              commentsList.classList.remove("hidden");
            }
            const toggleBtn = list.querySelector(`[data-toggleComments="${targetId}"]`);
            const countSpan = toggleBtn?.querySelector("span:last-child");
            if(countSpan) countSpan.textContent = (Number(countSpan.textContent)||0) + 1;
          }catch(e){ CodeUp.toast(e.message,"error"); }
          finally{ b.disabled = false; }
        };
      });

      if(safePosts.length === PAGE_SIZE){
        moreBox.innerHTML = `<button class="btn" id="loadMoreBtn">تحميل المزيد</button>`;
        moreBox.querySelector("#loadMoreBtn").onclick = ()=>{ page++; load(currentFilter, false); };
      }else{
        moreBox.innerHTML = "";
      }
    };

    body.querySelectorAll("[data-f]").forEach(b=>{
      b.onclick = ()=>{ currentFilter=b.dataset.f; body.querySelectorAll("[data-f]").forEach(x=>x.classList.remove("active")); b.classList.add("active"); load(currentFilter, true); };
    });
    load(currentFilter, true);
  },

  async renderSquads(body, course, myEnrollment, isAdmin, isLeader){
    const {data: squads} = await db.from("squads").select("*, squad_leaders(profile_id, profiles(full_name))").eq("course_id", course.id).eq("status","active");
    const {data: myRequests} = await db.from("squad_join_requests").select("*").eq("user_id", this.ctx.user.id).eq("status","pending");
    const pendingSquadIds = new Set((myRequests||[]).map(r=>r.squad_id));

    let html = "";
    if(!myEnrollment?.squad_id){
      html += `<div class="card2"><div class="row"><b>تريد قيادة مجموعة؟</b><button class="btn dark" id="applyLeaderBtn">تقديم طلب قيادة</button></div></div>`;
    }
    html += `<div class="card2"><div class="row"><b>ما لقيت مجموعة تناسبك؟</b><button class="btn dark" id="proposeSquadBtn">اقترح مجموعة جديدة</button></div>
      <p class="small" style="margin-top:6px">يظهر اقتراحك بالتايم لاين، ولو وافق عليه 5 طلاب على الأقل، تتكوّن المجموعة تلقائيًا وتصير قائدها.</p></div>`;

    html += `<div class="grid">` + (squads||[]).map(sq=>{
      const isMine = myEnrollment?.squad_id === sq.id;
      const pending = pendingSquadIds.has(sq.id);
      // بعد إصلاح RLS: القائد يظهر فقط لعضو المجموعة فعليًا (squad_leaders غير مرئية لغير الأعضاء).
      // لغير الأعضاء لا نعرض "لا يوجد قائد" (توحي بمجموعة فارغة وهذا مضلِّل) — نعرض دعوة واضحة للانضمام بدلها.
      const leaders = (sq.squad_leaders||[]).map(l=>l.profiles?.full_name).filter(Boolean).join("، ");
      return `
      <div class="courseCard" ${isMine?`data-detail="${sq.id}" style="cursor:pointer"`:""}>
        <div class="row"><h3>${CodeUp.escapeHtml(sq.name)}</h3>${isMine?'<span class="tag approved">عضو</span>':''}</div>
        ${isMine
          ? `<p class="small">القائد: ${CodeUp.escapeHtml(leaders||"لا يوجد قائد بعد")}</p>`
          : `<p class="small">انضم إلى المجموعة لرؤية الأعضاء ومحتوى المجموعة.</p>`}
        <p class="small">${CodeUp.escapeHtml(sq.description||"")}</p>
        ${isMine ? `<button class="btn" data-detailbtn="${sq.id}">الأعضاء والتفاصيل</button>` : pending
          ? `<button class="btn" disabled>طلبك قيد المراجعة</button>`
          : `<button class="btn dark" data-join="${sq.id}">طلب الانضمام</button>`}
      </div>`;
    }).join("") + `</div>`;

    body.innerHTML = html || `<div class="emptyState">لا توجد مجموعات بعد.</div>`;

    const applyBtn = body.querySelector("#applyLeaderBtn");
    if(applyBtn) applyBtn.onclick = ()=> this.openLeaderApplicationModal(course);
    body.querySelector("#proposeSquadBtn").onclick = ()=> this.openProposeSquadModal(course, myEnrollment);

    body.querySelectorAll("[data-detail], [data-detailbtn]").forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        const id = el.dataset.detail || el.dataset.detailbtn;
        this.openSquadDetailModal(squads.find(s=>s.id===id), course, isAdmin, isLeader);
      };
    });

    body.querySelectorAll("[data-join]").forEach(b=>{
      b.onclick = async ()=>{
        if(!myEnrollment){
          if(!await this.confirmDialog({title:"الانضمام للكورس", message:"للانضمام لمجموعة يجب الانضمام للكورس أولًا. تريد الانضمام الآن؟", confirmLabel:"انضمام"})) return;
          try{ await CodeUp.rpc.enrollInCourse(course.id); this.ctx = await CodeUp.loadMyContext(); }
          catch(e){ CodeUp.toast(e.message||"تعذّر الانضمام", "error"); return; }
        }
        // تحذير قبل الطلب لو الطالب أصلًا بمجموعة ثانية بنفس الكورس — القبول ينقله تلقائيًا
        if(myEnrollment?.squad_id && myEnrollment.squad_id !== b.dataset.join){
          const currentSquad = squads.find(s=>s.id===myEnrollment.squad_id);
          const ok = await this.confirmDialog({title:"تغيير المجموعة", message:`أنت حاليًا عضو بمجموعة "${currentSquad?.name||""}". لو تمت الموافقة على هذا الطلب، سيتم نقلك تلقائيًا لهذه المجموعة الجديدة وإخراجك من مجموعتك الحالية.`, confirmLabel:"متابعة"});
          if(!ok) return;
        }
        b.disabled = true;
        try{
          await CodeUp.rpc.requestJoinSquad(b.dataset.join);
          CodeUp.toast("تم إرسال طلب الانضمام", "success");
          this.render();
        }catch(e){ CodeUp.toast(e.message, "error"); b.disabled = false; }
      };
    });
  },

  async openSquadDetailModal(squad, course, isAdmin, isLeader){
    const leaderIds = new Set((squad.squad_leaders||[]).map(l=>l.profile_id));
    const {data: members} = await db.from("enrollments").select("profile_id, profiles(full_name, avatar_url)").eq("squad_id", squad.id);

    const rows = (members||[]).map(m=>{
      const isLeaderRow = leaderIds.has(m.profile_id);
      const isMe = m.profile_id === this.ctx.user.id;
      return `<tr data-member="${m.profile_id}">
        <td style="display:flex;align-items:center;gap:8px">${CodeUp.avatarHtml(m.profiles?.full_name||"", m.profiles?.avatar_url, 28)} ${CodeUp.escapeHtml(m.profiles?.full_name||"")} ${isLeaderRow?'<span class="tag approved">قائد</span>':''}</td>
        <td>${isMe?"":`<button class="btn" data-msg="${m.profile_id}">مراسلة</button>`}</td>
      </tr>`;
    }).join("");

    const m = this.modal(`
      <h3 style="margin-top:0">${CodeUp.escapeHtml(squad.name)}</h3>
      <table class="small" style="width:100%;border-collapse:collapse">
        <thead><tr><th style="text-align:start">العضو</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="2" class="emptyState">لا يوجد أعضاء بعد.</td></tr>`}</tbody>
      </table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn dark" id="squadChatBtn">💬 محادثة المجموعة (تيليجرام)</button>
        <button class="btn danger" id="leaveSquadBtn">مغادرة المجموعة</button>
      </div>
    `);

    m.el.querySelector("#squadChatBtn").onclick = async (ev)=>{
      const btn = ev.currentTarget;
      btn.disabled = true;
      const res = await CodeUp.callSquadTopic(squad.id);
      btn.disabled = false;
      if(!res){ CodeUp.toast("تعذّر فتح محادثة المجموعة حاليًا، حاول بعد قليل", "error"); return; }
      this.sheet(`
        <h3 style="margin:0 0 12px">محادثة المجموعة</h3>
        <a class="btn dark" href="${res.url}" target="_blank" rel="noopener" style="display:block;text-align:center">فتح محادثة المجموعة في تيليجرام</a>
        ${res.invite_url?`<p class="small" style="margin:12px 0 6px">أول مرة؟ انضم لمجتمع CodeUp أولًا ثم افتح المحادثة:</p>
        <a class="btn" href="${res.invite_url}" target="_blank" rel="noopener" style="display:block;text-align:center">الانضمام للمجتمع</a>`:""}
      `);
    };

    m.el.querySelectorAll("[data-msg]").forEach(b=>{
      b.onclick = async ()=>{
        const {data: conv} = await db.rpc("get_or_create_conversation", {p_other_user: b.dataset.msg}).single();
        m.close();
        this.go({name:"messages", conversationId: conv.id});
      };
    });

    // ملاحظة: "تعيين قائد" أُزيلت نهائيًا من لوحة الطالب (بقرار صريح) — أصبحت
    // متاحة فقط من لوحة تحكم الأدمن لحسابات سوبر أدمن، ومحمية بنفس الشرط
    // بمستوى RLS/RPC (assign_squad_leader) وليس بمجرد إخفاء الزر هنا.

    m.el.querySelector("#leaveSquadBtn").onclick = async ()=>{
      if(!await this.confirmDialog({title:"مغادرة المجموعة", confirmLabel:"مغادرة", danger:true})) return;
      try{
        await db.rpc("leave_squad", {p_course_id: course.id}).throwOnError();
        CodeUp.toast("تم مغادرة المجموعة", "success");
        m.close();
        this.ctx = await CodeUp.loadMyContext();
        this.render();
      }catch(e){ CodeUp.toast(e.message, "error"); }
    };
  },

  openLeaderApplicationModal(course){
    const m = this.modal(`
      <h3>طلب قيادة مجموعة</h3>
      <label>لماذا تريد أن تكون قائد مجموعة؟</label>
      <textarea id="leadMsg" rows="3"></textarea>
      <label>خبرتك السابقة (إن وجدت)</label>
      <textarea id="leadExp" rows="3"></textarea>
      <button class="primary" id="leadSendBtn">إرسال الطلب</button>
      <div id="leadMsgBox" class="message"></div>
    `);
    m.el.querySelector("#leadSendBtn").onclick = async ()=>{
      const box = m.el.querySelector("#leadMsgBox");
      const btn = m.el.querySelector("#leadSendBtn");
      await CodeUp.withBtnLoading(btn, async ()=>{
        try{
          await CodeUp.rpc.applyForLeader(course.id, null, m.el.querySelector("#leadMsg").value.trim(), m.el.querySelector("#leadExp").value.trim());
          CodeUp.toast("تم إرسال طلب القيادة", "success");
          m.close();
        }catch(e){ box.className="message show error"; box.textContent = e.message; }
      });
    };
  },

  openProposeSquadModal(course, myEnrollment){
    const DAYS = [["sat","سبت"],["sun","أحد"],["mon","اثنين"],["tue","ثلاثاء"],["wed","أربعاء"],["thu","خميس"],["fri","جمعة"]];
    const m = this.modal(`
      <h3>اقتراح مجموعة جديدة</h3>
      <label>اسم المجموعة</label>
      <input id="propName" placeholder="مثلاً: مجموعة المساء">
      <label>أيام اللقاء</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0">
        ${DAYS.map(([key,label])=>`<label style="display:flex;align-items:center;gap:4px;font-size:13px">
          <input type="checkbox" data-propday value="${key}"> ${label}
        </label>`).join("")}
      </div>
      <label>من الساعة</label><input id="propFrom" type="time">
      <label>إلى الساعة</label><input id="propTo" type="time">
      <p class="small" style="margin-top:8px">هيظهر اقتراحك بالتايم لاين، ولو وافق عليه 5 طلاب على الأقل، تتكوّن المجموعة تلقائيًا وتصير قائدها. أنت أول موافق تلقائيًا.</p>
      <button class="primary" id="propSendBtn">نشر الاقتراح</button>
      <div id="propMsgBox" class="message"></div>
    `);
    m.el.querySelector("#propSendBtn").onclick = async ()=>{
      const box = m.el.querySelector("#propMsgBox");
      const name = m.el.querySelector("#propName").value.trim();
      if(!name){ box.className="message show error"; box.textContent="اسم المجموعة إلزامي"; return; }
      if(!myEnrollment){ box.className="message show error"; box.textContent="لازم تكون منضم للكورس أولًا"; return; }
      const days = [...m.el.querySelectorAll("[data-propday]:checked")].map(cb=>cb.value);
      const btn = m.el.querySelector("#propSendBtn");
      await CodeUp.withBtnLoading(btn, async ()=>{
        try{
          const {data: prop, error} = await db.from("squad_proposals").insert({
            course_id: course.id, proposed_by: this.ctx.user.id, name,
            schedule_days: days, time_from: m.el.querySelector("#propFrom").value || null,
            time_to: m.el.querySelector("#propTo").value || null
          }).select().single();
          if(error) throw error;
          await db.rpc("vote_squad_proposal", {p_proposal_id: prop.id});
          CodeUp.toast("تم نشر الاقتراح — شاركه مع زملائك!", "success");
          m.close();
          this.go({name:"course", courseId: course.id, courseSlug: course.slug, tab:"timeline"});
        }catch(e){ box.className="message show error"; box.textContent = e.message; }
      });
    };
  },

  async renderProgress(body, course, myEnrollment){
    if(!myEnrollment){ body.innerHTML = `<div class="emptyState">جارِ تسجيلك في الكورس…</div>`; return; }
    body.innerHTML = `
      <div class="grid">
        <div class="box"><span class="eyebrow">التقدم</span><p style="font-size:26px;margin:8px 0 0;font-weight:700">${myEnrollment.progress}%</p></div>
        <div class="box"><span class="eyebrow">XP</span><p style="font-size:26px;margin:8px 0 0;font-weight:700">${myEnrollment.xp}</p></div>
        <div class="box"><span class="eyebrow">Streak</span><p style="font-size:26px;margin:8px 0 0;font-weight:700">${myEnrollment.streak}</p></div>
        <div class="box"><span class="eyebrow">مكتمل</span><p style="font-size:26px;margin:8px 0 0;font-weight:700">${myEnrollment.completed_count}</p></div>
      </div>`;
  },

  async renderLeaderboard(body, course){
    const {data} = await db.from("enrollments").select("xp, progress, profiles(full_name)").eq("course_id", course.id).order("xp",{ascending:false}).limit(20);
    if(!data || !data.length){ body.innerHTML = `<div class="emptyState">لا توجد بيانات بعد.</div>`; return; }
    body.innerHTML = `<div class="card2">` + data.map((e,i)=>`
      <div class="row" style="padding:8px 0;${i? 'border-top:1px dashed rgba(255,255,255,.12)':''}">
        <span><span class="mono small">#${i+1}</span> ${CodeUp.escapeHtml(e.profiles?.full_name||"طالب")}</span>
        <span class="small mono">${e.xp} XP · ${e.progress}%</span>
      </div>`).join("") + `</div>`;
  }
};

function statusLabel(s){
  return {on_track:"على المسار",at_risk:"في خطر",behind:"متأخر",inactive:"غير نشط",
    submitted:"تم التسليم",late:"متأخر",missing:"لم يُسلَّم",reviewed:"تمت المراجعة"}[s] || s;
}
