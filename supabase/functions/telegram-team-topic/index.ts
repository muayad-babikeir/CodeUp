import { createClient } from "jsr:@supabase/supabase-js@2";

// إنشاء/جلب Topic تيليجرام لـ: فريق أسبوع تقني (team_id) أو مجموعة كورس (squad_id).
// التمييز داخل تيليجرام: 🏆 فريق: ... (أخضر) مقابل 👥 مجموعة: ... (أزرق).
// Actions:
//   create / get_link : عضو أو قائد أو أدمن — Idempotent، يرجّع url + invite_url.
//   close_event       : أدمن الأسبوع التقني — يقفل Topics كل فرق فعالية (event_id).
//   (cron) process_cleanup : يحذف Topics الفرق/المجموعات المحذوفة (قائمة telegram_topic_cleanup).
// Secrets: CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_TEAMS_CHAT_ID, TELEGRAM_TEAMS_INVITE_LINK (اختياري).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(token: string, method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
}
const topicUrl = (chatId: number, threadId: number) =>
  `https://t.me/c/${String(chatId).replace(/^-100/, "")}/${threadId}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // ---------- معالجة قائمة حذف Topics (تُستدعى من pg_cron بـ x-cron-secret) ----------
    const cronHeader = req.headers.get("x-cron-secret");
    if (cronHeader !== null) {
      const CRON_SECRET = Deno.env.get("CRON_SECRET");
      if (!CRON_SECRET || cronHeader !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
      const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (!BOT) return json({ error: "telegram not configured" });
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: rows } = await admin.from("telegram_topic_cleanup")
        .select("id, chat_id, thread_id, attempts").is("processed_at", null).lt("attempts", 5)
        .order("id").limit(20);
      let deleted = 0, failed = 0;
      for (const r of rows || []) {
        try {
          await tg(BOT, "deleteForumTopic", { chat_id: r.chat_id, message_thread_id: r.thread_id });
          await admin.from("telegram_topic_cleanup").update({ processed_at: new Date().toISOString() }).eq("id", r.id);
          deleted++;
        } catch (e) {
          const msg = String((e as Error).message || e);
          // الـ Topic محذوف أصلًا (يدويًا) = اعتبره منتهيًا
          if (/TOPIC_ID_INVALID|thread not found|TOPIC_NOT_MODIFIED/i.test(msg)) {
            await admin.from("telegram_topic_cleanup").update({ processed_at: new Date().toISOString(), last_error: msg }).eq("id", r.id);
            deleted++;
          } else {
            await admin.from("telegram_topic_cleanup").update({ attempts: r.attempts + 1, last_error: msg }).eq("id", r.id);
            failed++;
          }
        }
        await new Promise((res) => setTimeout(res, 300));
      }
      return json({ ok: true, deleted, failed });
    }

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
    const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const CHAT = Deno.env.get("TELEGRAM_TEAMS_CHAT_ID");
    const INVITE = Deno.env.get("TELEGRAM_TEAMS_INVITE_LINK") || null;
    if (!BOT || !CHAT) return json({ error: "telegram not configured" });
    const chatId = Number(CHAT);

    const { team_id, squad_id, event_id, action = "create" } = await req.json();

    // ---------- إغلاق Topics فعالية كاملة (أدمن الأسبوع التقني) ----------
    if (action === "close_event") {
      const { data: adminOk } = await db.rpc("is_tech_week_admin", { uid });
      if (!adminOk) return json({ error: "forbidden" }, 403);
      if (!event_id) return json({ error: "missing event_id" }, 400);
      const { data: teams } = await db.from("tech_week_teams")
        .select("id, telegram_thread_id").eq("event_id", event_id)
        .not("telegram_thread_id", "is", null).neq("telegram_topic_status", "closed");
      let closed = 0, failed = 0;
      for (const t of teams || []) {
        try {
          await tg(BOT, "closeForumTopic", { chat_id: chatId, message_thread_id: t.telegram_thread_id });
          await db.from("tech_week_teams").update({
            telegram_topic_status: "closed", telegram_topic_closed_at: new Date().toISOString(),
          }).eq("id", t.id);
          closed++;
        } catch (_) { failed++; }
        await new Promise((r) => setTimeout(r, 400));
      }
      return json({ ok: true, closed, failed });
    }

    // ---------- تحديد النوع: فريق أو مجموعة ----------
    if (!team_id && !squad_id) return json({ error: "missing team_id or squad_id" }, 400);
    const isSquad = !!squad_id;
    const table = isSquad ? "squads" : "tech_week_teams";
    const rowId = isSquad ? squad_id : team_id;

    let row: any, ctxTitle = "", authorized = false;

    if (isSquad) {
      const { data } = await db.from("squads")
        .select("id, name, course_id, status, telegram_thread_id, telegram_topic_status, courses(name)")
        .eq("id", rowId).single();
      row = data;
      if (!row) return json({ error: "squad not found" }, 404);
      ctxTitle = row.courses?.name || "";
      const [{ data: enr }, { data: lead }, { data: courseAdmin }, { data: superAdmin }] = await Promise.all([
        db.from("enrollments").select("id").eq("squad_id", rowId).eq("profile_id", uid).limit(1),
        db.from("squad_leaders").select("id").eq("squad_id", rowId).eq("profile_id", uid).limit(1),
        db.rpc("is_course_admin", { uid, cid: row.course_id }),
        db.rpc("is_super_admin", { uid }),
      ]);
      authorized = !!(enr?.length || lead?.length || courseAdmin || superAdmin);
    } else {
      const { data } = await db.from("tech_week_teams")
        .select("id, name, event_id, telegram_thread_id, telegram_topic_status, tech_week_events(title)")
        .eq("id", rowId).single();
      row = data;
      if (!row) return json({ error: "team not found" }, 404);
      ctxTitle = row.tech_week_events?.title || "";
      const [{ data: reg }, { data: adminOk }] = await Promise.all([
        db.from("tech_week_registrations").select("id").eq("team_id", rowId).eq("profile_id", uid)
          .in("status", ["registered", "attended"]).limit(1),
        db.rpc("is_tech_week_admin", { uid }),
      ]);
      authorized = !!(reg?.length || adminOk);
    }
    if (!authorized) return json({ error: "forbidden" }, 403);

    const kind = isSquad ? "squad" : "team";
    const ready = (threadId: number) => json({
      ok: true, kind, thread_id: threadId, url: topicUrl(chatId, threadId), invite_url: INVITE,
      closed: row.telegram_topic_status === "closed",
    });
    if (row.telegram_thread_id) return ready(row.telegram_thread_id);

    // قفل ذرّي: أول طلب فقط ينشئ الـ Topic
    const { data: claimed } = await db.from(table)
      .update({ telegram_topic_status: "creating", telegram_chat_id: chatId })
      .eq("id", rowId).is("telegram_thread_id", null)
      .or("telegram_topic_status.is.null,telegram_topic_status.eq.failed")
      .select("id");
    if (!claimed?.length) return json({ ok: false, pending: true });

    try {
      const prefix = isSquad ? "👥 مجموعة" : "🏆 فريق";
      const topicName = `${prefix}: ${row.name}${ctxTitle ? " — " + ctxTitle : ""}`.slice(0, 128);
      const topic = await tg(BOT, "createForumTopic", {
        chat_id: chatId, name: topicName,
        icon_color: isSquad ? 7322096 : 9367192, // أزرق للمجموعات، أخضر للفرق
      });
      const threadId: number = topic.message_thread_id;

      await db.from(table).update({ telegram_thread_id: threadId, telegram_topic_status: "ready" }).eq("id", rowId);

      try {
        await tg(BOT, "sendMessage", {
          chat_id: chatId, message_thread_id: threadId, parse_mode: "HTML",
          text: isSquad
            ? `👥 هذي مساحة تواصل مجموعة <b>${esc(row.name)}</b>${ctxTitle ? `\nالكورس: ${esc(ctxTitle)}` : ""}\nالعضوية تُدار من منصة CodeUp.`
            : `🏆 هذي مساحة تواصل فريق <b>${esc(row.name)}</b>${ctxTitle ? `\nالفعالية: ${esc(ctxTitle)}` : ""}\nالعضوية تُدار من منصة CodeUp.`,
        });
      } catch (_) { /* فشل الترحيب لا يُبطل الـ Topic */ }

      return ready(threadId);
    } catch (e) {
      await db.from(table).update({ telegram_topic_status: "failed" }).eq("id", rowId);
      return json({ ok: false, error: String((e as Error).message || e) }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
