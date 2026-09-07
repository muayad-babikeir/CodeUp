import { createClient } from "jsr:@supabase/supabase-js@2";

// السبب الفعلي وراء "Failed to fetch" عند حذف الحساب: المتصفح يرسل طلب
// OPTIONS تمهيدي (CORS preflight) قبل أي طلب فيه Authorization، وكانت
// هذي الدالة ما ترد عليه ولا ترجع أي CORS headers أصلًا — فالمتصفح
// يمنع الطلب بالكامل قبل ما يوصل لمنطق الحذف الفعلي. الإصلاح: معالجة
// OPTIONS صراحة + إضافة CORS headers على كل استجابة (نجاح أو خطأ).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Supabase يمنع صراحة أي DELETE مباشر على جدول storage.objects عبر SQL
// ("Direct deletion from storage tables is not allowed. Use the Storage
// API instead.") — لذلك نظافة ملفات المستخدم انتقلت من دالة SQL إلى هنا،
// عبر Storage API الحقيقي. القوائم قد تحتوي مجلدات فرعية (مثلاً
// submissions/{userId}/{submissionId}/...)، فالحذف تكراري.
async function deleteFolderRecursive(storage: ReturnType<typeof createClient>["storage"], bucket: string, prefix: string) {
  const { data: entries } = await storage.from(bucket).list(prefix, { limit: 1000 });
  if (!entries || !entries.length) return;
  const filePaths: string[] = [];
  for (const entry of entries) {
    const fullPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      // entry.id === null يعني هذا "مجلد" افتراضي (Supabase Storage convention)، ننزل فيه
      await deleteFolderRecursive(storage, bucket, fullPath);
    } else {
      filePaths.push(fullPath);
    }
  }
  if (filePaths.length) await storage.from(bucket).remove(filePaths);
}

// يُستدعى بجلسة المستخدم نفسه (JWT عادي، مش سري). الخطوات:
// 1) حذف ملفات Storage الخاصة بالمستخدم (avatars + submissions) عبر Storage API.
// 2) حذف حساب Auth فعليًا — يُسقط تلقائيًا كل صفوف profiles/enrollments/... المرتبطة (ON DELETE CASCADE/SET NULL).
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: "invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceKey);

    // تنظيف Storage عبر service role مباشرة — أضمن من الاعتماد على RLS المستخدم لملفات قد تكون بمجلدات فرعية
    try {
      await deleteFolderRecursive(adminClient.storage, "avatars", userId);
      await deleteFolderRecursive(adminClient.storage, "submissions", userId);
    } catch (_storageErr) {
      // لا نوقف عملية حذف الحساب بسبب فشل تنظيف ملفات Storage — نكمل الحذف، أهم شي الحساب يتحذف فعليًا
    }

    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (authDeleteErr) return new Response(JSON.stringify({ error: authDeleteErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
