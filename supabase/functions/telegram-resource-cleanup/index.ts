import { createClient } from "jsr:@supabase/supabase-js@2";

// حذف رسائل تيليجرام لمصادر حُذفت من الموقع (قائمة telegram_message_cleanup التي تملؤها triggers القاعدة).
// تُستدعى: (1) فورًا من لوحة الإدارة بجلسة المستخدم، (2) من pg_cron كل 5 دقائق بـ x-cron-secret.
// لا تقبل أي معرّف رسالة من العميل: تعالج القائمة فقط، فلا يمكن استغلالها لحذف رسائل اعتباطية.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ===== مكتبة الفهرس (نسخة مطابقة في telegram-upload-resource و telegram-resource-cleanup) =====
const SEP = "────── ✦ ──────── ✦ ─────";
const pad = (n: number) => String(n).padStart(2, "0");
const escH = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KEYCAP = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const icon = (i: number) => (i <= 10 ? KEYCAP[i] : `${i}.`);

type IdxFile = { url: string; section: string | null; episode: number | null; episode_code: string | null; created_at: string; display_title?: string | null };

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
      text += `\n${icon(i)} ملفات أخرى\n${others.length > max ? "… | " : ""}${part.map((r, k) => `<a href="${r.url}">${r.display_title ? escH(String(r.display_title).slice(0, 30)) : pad(base + k + 1)}</a>`).join(" | ")}\n`;
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
    const { data: files } = await db.from("telegram_resource_files").select("url, section, episode, episode_code, created_at, display_title").eq("topic_id", topicId).order("created_at");
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const cron = req.headers.get("x-cron-secret");
    if (cron !== null) {
      const S = Deno.env.get("CRON_SECRET");
      if (!S || cron !== S) return json({ error: "unauthorized" }, 401);
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      const jwt = authHeader.replace("Bearer ", "");
      if (!jwt) return json({ error: "unauthorized" }, 401);
      const { data: u, error } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      }).auth.getUser(jwt);
      if (error || !u?.user) return json({ error: "invalid session" }, 401);
      // أدمن فقط: سوبر أدمن / أدمن كورس / أدمن جامعة / قائد سرب (الدالة لا تأخذ مدخلات، لكن التشغيل محصور بمن يحذف مصادر)
      const dbA = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const uid = u.user.id;
      const { data: sa } = await dbA.rpc("is_super_admin", { uid });
      let allowed = !!sa;
      for (const t of ["course_admins", "university_admins", "squad_leaders"]) {
        if (allowed) break;
        const { count } = await dbA.from(t).select("profile_id", { count: "exact", head: true }).eq("profile_id", uid);
        allowed = (count || 0) > 0;
      }
      if (!allowed) return json({ error: "forbidden" }, 403);
    }
    const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!BOT) return json({ error: "telegram not configured" }, 500);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // رفع جديد انتهت مهلة ربطه بمصدر (فشل حفظ المصدر بعد الرفع) => يدخل القائمة؛ لا يمسّ شيئًا بلا claim_deadline
    const sw = await db.rpc("telegram_sweep_unclaimed");
    if (sw.error) console.error("sweep_unclaimed:", sw.error.message);

    const { data: rows } = await db.from("telegram_message_cleanup")
      .select("id, chat_id, message_id, thread_id, attempts, rebuild_topic_id").is("processed_at", null).lt("attempts", 5).order("id").limit(30);
    let deleted = 0, failed = 0, skipped = 0;
    const rebuild = new Set<string>(); // مواضيع يلزم تحديث فهرسها بعد حذف ملفات منها
    for (const r of rows || []) {
      // message_id فارغ + thread_id => حذف موضوع Forum كامل (مادة حُذفت)، وإلا حذف رسالة واحدة
      const isTopic = r.message_id == null;
      if (!isTopic) {
        // حماية أخيرة: رسالة ما زال لها مالك لا تُحذف أبدًا
        const { count: stillOwned } = await db.from("telegram_resource_owners").select("owner_id", { count: "exact", head: true }).eq("chat_id", r.chat_id).eq("message_id", r.message_id);
        if (stillOwned) {
          await db.from("telegram_message_cleanup").update({ processed_at: new Date().toISOString(), last_error: "skipped: message still owned" }).eq("id", r.id);
          skipped++;
          continue;
        }
      }
      const res = await fetch(`https://api.telegram.org/bot${BOT}/${isTopic ? "deleteForumTopic" : "deleteMessage"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isTopic ? { chat_id: r.chat_id, message_thread_id: r.thread_id } : { chat_id: r.chat_id, message_id: r.message_id }),
      });
      const j = await res.json().catch(() => ({}));
      const desc = String(j.description || res.status);
      if (j.ok) {
        await db.from("telegram_message_cleanup").update({ processed_at: new Date().toISOString(), last_error: null }).eq("id", r.id);
        deleted++;
        if (r.rebuild_topic_id) rebuild.add(r.rebuild_topic_id);
      } else if (/message to delete not found|topic_id_invalid|message thread not found|topic not found/i.test(desc)) {
        // محذوفة أصلًا (يدويًا) = منتهية
        await db.from("telegram_message_cleanup").update({ processed_at: new Date().toISOString(), last_error: desc }).eq("id", r.id);
        deleted++;
        if (r.rebuild_topic_id) rebuild.add(r.rebuild_topic_id);
      } else {
        await db.from("telegram_message_cleanup").update({ attempts: r.attempts + 1, last_error: desc }).eq("id", r.id);
        failed++;
        if (r.attempts + 1 >= 5) console.error(`cleanup #${r.id} gave up after 5 attempts (needs manual review): ${desc}`);
      }
      await new Promise((x) => setTimeout(x, 200));
    }
    const tgc = (m: string, b: unknown) => fetch(`https://api.telegram.org/bot${BOT}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((x) => x.json());
    for (const t of rebuild) await rebuildIndex(db, tgc, t);
    const { count: stuck } = await db.from("telegram_message_cleanup").select("id", { count: "exact", head: true }).is("processed_at", null).gte("attempts", 5);
    return json({ ok: true, deleted, failed, skipped, stuck: stuck || 0, indexes_refreshed: rebuild.size });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
