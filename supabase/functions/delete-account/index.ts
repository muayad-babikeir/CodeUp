import { createClient } from "jsr:@supabase/supabase-js@2";

// يُستدعى بجلسة المستخدم نفسه (JWT عادي، مش سري). خطوتين:
// 1) تنظيف بيانات الطالب (بجلسته هو، يحترم RLS/auth.uid() تلقائيًا).
// 2) حذف حساب Auth فعليًا وإنهاء كل الجلسات (يحتاج Service Role، ما ينفع من المتصفح).
Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: "invalid session" }), { status: 401 });
    const userId = userData.user.id;

    const { error: cleanupErr } = await userClient.rpc("delete_own_account");
    if (cleanupErr) return new Response(JSON.stringify({ error: cleanupErr.message }), { status: 400 });

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (authDeleteErr) return new Response(JSON.stringify({ error: "profile deleted but auth cleanup failed: " + authDeleteErr.message }), { status: 500 });

    return new Response(JSON.stringify({ ok: true }));
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500 });
  }
});
