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

// إنشاء (أو إيجاد) موضوع Forum للمادة داخل مجموعة السنة. أي فشل يظهر للأدمن برسالة واضحة ولا يُرسَل شيء.
// deno-lint-ignore no-explicit-any
async function ensureSubjectTopic(db: any, BOT: string, dest: any, subjectId: string, title: string): Promise<number> {
  const find = async () => (await db.from("archive_topics").select("telegram_thread_id").eq("destination_id", dest.id).eq("subject_id", subjectId).maybeSingle()).data;
  const ex = await find();
  if (ex) return ex.telegram_thread_id;
  const tg = (m: string, b: unknown) => fetch(`https://api.telegram.org/bot${BOT}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
  const j = await tg("createForumTopic", { chat_id: String(dest.telegram_chat_id), name: (title || "Subject").slice(0, 128) });
  if (!j.ok) throw new Error(`تعذّر إنشاء موضوع المادة في تيليجرام (${j.description || "خطأ"}). تأكد أن المجموعة مفعّل فيها «المواضيع» (Forum) وأن البوت مشرف بصلاحية إدارة المواضيع.`);
  const thread = j.result.message_thread_id as number;
  const { error } = await db.from("archive_topics").insert({ destination_id: dest.id, topic_key: `subject:${subjectId}`, telegram_thread_id: thread, title, subject_id: subjectId });
  if (error) {
    // سباق: رفعان متزامنان لنفس المادة — نحذف موضوعنا ونستخدم الذي سُجّل أولًا
    await tg("deleteForumTopic", { chat_id: String(dest.telegram_chat_id), message_thread_id: thread });
    const again = await find();
    if (again) return again.telegram_thread_id;
    throw new Error("تعذّر حفظ موضوع المادة: " + error.message);
  }
  return thread;
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

    const { kind, ref_id, role = "alternative", title = "", publisher = "", language = "", file_name = "file", mime_type = "" } = body;
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

    let threadId: number | null = null;
    if (yearDest) {
      // موضوع تلقائي لكل مادة داخل مجموعة سنتها (يُنشأ عند أول رفع ثم يُعاد استخدامه)
      threadId = await ensureSubjectTopic(db, BOT, dest, ref_id, subjectTitle);
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
    const chatPart = String(dest.telegram_chat_id).replace(/^-100/, "");
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
