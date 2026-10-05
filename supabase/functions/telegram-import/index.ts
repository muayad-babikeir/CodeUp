import { createClient } from "jsr:@supabase/supabase-js@2";

// استيراد رسائل من مجموعة/قناة تيليجرام "مصدر" إلى أرشيف مادة جامعية عبر copyMessage (نسخ داخل خوادم تيليجرام: بلا تنزيل ولا رفع).
// كل رسالة تُصبح «مصدرًا» مستقلًا في CodeUp بنفس نظام الرفع: فاصل ← "القسم | رقم" ← الملف، ثم يُحدَّث الفهرس المثبّت.
// actions: analyze | start | run | resume | cancel | cron
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_RANGE = 300;          // أقصى عدد معرّفات رسائل في عملية واحدة
const RUN_BUDGET_MS = 100_000;  // ميزانية كل استدعاء (حد الدالة ~150 ثانية)
const PACE_MS = 3_000;          // ≈ 20 رسالة/دقيقة كحد أقصى لكل مجموعة (حد تيليجرام)

const RESERVED = new Set(["c", "s", "joinchat", "addstickers", "addemoji", "share", "proxy", "socks", "login", "iv", "setlanguage", "bg", "addtheme", "boost", "m", "invoice"]);

// ---- تحليل روابط الرسائل: t.me/c/ID/MSG ، t.me/c/ID/TOPIC/MSG ، t.me/username/MSG ، t.me/username/TOPIC/MSG ----
function parseTgLink(raw: string): { chat: string; thread: number | null; msg: number } | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!/^(www\.)?(t\.me|telegram\.me|telegram\.dog)$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const qThread = Number(u.searchParams.get("thread"));
  const nums = (arr: string[]) => arr.every((p) => /^\d+$/.test(p));
  if (parts[0] === "c") {
    if (!/^\d+$/.test(parts[1] || "")) return null;
    const rest = parts.slice(2);
    if (rest.length === 0 || rest.length > 2 || !nums(rest)) return null;
    const msg = Number(rest[rest.length - 1]);
    const thread = rest.length === 2 ? Number(rest[0]) : (qThread || null);
    return { chat: `-100${parts[1]}`, thread, msg };
  }
  const name = parts[0] || "";
  if (RESERVED.has(name.toLowerCase()) || name.startsWith("+") || !/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(name)) return null;
  const rest = parts.slice(1);
  if (rest.length === 0 || rest.length > 2 || !nums(rest)) return null;
  const msg = Number(rest[rest.length - 1]);
  const thread = rest.length === 2 ? Number(rest[0]) : (qThread || null);
  return { chat: `@${name}`, thread, msg };
}


// ===== مكتبة الفهرس (نسخة مطابقة في telegram-upload-resource و telegram-resource-cleanup) =====
const SEP = "────── ✦ ──────── ✦ ─────";
const pad = (n: number) => String(n).padStart(2, "0");
const escH = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KEYCAP = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const icon = (i: number) => (i <= 10 ? KEYCAP[i] : `${i}.`);

type IdxFile = { url: string; section: string | null; episode: number | null; episode_code: string | null; created_at: string };

// يبني نص الفهرس: قسم لكل مجموعة، وحلقاتها E01 | E02 ... كلها روابط مباشرة لرسائل الملفات.
// حد تيليجرام 4096 حرفًا: عند تجاوزه نعرض آخر N حلقة من كل قسم (الأحدث) مع علامة «…».
function buildIndexText(files: IdxFile[]): string {
  const sections = new Map<string, IdxFile[]>();   // ترتيب الأقسام = ترتيب أول رفع (ثابت)
  const others: IdxFile[] = [];
  for (const f of [...files].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (f.section) { if (!sections.has(f.section)) sections.set(f.section, []); sections.get(f.section)!.push(f); }
    else others.push(f);
  }
  const render = (max: number, maxSections: number) => {
    let text = "📚 الفهرس\n";
    let i = 0;
    const entries = [...sections.entries()];
    const shown = entries.slice(0, maxSections);
    for (const [name, rows] of shown) {
      i++;
      rows.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
      const part = rows.length > max ? rows.slice(rows.length - max) : rows;
      const links = part.map((r) => `<a href="${r.url}">${r.episode_code || "E" + pad(r.episode ?? 0)}</a>`).join(" | ");
      text += `\n${icon(i)} ${escH(name)}\n${rows.length > max ? "… | " : ""}${links}\n`;
    }
    if (entries.length > shown.length) text += `\n… (+${entries.length - shown.length})\n`;
    if (others.length) {
      i++;
      const part = others.length > max ? others.slice(others.length - max) : others;
      const base = others.length - part.length;
      text += `\n${icon(i)} ملفات أخرى\n${others.length > max ? "… | " : ""}${part.map((r, k) => `<a href="${r.url}">${pad(base + k + 1)}</a>`).join(" | ")}\n`;
    }
    if (!files.length) text += "\n(لا توجد ملفات بعد)";
    return text.trimEnd();
  };
  for (const max of [Infinity, 40, 20, 10, 5]) { const t = render(max, Infinity); if (t.length <= 4000) return t; }
  for (let n = sections.size; n >= 1; n--) { const t = render(5, n); if (t.length <= 4000) return t; }
  return render(3, 1).slice(0, 4000);
}

// يعدّل رسالة الفهرس الموجودة (لا ينشئ رسالة جديدة أبدًا). يُعاد المحاولة مرة إن تغيّرت الملفات أثناء البناء (رفعان متزامنان).
// deno-lint-ignore no-explicit-any
async function rebuildIndex(db: any, tg: (m: string, b: unknown) => Promise<any>, topicId: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: topic } = await db.from("archive_topics").select("id, index_message_id, archive_destinations(telegram_chat_id)").eq("id", topicId).maybeSingle();
    if (!topic?.index_message_id) return;
    const { data: files } = await db.from("telegram_resource_files").select("url, section, episode, episode_code, created_at").eq("topic_id", topicId).order("created_at");
    const r = await tg("editMessageText", {
      chat_id: String(topic.archive_destinations?.telegram_chat_id), message_id: topic.index_message_id,
      text: buildIndexText(files || []), parse_mode: "HTML", disable_web_page_preview: true,
    });
    if (!r.ok && !/message is not modified/i.test(String(r.description || ""))) { console.error("index edit failed:", r.description); return; }
    const { count } = await db.from("telegram_resource_files").select("url", { count: "exact", head: true }).eq("topic_id", topicId);
    if (count === (files || []).length) return;
  }
}
// ===== نهاية المكتبة =====

// استدعاء Telegram Bot API (JSON)
const tgCall = (BOT: string) => (m: string, b: unknown) =>
  fetch(`https://api.telegram.org/bot${BOT}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

// إنشاء (أو إيجاد) موضوع Forum للمادة داخل مجموعة السنة، مع رسالة الفهرس المثبّتة كأول رسالة فيه.
// أي فشل يظهر للأدمن برسالة واضحة ولا يُرسَل شيء.
// deno-lint-ignore no-explicit-any
async function ensureSubjectTopic(db: any, BOT: string, dest: any, subjectId: string, title: string): Promise<{ id: string; thread: number }> {
  const tg = tgCall(BOT);
  const sel = "id, telegram_thread_id, index_message_id";
  const find = async () => (await db.from("archive_topics").select(sel).eq("destination_id", dest.id).eq("subject_id", subjectId).maybeSingle()).data;
  const makeIndex = async (row: { id: string; telegram_thread_id: number }) => {
    const m = await tg("sendMessage", { chat_id: String(dest.telegram_chat_id), message_thread_id: row.telegram_thread_id, text: buildIndexText([]), parse_mode: "HTML", disable_web_page_preview: true });
    if (!m.ok) return;
    await tg("pinChatMessage", { chat_id: String(dest.telegram_chat_id), message_id: m.result.message_id, disable_notification: true }); // فشل التثبيت (صلاحية) غير حرج
    await db.from("archive_topics").update({ index_message_id: m.result.message_id }).eq("id", row.id);
  };
  const ex = await find();
  if (ex) {
    if (!ex.index_message_id) await makeIndex(ex); // موضوع قديم بلا فهرس
    return { id: ex.id, thread: ex.telegram_thread_id };
  }
  const j = await tg("createForumTopic", { chat_id: String(dest.telegram_chat_id), name: (title || "Subject").slice(0, 128) });
  if (!j.ok) throw new Error(`تعذّر إنشاء موضوع المادة في تيليجرام (${j.description || "خطأ"}). تأكد أن المجموعة مفعّل فيها «المواضيع» (Forum) وأن البوت مشرف بصلاحية إدارة المواضيع.`);
  const thread = j.result.message_thread_id as number;
  const ins = await db.from("archive_topics").insert({ destination_id: dest.id, topic_key: `subject:${subjectId}`, telegram_thread_id: thread, title, subject_id: subjectId }).select(sel).single();
  if (ins.error) {
    // سباق: رفعان متزامنان لنفس المادة — نحذف موضوعنا ونستخدم الذي سُجّل أولًا
    await tg("deleteForumTopic", { chat_id: String(dest.telegram_chat_id), message_thread_id: thread });
    const again = await find();
    if (again) return { id: again.id, thread: again.telegram_thread_id };
    throw new Error("تعذّر حفظ موضوع المادة: " + ins.error.message);
  }
  await makeIndex(ins.data);
  return { id: ins.data.id, thread };
}

// ===== نواة الاستيراد: حلقة تتابعية بلا اعتماد مباشر على Telegram/Supabase (تُحقن عبر io) =====
const COPY_SKIP_RE = /message to copy not found|message can't be copied|MESSAGE_ID_INVALID|message to forward not found/i;
const PROTECTED_RE = /protected|forwards? restricted|CHAT_FORWARDS_RESTRICTED|can't be forwarded/i;
const NO_ACCESS_RE = /chat not found|not enough rights|bot was kicked|bot is not a member|have no rights|PEER_ID_INVALID/i;

function friendlyCopyError(desc: string): string {
  if (PROTECTED_RE.test(desc)) return "مجموعة المصدر عليها «تقييد حفظ المحتوى» (Restrict saving content). أوقفه من إعدادات المجموعة ثم استكمل.";
  if (NO_ACCESS_RE.test(desc)) return `لا يستطيع البوت الوصول لرسالة المصدر (${desc}). تأكد أنه عضو في مجموعة المصدر.`;
  return `Telegram: ${desc}`;
}

type ImportJob = {
  id: string; subject_id: string; created_by: string; source_chat_id: number; from_message_id: number; to_message_id: number;
  section: string; role: string; language: string | null; publisher: string | null; force_reimport: boolean;
  cursor_message_id: number; copied: number; skipped: number;
};
type ImportCtx = { chatId: string; thread: number; topicId: string };
type ImportIO = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  // deno-lint-ignore no-explicit-any
  tg: (method: string, body: Record<string, unknown>) => Promise<any>;
  store: {
    isCancelled(jobId: string): Promise<boolean>;
    isImported(job: ImportJob, srcMsg: number): Promise<boolean>;
    nextEpisode(topicId: string, section: string): Promise<number | null>;
    releaseEpisode(topicId: string, section: string, n: number): Promise<void>;
    recordCopied(job: ImportJob, d: { m: number; n: number; sent: number[]; destMessageId: number; link: string }): Promise<void>;
    recordSkipped(job: ImportJob, m: number, reason: string): Promise<void>;
  };
};

// يرجع: done | more (انتهت الميزانية الزمنية، يُستكمل) | paused (خطأ مؤقت: نقف عند العنصر ولا نتخطاه) | cancelled
async function runItems(job: ImportJob, ctx: ImportCtx, io: ImportIO, budgetMs: number, paceMs: number): Promise<{ state: "done" | "more" | "paused" | "cancelled"; error?: string }> {
  const t0 = io.now();
  let lastSend = 0;
  const pace = async () => { const wait = paceMs - (io.now() - lastSend); if (lastSend && wait > 0) await io.sleep(wait); };
  // إرسال مع انتظار قصير واحد عند 429 (حد المعدّل)
  // deno-lint-ignore no-explicit-any
  const send = async (method: string, body: Record<string, unknown>): Promise<any> => {
    await pace();
    let r = await io.tg(method, body);
    lastSend = io.now();
    const ra = r?.parameters?.retry_after;
    if (!r.ok && r.error_code === 429 && ra && ra <= 25) { await io.sleep((ra + 1) * 1000); r = await io.tg(method, body); lastSend = io.now(); }
    return r;
  };
  while (job.cursor_message_id <= job.to_message_id) {
    if (await io.store.isCancelled(job.id)) return { state: "cancelled" };
    if (io.now() - t0 > budgetMs) return { state: "more" };
    const m = job.cursor_message_id;
    if (!job.force_reimport && await io.store.isImported(job, m)) { await io.store.recordSkipped(job, m, "already_imported"); continue; }

    const n = await io.store.nextEpisode(ctx.topicId, job.section);
    if (!n) return { state: "paused", error: "تعذّر توليد رقم الحلقة" };
    const sent: number[] = [];
    const rollback = async () => {
      for (const id of sent) await io.tg("deleteMessage", { chat_id: ctx.chatId, message_id: id });
      await io.store.releaseEpisode(ctx.topicId, job.section, n);
    };
    const sep = await send("sendMessage", { chat_id: ctx.chatId, message_thread_id: ctx.thread, text: SEP });
    if (!sep.ok) { await rollback(); return { state: "paused", error: "Telegram: " + (sep.description || "فشل إرسال الفاصل") }; }
    sent.push(sep.result.message_id);
    const head = await send("sendMessage", { chat_id: ctx.chatId, message_thread_id: ctx.thread, text: `${job.section} | ${n}` });
    if (!head.ok) { await rollback(); return { state: "paused", error: "Telegram: " + (head.description || "فشل إرسال العنوان") }; }
    sent.push(head.result.message_id);

    const cp = await send("copyMessage", { chat_id: ctx.chatId, message_thread_id: ctx.thread, from_chat_id: String(job.source_chat_id), message_id: m });
    if (!cp.ok) {
      const desc = String(cp.description || cp.error_code || "");
      await rollback();
      if (COPY_SKIP_RE.test(desc)) { await io.store.recordSkipped(job, m, desc); continue; }  // رسالة خدمة/محذوفة: لا محتوى لنسخه
      return { state: "paused", error: friendlyCopyError(desc) };
    }
    const destMessageId: number = cp.result.message_id;
    const chatPart = ctx.chatId.replace(/^-100/, "");
    const link = `https://t.me/c/${chatPart}/${ctx.thread}/${destMessageId}`;
    try {
      await io.store.recordCopied(job, { m, n, sent, destMessageId, link });
    } catch (e) {
      await io.tg("deleteMessage", { chat_id: ctx.chatId, message_id: destMessageId });
      await rollback();
      return { state: "paused", error: "تعذّر حفظ المصدر في CodeUp: " + String((e as Error)?.message || e) };
    }
  }
  return { state: "done" };
}
// ===== نهاية النواة =====


// ---- سياق المادة: المسار + الوجهة (مجموعة السنة النشطة) ----
// deno-lint-ignore no-explicit-any
async function loadSubject(db: any, subjectId: string) {
  const { data: s } = await db.from("university_subjects").select("id, title, university_semesters(title, university_id, year_id, universities(name), university_years(year_number, title, university_programs(name)))").eq("id", subjectId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const sx = s as any;
  if (!sx) return null;
  const sem = sx.university_semesters, yr = sem?.university_years;
  const yearLabel = yr ? (yr.title || `Year ${yr.year_number}`) : "";
  const { data: dests } = sem?.year_id ? await db.from("archive_destinations").select("id, title, telegram_chat_id").eq("year_id", sem.year_id).eq("is_active", true) : { data: [] };
  return {
    id: sx.id as string, title: sx.title as string, universityId: sem?.university_id as string | null, yearId: sem?.year_id as string | null,
    path: [sem?.universities?.name, yr?.university_programs?.name, yearLabel, sem?.title, sx.title].filter(Boolean).join(" › "),
    dest: (dests && dests[0]) || null,
  };
}

// deno-lint-ignore no-explicit-any
async function canManage(db: any, uid: string, universityId: string | null) {
  const { data: sa } = await db.rpc("is_super_admin", { uid });
  if (sa) return true;
  if (!universityId) return false;
  const { data: ua } = await db.rpc("is_university_admin", { uid, univ_id: universityId });
  return !!ua;
}

// ---- فحص الرابط/الصلاحيات/الوجهة (لا ينسخ شيئًا) ----
// deno-lint-ignore no-explicit-any
async function analyze(db: any, tg: (m: string, b: unknown) => Promise<any>, body: any) {
  const blockers: string[] = [];
  const checks: { ok: boolean; label: string }[] = [];
  const subject = await loadSubject(db, body.subject_id);
  if (!subject) return { error: "المادة غير موجودة" };
  const a = parseTgLink(body.from_url);
  if (!a) return { error: "رابط الرسالة الأولى غير صالح. الشكل المدعوم: https://t.me/c/123456789/45 (أو /TOPIC/45) أو https://t.me/username/45" };
  const b = body.to_url ? parseTgLink(body.to_url) : a;
  if (!b) return { error: "رابط الرسالة الأخيرة غير صالح" };
  if (a.chat !== b.chat) return { error: "الرابطان يجب أن يكونا من نفس المجموعة" };

  const chat = await tg("getChat", { chat_id: a.chat });
  if (!chat.ok) return { error: `لا يصل البوت إلى مجموعة المصدر (${chat.description || "خطأ"}). أضف البوت للمجموعة أولًا.` };
  const c = chat.result;
  const sourceId = Number(c.id);
  const from = Math.min(a.msg, b.msg), to = Math.max(a.msg, b.msg);
  const count = to - from + 1;
  checks.push({ ok: true, label: `المصدر: ${c.title || c.username || sourceId}` });

  const me = await tg("getMe", {});
  const mem = await tg("getChatMember", { chat_id: String(sourceId), user_id: me.result?.id });
  const memberOk = mem.ok && ["member", "administrator", "creator"].includes(mem.result?.status);
  checks.push({ ok: memberOk, label: "البوت عضو في مجموعة المصدر" });
  if (!memberOk) blockers.push("البوت ليس عضوًا في مجموعة المصدر.");
  const prot = !!c.has_protected_content;
  checks.push({ ok: !prot, label: "المصدر لا يمنع حفظ المحتوى" });
  if (prot) blockers.push("مجموعة المصدر عليها «تقييد حفظ المحتوى»؛ لا يمكن للبوت نسخ رسائلها. أوقفه مؤقتًا من إعدادات المجموعة.");

  if (!subject.dest) blockers.push("لا توجد مجموعة تيليجرام نشطة لسنة هذه المادة. أضفها من إدارة University ← مجموعات Telegram.");
  let topicExists = false;
  if (subject.dest) {
    const dchat = await tg("getChat", { chat_id: String(subject.dest.telegram_chat_id) });
    const forumOk = dchat.ok && !!dchat.result?.is_forum;
    checks.push({ ok: forumOk, label: `مجموعة الأرشيف: ${subject.dest.title} (Forum)` });
    if (!forumOk) blockers.push("مجموعة الأرشيف غير جاهزة (المواضيع غير مفعّلة أو البوت لا يصل إليها). جرّب زر «اختبار» في مجموعات Telegram.");
    const { data: tp } = await db.from("archive_topics").select("id").eq("destination_id", subject.dest.id).eq("subject_id", subject.id).maybeSingle();
    topicExists = !!tp;
  }
  if (count > MAX_RANGE) blockers.push(`النطاق كبير (${count} رسالة). الحد ${MAX_RANGE} في العملية الواحدة؛ قسّمه.`);

  // عملية غير مكتملة لنفس المادة تمنع غيرها (حتى لا يختل ترتيب الموضوع)
  const { data: active } = await db.from("telegram_import_jobs").select("id, status, copied, skipped, cursor_message_id, from_message_id, to_message_id, last_error").eq("subject_id", subject.id).in("status", ["pending", "running", "paused"]).order("created_at", { ascending: false }).limit(1);
  if (active && active.length) blockers.push("توجد عملية استيراد غير مكتملة لهذه المادة. أكملها أو ألغها أولًا.");

  // المستورد سابقًا (يُعدّ مستورَدًا فقط إن بقي مصدره في CodeUp)
  const { data: prevItems } = await db.from("telegram_import_items").select("source_message_id, url").eq("source_chat_id", sourceId).eq("subject_id", subject.id).eq("status", "copied").gte("source_message_id", from).lte("source_message_id", to);
  let already = 0;
  if (prevItems && prevItems.length) {
    const urls = prevItems.map((i: { url: string | null }) => i.url).filter(Boolean);
    const { data: alive } = urls.length ? await db.from("university_materials").select("url").in("url", urls) : { data: [] };
    const aliveSet = new Set((alive || []).map((x: { url: string }) => x.url));
    already = prevItems.filter((i: { url: string | null }) => i.url && aliveSet.has(i.url)).length;
  }
  return {
    ok: blockers.length === 0, blockers, checks, already_imported: already,
    source: { id: sourceId, title: c.title || c.username || "", type: c.type, is_forum: !!c.is_forum },
    range: { from, to, count },
    destination: { path: subject.path, group: subject.dest?.title || null, topic_exists: topicExists },
    active_job: active && active.length ? active[0] : null,
    _subject: subject,
  };
}

// ---- تشغيل عملية: يحجزها، يجهّز الموضوع، ينفّذ الحلقة، ثم يحدّث الفهرس والحالة ----
// deno-lint-ignore no-explicit-any
async function runJob(db: any, BOT: string, jobId: string) {
  const { data: claimed } = await db.rpc("claim_import_job", { p_job: jobId });
  const job = (claimed && claimed[0]) as (ImportJob & { status: string }) | undefined;
  if (!job) return { state: "busy" as const };
  const tg = tgCall(BOT);
  const setJob = (patch: Record<string, unknown>) => db.from("telegram_import_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", job.id);
  const subject = await loadSubject(db, job.subject_id);
  if (!subject || !subject.dest) { await setJob({ status: "paused", locked_until: null, last_error: "لا توجد مجموعة أرشيف نشطة لسنة المادة" }); return { state: "paused" as const }; }

  let topic: { id: string; thread: number };
  try { topic = await ensureSubjectTopic(db, BOT, subject.dest, subject.id, subject.title); }
  catch (e) { await setJob({ status: "paused", locked_until: null, last_error: String((e as Error)?.message || e) }); return { state: "paused" as const }; }
  const ctx: ImportCtx = { chatId: String(subject.dest.telegram_chat_id), thread: topic.thread, topicId: topic.id };

  const io: ImportIO = {
    now: () => Date.now(), sleep, tg,
    store: {
      async isCancelled(id) { const { data } = await db.from("telegram_import_jobs").select("status").eq("id", id).maybeSingle(); return data?.status === "cancelled"; },
      async isImported(j, m) {
        const { data: items } = await db.from("telegram_import_items").select("url").eq("source_chat_id", j.source_chat_id).eq("source_message_id", m).eq("subject_id", j.subject_id).eq("status", "copied");
        const urls = (items || []).map((i: { url: string | null }) => i.url).filter(Boolean);
        if (!urls.length) return false;
        const { count } = await db.from("university_materials").select("id", { count: "exact", head: true }).in("url", urls);
        return (count || 0) > 0;
      },
      async nextEpisode(t, s) { return (await db.rpc("next_episode", { p_topic: t, p_section: s })).data ?? null; },
      async releaseEpisode(t, s, n) { await db.rpc("release_episode", { p_topic: t, p_section: s, p_n: n }); },
      async recordCopied(j, d) {
        // 1) تتبّع رسائل تيليجرام (يمكّن الحذف التلقائي وتحديث الفهرس)  2) المصدر في CodeUp  3) سجل العنصر  4) المؤشر
        const tr = await db.from("telegram_resource_files").upsert({
          url: d.link, chat_id: Number(ctx.chatId), thread_id: ctx.thread, message_id: d.destMessageId, created_by: j.created_by,
          topic_id: ctx.topicId, section: j.section, episode: d.n, episode_code: "E" + pad(d.n), aux_message_ids: d.sent,
        });
        if (tr.error) throw new Error(tr.error.message);
        const { data: mx } = await db.from("university_materials").select("order_index").eq("subject_id", j.subject_id).order("order_index", { ascending: false }).limit(1);
        const order = ((mx && mx[0]?.order_index) ?? 0) + 1;
        const mat = await db.from("university_materials").insert({
          subject_id: j.subject_id, material_type: "telegram", title: `${j.section} | ${d.n}`, url: d.link, role: j.role,
          language: j.language, publisher: j.publisher, order_index: order, created_by: j.created_by,
        });
        if (mat.error) { await db.from("telegram_resource_files").delete().eq("url", d.link); throw new Error(mat.error.message); }
        await db.from("telegram_import_items").insert({
          job_id: j.id, subject_id: j.subject_id, source_chat_id: j.source_chat_id, source_message_id: d.m, status: "copied",
          dest_chat_id: Number(ctx.chatId), dest_thread_id: ctx.thread, dest_message_id: d.destMessageId, url: d.link, episode: d.n, sort_order: order,
        });
        j.cursor_message_id = d.m + 1; j.copied += 1;
        await db.from("telegram_import_jobs").update({ cursor_message_id: j.cursor_message_id, copied: j.copied, locked_until: new Date(Date.now() + 150_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", j.id);
      },
      async recordSkipped(j, m, reason) {
        await db.from("telegram_import_items").insert({ job_id: j.id, subject_id: j.subject_id, source_chat_id: j.source_chat_id, source_message_id: m, status: "skipped", reason: reason.slice(0, 200) });
        j.cursor_message_id = m + 1; j.skipped += 1;
        await db.from("telegram_import_jobs").update({ cursor_message_id: j.cursor_message_id, skipped: j.skipped, locked_until: new Date(Date.now() + 150_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", j.id);
      },
    },
  };

  let res: { state: "done" | "more" | "paused" | "cancelled"; error?: string };
  try { res = await runItems(job, ctx, io, RUN_BUDGET_MS, PACE_MS); }
  catch (e) { res = { state: "paused", error: String((e as Error)?.message || e) }; }
  try { await rebuildIndex(db, tg, topic.id); } catch (e) { console.error("rebuildIndex:", e); }

  if (res.state === "done") {
    await setJob({ status: "done", locked_until: null, last_error: job.copied === 0 ? "لم يُنسخ أي شيء. قد لا يرى البوت هذه الرسائل (سجل المجموعة مخفي قبل انضمامه) أو أنها رسائل خدمة." : null });
  } else if (res.state === "paused") {
    await setJob({ status: "paused", locked_until: null, last_error: res.error || "خطأ غير معروف" });
  } else if (res.state === "more") {
    await setJob({ status: "pending", locked_until: null });
  } // cancelled: الحالة محفوظة مسبقًا
  return { state: res.state };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!BOT) return json({ error: "telegram not configured" }, 500);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ---- المصادقة: cron بالسر، أو مستخدم بجلسته ----
    const cron = req.headers.get("x-cron-secret");
    let uid: string | null = null;
    if (cron !== null) {
      const S = Deno.env.get("CRON_SECRET");
      if (!S || cron !== S) return json({ error: "unauthorized" }, 401);
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      const jwt = authHeader.replace("Bearer ", "");
      if (!jwt) return json({ error: "unauthorized" }, 401);
      const { data: u, error } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } }).auth.getUser(jwt);
      if (error || !u?.user) return json({ error: "invalid session" }, 401);
      uid = u.user.id;
    }

    if (action === "cron") {
      if (cron === null) return json({ error: "forbidden" }, 403);
      const { data: id } = await db.rpc("pick_import_job");
      if (!id) return json({ ok: true, idle: true });
      return json({ ok: true, ...(await runJob(db, BOT, id)) });
    }
    if (!uid) return json({ error: "forbidden" }, 403);
    const tg = tgCall(BOT);

    if (action === "analyze" || action === "start") {
      if (!body.subject_id) return json({ error: "missing subject_id" }, 400);
      const subj = await loadSubject(db, body.subject_id);
      if (!subj) return json({ error: "المادة غير موجودة" }, 404);
      if (!(await canManage(db, uid, subj.universityId))) return json({ error: "forbidden" }, 403);
      const an = await analyze(db, tg, body);
      if (an.error) return json({ error: an.error }, 400);
      // deno-lint-ignore no-explicit-any
      const { _subject, ...pub } = an as any;
      if (action === "analyze") return json(pub);
      if (!pub.ok) return json({ error: pub.blockers[0], blockers: pub.blockers }, 400);
      if (pub.already_imported > 0 && !body.force) return json({ error: "already_imported", already_imported: pub.already_imported }, 409);
      const section = String(body.section || subj.title).trim().slice(0, 60);
      const role = ["alternative", "deep_dive", "study"].includes(body.role) ? body.role : "alternative";
      const { data: job, error } = await db.from("telegram_import_jobs").insert({
        subject_id: subj.id, created_by: uid, source_chat_id: pub.source.id, source_title: pub.source.title,
        from_message_id: pub.range.from, to_message_id: pub.range.to, cursor_message_id: pub.range.from, section, role,
        language: ["ar", "en", "other"].includes(body.language) ? body.language : null, publisher: body.publisher ? String(body.publisher).slice(0, 100) : null,
        force_reimport: !!body.force,
      }).select("id").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, job_id: job.id });
    }

    if (action === "run" || action === "resume" || action === "cancel") {
      const { data: job } = await db.from("telegram_import_jobs").select("id, subject_id, status").eq("id", body.job_id).maybeSingle();
      if (!job) return json({ error: "العملية غير موجودة" }, 404);
      const subj = await loadSubject(db, job.subject_id);
      if (!subj || !(await canManage(db, uid, subj.universityId))) return json({ error: "forbidden" }, 403);
      if (action === "cancel") {
        if (["done", "cancelled"].includes(job.status)) return json({ ok: true });
        await db.from("telegram_import_jobs").update({ status: "cancelled", locked_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
        return json({ ok: true });
      }
      if (action === "resume") {
        if (job.status !== "paused") return json({ error: "العملية ليست متوقفة" }, 400);
        await db.from("telegram_import_jobs").update({ status: "pending", last_error: null, locked_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      }
      return json({ ok: true, ...(await runJob(db, BOT, job.id)) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
