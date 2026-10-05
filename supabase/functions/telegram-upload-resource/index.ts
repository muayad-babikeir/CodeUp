import { createClient } from "jsr:@supabase/supabase-js@2";

// رفع ملف مصدر تعلّم (درس أو مادة University) إلى تيليجرام ثم حذفه فورًا من Storage.
// التدفق: المتصفح يرفع الملف مؤقتًا إلى bucket "submissions" تحت <uid>/resource-uploads/،
// ثم يستدعي هذي الدالة (action: send) فتنقله لمجموعة الأرشفة (موضوع MATERIALS) بوسوم مرتبة،
// وتحذفه من Storage، وترجع رابط الرسالة ليُحفظ كرابط المصدر العادي.
// action: discard => حذف ملف مؤقت لم يُرسل (إلغاء المستخدم).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// وسم تيليجرام: حروف/أرقام/شرطة سفلية فقط (العربية مدعومة)
const tag = (s: string) => {
  const t = String(s ?? "").trim().replace(/[\s\-–—.]+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return t ? "#" + t.slice(0, 40) : "";
};
const ROLE_TAG: Record<string, string> = { recommended: "#مصدر_أساسي", alternative: "#مصدر_بديل", deep_dive: "#تعمّق", study: "#للمذاكرة" };
const ROLE_LABEL: Record<string, string> = { recommended: "المصدر الأساسي", alternative: "مصدر بديل", deep_dive: "تعمّق", study: "للمذاكرة" };
const MAX_BYTES = 50 * 1024 * 1024; // حد البوت لإرسال المستندات

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

// نوع الإرسال: فيديو → Video، صورة → Photo، وغيرها (PDF/APK/...) → Document. وعند رفض تيليجرام للفيديو/الصورة نرجع لـ Document.
function mediaKind(name: string, mime: string): "video" | "photo" | "document" {
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  if (/^video\//.test(mime) || ["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (/^image\/(jpe?g|png|webp)$/.test(mime) || ["jpg", "jpeg", "png", "webp"].includes(ext)) return "photo";
  return "document";
}
async function sendMedia(BOT: string, chatId: string, threadId: number | null, kind: string, blob: Blob, fileName: string, caption: string) {
  const attempt = async (k: string) => {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (threadId) form.append("message_thread_id", String(threadId));
    if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
    if (k === "video") form.append("supports_streaming", "true");
    form.append(k, blob, fileName);
    const method = k === "video" ? "sendVideo" : k === "photo" ? "sendPhoto" : "sendDocument";
    return (await fetch(`https://api.telegram.org/bot${BOT}/${method}`, { method: "POST", body: form })).json();
  };
  let j = await attempt(kind);
  if (!j.ok && kind !== "document") j = await attempt("document");
  return j;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const { data: u, error: uErr } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser(jwt);
    if (uErr || !u?.user) return json({ error: "invalid session" }, 401);
    const uid = u.user.id;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { action = "send", storage_path } = body;
    // الملف المؤقت يجب أن يكون داخل مجلد المستخدم نفسه (منع حذف/إرسال ملفات غيره)
    if (!storage_path || !String(storage_path).startsWith(`${uid}/resource-uploads/`) || String(storage_path).includes("..")) {
      return json({ error: "invalid storage_path" }, 400);
    }

    if (action === "discard") {
      await db.storage.from("submissions").remove([storage_path]);
      return json({ ok: true });
    }

    const { kind, ref_id, role = "alternative", title = "", publisher = "", language = "", file_name = "file", mime_type = "", section: sectionIn = "" } = body;
    if (!["lesson", "subject"].includes(kind) || !ref_id) return json({ error: "missing kind/ref_id" }, 400);

    // ---------- سياق + صلاحية ----------
    let universityId: string | null = null;
    let yearId: string | null = null;
    let subjectTitle = "";
    const crumbs: string[] = [];   // للوسوم
    const lines: string[] = [];    // لسطور الوصف
    if (kind === "lesson") {
      const { data: l } = await db.from("lessons").select("title, units(title, course_id, courses(name))").eq("id", ref_id).single();
      // deno-lint-ignore no-explicit-any
      const lx = l as any;
      if (!lx) return json({ error: "lesson not found" }, 404);
      const courseId = lx.units?.course_id;
      const [{ data: sa }, { data: ca }, { data: ld }] = await Promise.all([
        db.rpc("is_super_admin", { uid }),
        db.rpc("is_course_admin", { uid, cid: courseId }),
        db.rpc("leader_has_permission", { uid, cid: courseId, perm: "can_add_content" }),
      ]);
      if (!(sa || ca || ld)) return json({ error: "forbidden" }, 403);
      crumbs.push(lx.units?.courses?.name, lx.units?.title, lx.title);
      lines.push(`الكورس: ${lx.units?.courses?.name || ""}`, `الوحدة: ${lx.units?.title || ""}`, `الدرس: ${lx.title || ""}`);
    } else {
      const { data: s } = await db.from("university_subjects").select("title, university_semesters(title, university_id, year_id, universities(name), university_years(year_number, title, university_programs(name)))").eq("id", ref_id).single();
      // deno-lint-ignore no-explicit-any
      const sx = s as any;
      if (!sx) return json({ error: "subject not found" }, 404);
      const sem = sx.university_semesters;
      universityId = sem?.university_id ?? null;
      yearId = sem?.year_id ?? null;
      subjectTitle = sx.title || "";
      const [{ data: sa }, { data: ua }] = await Promise.all([
        db.rpc("is_super_admin", { uid }),
        universityId ? db.rpc("is_university_admin", { uid, univ_id: universityId }) : Promise.resolve({ data: false }),
      ]);
      if (!(sa || ua)) return json({ error: "forbidden" }, 403);
      const yr = sem?.university_years;
      const progName = yr?.university_programs?.name;
      const yearLabel = yr ? (yr.title || `Year ${yr.year_number}`) : "";
      crumbs.push(sem?.universities?.name, progName, yearLabel, sem?.title, sx.title);
      lines.push(`الجامعة: ${sem?.universities?.name || ""}`, `البرنامج: ${progName || ""}`, `السنة: ${yearLabel}`, `الفصل: ${sem?.title || ""}`, `المادة: ${sx.title || ""}`);
    }

    const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!BOT) return json({ error: "telegram not configured" }, 500);
    const { data: dests } = await db.from("archive_destinations").select("id, telegram_chat_id, university_id, year_id").eq("is_active", true);
    // الأولوية: مجموعة سنة المادة ← مجموعة الجامعة ← المجموعة العامة (كلها بيانات في القاعدة تُدار من لوحة التحكم)
    const yearDest = kind === "subject" && yearId ? (dests || []).find((d) => d.year_id === yearId) : null;
    const dest = yearDest
      || (dests || []).find((d) => universityId && d.university_id === universityId && !d.year_id)
      || (dests || []).find((d) => d.university_id === null && !d.year_id);
    if (!dest) return json({ error: "no active archive destination" }, 500);

    // استيراد غير مكتمل لنفس المادة (يعمل/متوقف) يمنع الرفع اليدوي حتى لا يتداخل مع ترتيب الموضوع
    if (yearDest) {
      const { count: openJobs } = await db.from("telegram_import_jobs").select("id", { count: "exact", head: true }).eq("subject_id", ref_id).in("status", ["pending", "running", "paused"]);
      if (openJobs) return json({ error: "يوجد استيراد من تيليجرام غير مكتمل لهذه المادة. أكمله أو ألغه أولًا حتى لا يختل ترتيب الموضوع." }, 409);
    }

    let threadId: number | null = null;
    let topicRow: { id: string; thread: number } | null = null;
    if (yearDest) {
      // موضوع تلقائي لكل مادة داخل مجموعة سنتها (يُنشأ عند أول رفع ثم يُعاد استخدامه) مع فهرس مثبّت
      topicRow = await ensureSubjectTopic(db, BOT, dest, ref_id, subjectTitle);
      threadId = topicRow.thread;
    } else {
      // بلا مجموعة سنة: مواد الجامعة => موضوع UNIVERSITY، مصادر الدروس => MATERIALS (احتياطي إلى MATERIALS)
      const wantedKey = kind === "subject" ? "university" : "materials";
      const { data: topics } = await db.from("archive_topics").select("topic_key, telegram_thread_id").eq("destination_id", dest.id).in("topic_key", [wantedKey, "materials"]);
      const topic = (topics || []).find((t) => t.topic_key === wantedKey) || (topics || []).find((t) => t.topic_key === "materials");
      threadId = topic?.telegram_thread_id ?? null;
    }

    const { data: blob, error: dlErr } = await db.storage.from("submissions").download(storage_path);
    if (dlErr || !blob) return json({ error: "temp file not found: " + (dlErr?.message || "") }, 404);
    if (blob.size > MAX_BYTES) return json({ error: "file larger than 50MB" }, 413);

    const tags = [ROLE_TAG[role] || "#مصدر", ...crumbs.map(tag)].filter(Boolean);
    const ext = (String(file_name).split(".").pop() || "").toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(ext)) tags.push("#" + ext.toUpperCase());
    const caption = [
      `<b>${esc(title || file_name)}</b>`,
      `القسم: ${esc(ROLE_LABEL[role] || role)}`,
      ...lines.filter((x) => !x.endsWith(": ")).map(esc),
      publisher ? `الناشر: ${esc(publisher)}` : "",
      language ? `اللغة: ${esc(language)}` : "",
      "",
      [...new Set(tags)].join(" "),
    ].join("\n").slice(0, 1024);

    const chatId = String(dest.telegram_chat_id);
    const chatPart = chatId.replace(/^-100/, "");

    // ===== مواد الجامعة داخل مجموعة سنة: ثلاث رسائل لكل ملف (فاصل ← "القسم | رقم" ← الملف) + تحديث الفهرس المثبّت =====
    if (topicRow) {
      const tg = tgCall(BOT);
      const section = String(sectionIn || title || file_name).trim().slice(0, 60);
      const n: number | null = (await db.rpc("next_episode", { p_topic: topicRow.id, p_section: section })).data;
      if (!n) return json({ error: "تعذّر توليد رقم الحلقة" }, 500);
      const sent: number[] = []; // رسائل الفاصل والعنوان، تُحذف عند فشل الملف حتى لا تبقى يتيمة
      const rollback = async () => {
        for (const id of sent) await tg("deleteMessage", { chat_id: chatId, message_id: id });
        await db.rpc("release_episode", { p_topic: topicRow!.id, p_section: section, p_n: n });
      };
      const sep = await tg("sendMessage", { chat_id: chatId, message_thread_id: threadId, text: SEP });
      if (!sep.ok) { await rollback(); return json({ error: "Telegram: " + (sep.description || "فشل إرسال الفاصل") }, 502); }
      sent.push(sep.result.message_id);
      const head = await tg("sendMessage", { chat_id: chatId, message_thread_id: threadId, text: `${section} | ${n}` });
      if (!head.ok) { await rollback(); return json({ error: "Telegram: " + (head.description || "فشل إرسال العنوان") }, 502); }
      sent.push(head.result.message_id);
      // تعليق الملف: وسوم بحث فقط (بلا ناشر ولا بيانات إضافية)
      const tagLine = [...new Set([ROLE_TAG[role] || "", ...crumbs.slice(-3).map(tag), tag(section)].filter(Boolean))].join(" ").slice(0, 1000);
      const fileRes = await sendMedia(BOT, chatId, threadId, mediaKind(file_name, mime_type), blob, file_name, tagLine);
      if (!fileRes.ok) { await rollback(); return json({ error: "Telegram: " + (fileRes.description || "فشل إرسال الملف") }, 502); }

      await db.storage.from("submissions").remove([storage_path]);
      const messageId: number = fileRes.result.message_id;
      const link = `https://t.me/c/${chatPart}/${threadId}/${messageId}`; // رابط مباشر لرسالة الملف نفسها
      const { error: trackErr } = await db.from("telegram_resource_files").upsert({
        url: link, chat_id: Number(chatId), thread_id: threadId, message_id: messageId, created_by: uid,
        topic_id: topicRow.id, section, episode: n, episode_code: "E" + pad(n), aux_message_ids: sent,
      });
      await rebuildIndex(db, tg, topicRow.id);
      return json({ ok: true, url: link, message_id: messageId, episode: "E" + pad(n), tracked: !trackErr });
    }

    const form = new FormData();
    form.append("chat_id", String(dest.telegram_chat_id));
    if (threadId) form.append("message_thread_id", String(threadId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("document", blob, file_name);
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT}/sendDocument`, { method: "POST", body: form });
    const tg = await tgRes.json();
    if (!tg.ok) return json({ error: "Telegram: " + (tg.description || tgRes.status) }, 502); // الملف المؤقت يبقى لإعادة المحاولة

    // نجح الإرسال: احذف الملف المؤقت فورًا (تيليجرام وحده يحتفظ به)
    await db.storage.from("submissions").remove([storage_path]);

    const messageId: number = tg.result.message_id;
    const link = threadId
      ? `https://t.me/c/${chatPart}/${threadId}/${messageId}`
      : `https://t.me/c/${chatPart}/${messageId}`;
    // تسجيل الرسالة لتُحذف تلقائيًا من تيليجرام عند حذف المصدر من الموقع (لا يُحذف إلا ما رفعناه هنا)
    const { error: trackErr } = await db.from("telegram_resource_files").upsert({
      url: link, chat_id: Number(dest.telegram_chat_id), thread_id: threadId, message_id: messageId, created_by: uid,
    });
    return json({ ok: true, url: link, message_id: messageId, tracked: !trackErr });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
