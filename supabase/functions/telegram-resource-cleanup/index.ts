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
    }
    const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!BOT) return json({ error: "telegram not configured" }, 500);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: rows } = await db.from("telegram_message_cleanup")
      .select("id, chat_id, message_id, attempts").is("processed_at", null).lt("attempts", 5).order("id").limit(30);
    let deleted = 0, failed = 0;
    for (const r of rows || []) {
      const res = await fetch(`https://api.telegram.org/bot${BOT}/deleteMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: r.chat_id, message_id: r.message_id }),
      });
      const j = await res.json().catch(() => ({}));
      const desc = String(j.description || res.status);
      if (j.ok) {
        await db.from("telegram_message_cleanup").update({ processed_at: new Date().toISOString(), last_error: null }).eq("id", r.id);
        deleted++;
      } else if (/message to delete not found/i.test(desc)) {
        // محذوفة أصلًا (يدويًا) = منتهية
        await db.from("telegram_message_cleanup").update({ processed_at: new Date().toISOString(), last_error: desc }).eq("id", r.id);
        deleted++;
      } else {
        await db.from("telegram_message_cleanup").update({ attempts: r.attempts + 1, last_error: desc }).eq("id", r.id);
        failed++;
      }
      await new Promise((x) => setTimeout(x, 200));
    }
    return json({ ok: true, deleted, failed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
