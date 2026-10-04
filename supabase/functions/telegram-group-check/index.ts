import { createClient } from "jsr:@supabase/supabase-js@2";

// اختبار اتصال مجموعة تيليجرام (للسوبر أدمن فقط): هل البوت عضو؟ هل المجموعة Forum؟ هل لديه صلاحيات المواضيع/الحذف/التثبيت؟
// لا يرسل أي رسالة ولا يغيّر شيئًا في تيليجرام.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const { data: u, error } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser(jwt);
    if (error || !u?.user) return json({ error: "invalid session" }, 401);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sa } = await db.rpc("is_super_admin", { uid: u.user.id });
    if (!sa) return json({ error: "forbidden" }, 403);

    const { chat_id } = await req.json();
    if (!chat_id || !/^-?\d+$/.test(String(chat_id))) return json({ error: "Chat ID غير صالح (أرقام فقط، مثل -1001234567890)" }, 400);
    const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!BOT) return json({ error: "telegram not configured" }, 500);
    const tg = (m: string, b: unknown) => fetch(`https://api.telegram.org/bot${BOT}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

    const checks: { ok: boolean; label: string; hint?: string }[] = [];
    const me = await tg("getMe", {});
    const chat = await tg("getChat", { chat_id: String(chat_id) });
    if (!chat.ok) {
      return json({ ok: false, checks: [{ ok: false, label: "الوصول إلى المجموعة", hint: `${chat.description || "فشل"} — تأكد من Chat ID ومن إضافة البوت للمجموعة.` }] });
    }
    const c = chat.result;
    checks.push({ ok: true, label: `المجموعة: ${c.title || ""}` });
    checks.push({ ok: c.type === "supergroup", label: "مجموعة خارقة (Supergroup)", hint: "حوّل المجموعة إلى Supergroup." });
    checks.push({ ok: !!c.is_forum, label: "المواضيع (Forum) مفعّلة", hint: "فعّل «المواضيع» من إعدادات المجموعة." });
    const mem = await tg("getChatMember", { chat_id: String(chat_id), user_id: me.result?.id });
    const m = mem.result || {};
    const isAdmin = m.status === "administrator" || m.status === "creator";
    checks.push({ ok: isAdmin, label: "البوت مشرف", hint: "اجعل البوت مشرفًا في المجموعة." });
    if (isAdmin) {
      const owner = m.status === "creator";
      checks.push({ ok: owner || !!m.can_manage_topics, label: "صلاحية إدارة المواضيع", hint: "فعّل «Manage Topics» للبوت." });
      checks.push({ ok: owner || !!m.can_delete_messages, label: "صلاحية حذف الرسائل", hint: "فعّل «Delete Messages» للبوت." });
      checks.push({ ok: owner || !!m.can_pin_messages, label: "صلاحية تثبيت الرسائل", hint: "فعّل «Pin Messages» للبوت (للفهرس لاحقًا)." });
    }
    return json({ ok: checks.every((x) => x.ok), title: c.title || "", checks });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
