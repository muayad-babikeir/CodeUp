import { createClient } from "jsr:@supabase/supabase-js@2";

// إنشاء/جلب Topic تيليجرام لفريق من فرق الأسبوع التقني.
// Actions:
//   create (افتراضي)  : عضو بالفريق أو أدمن — Idempotent، يرجّع الرابط.
//   get_link          : نفس create (للزر) — يرجّع url + invite_url.
//   close_event       : أدمن فقط — يقفل Topics كل فرق فعالية (event_id).
// Secrets المطلوبة: TELEGRAM_BOT_TOKEN (موجود) + TELEGRAM_TEAMS_CHAT_ID (جديد)
//                   + TELEGRAM_TEAMS_INVITE_LINK (اختياري، رابط دعوة المجتمع).
// شرط تيليجرام: المجموعة Supergroup مفعّل فيها Topics، والبوت أدمن بصلاحية Manage Topics.

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

    const { data: adminOk } = await db.rpc("is_tech_week_admin", { uid });
    const { team_id, event_id, action = "create" } = await req.json();

    // ---------- إغلاق Topics فعالية كاملة (أدمن فقط) ----------
    if (action === "close_event") {
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
        await new Promise((r) => setTimeout(r, 400)); // تجنّب حد الطلبات
      }
      return json({ ok: true, closed, failed });
    }

    // ---------- create / get_link ----------
    if (!team_id) return json({ error: "missing team_id" }, 400);
    const { data: team } = await db.from("tech_week_teams")
      .select("id, name, event_id, telegram_chat_id, telegram_thread_id, telegram_topic_status, tech_week_events(title)")
      .eq("id", team_id).single();
    if (!team) return json({ error: "team not found" }, 404);

    if (!adminOk) {
      const { data: reg } = await db.from("tech_week_registrations").select("id")
        .eq("team_id", team_id).eq("profile_id", uid).in("status", ["registered", "attended"]).maybeSingle();
      if (!reg) return json({ error: "forbidden" }, 403);
    }

    const ready = (threadId: number) => json({
      ok: true, thread_id: threadId, url: topicUrl(chatId, threadId), invite_url: INVITE,
      closed: team.telegram_topic_status === "closed",
    });
    if (team.telegram_thread_id) return ready(team.telegram_thread_id);

    // قفل ذرّي: أول طلب فقط ينشئ الـ Topic (يمنع Topics مكررة عند ضغطتين/طلبين متزامنين)
    const { data: claimed } = await db.from("tech_week_teams")
      .update({ telegram_topic_status: "creating", telegram_chat_id: chatId })
      .eq("id", team_id).is("telegram_thread_id", null)
      .or("telegram_topic_status.is.null,telegram_topic_status.eq.failed")
      .select("id");
    if (!claimed?.length) return json({ ok: false, pending: true }); // طلب آخر قيد التنفيذ

    try {
      const evTitle = (team as any).tech_week_events?.title || "";
      const topicName = `${team.name}${evTitle ? " — " + evTitle : ""}`.slice(0, 128);
      const topic = await tg(BOT, "createForumTopic", { chat_id: chatId, name: topicName });
      const threadId: number = topic.message_thread_id;

      await db.from("tech_week_teams").update({
        telegram_thread_id: threadId, telegram_topic_status: "ready",
      }).eq("id", team_id);

      // رسالة الترحيب فشلها لا يُبطل الـ Topic
      try {
        await tg(BOT, "sendMessage", {
          chat_id: chatId, message_thread_id: threadId, parse_mode: "HTML",
          text: `👋 هذي مساحة تواصل فريق <b>${esc(team.name)}</b>${evTitle ? `\nالفعالية: ${esc(evTitle)}` : ""}\nالعضوية تُدار من منصة CodeUp.`,
        });
      } catch (_) { /* ignore */ }

      return ready(threadId);
    } catch (e) {
      await db.from("tech_week_teams").update({ telegram_topic_status: "failed" }).eq("id", team_id);
      return json({ ok: false, error: String((e as Error).message || e) }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
