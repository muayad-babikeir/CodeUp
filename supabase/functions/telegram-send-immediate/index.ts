import { createClient } from "jsr:@supabase/supabase-js@2";

// تُستدعى من المتصفح فورًا بعد نجاح رفع ملف تسليم — بجلسة المستخدم نفسه (JWT عادي، مو سري).
// الهدف: إرسال نسخة لتيليجرام فورًا، بدون أي حذف من Supabase Storage هنا إطلاقًا.
Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const { file_id } = await req.json();
    if (!file_id) return new Response(JSON.stringify({ error: "missing file_id" }), { status: 400 });

    const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(jwt);
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: "invalid session" }), { status: 401 });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: f, error: fErr } = await supabase
      .from("file_uploads")
      .select("id, storage_path, file_name, mime_type, created_at, course_id, submission_id, related_type, uploader_id, archive_status, telegram_message_id")
      .eq("id", file_id).single();
    if (fErr || !f) return new Response(JSON.stringify({ error: "file not found" }), { status: 404 });

    // فقط صاحب الملف نفسه يقدر يطلب إرساله (منع استغلال الدالة لملفات غيره)
    if (f.uploader_id !== userData.user.id) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    if (f.related_type !== "submission") return new Response(JSON.stringify({ error: "not a submission file" }), { status: 400 });

    // Idempotent: لو اترسل قبل كده (أو قيد الإرسال)، ما نكرر
    if (f.telegram_message_id || f.archive_status === "sending" || f.archive_status === "sent" || f.archive_status === "archived") {
      return new Response(JSON.stringify({ ok: true, message: "already sent" }));
    }

    const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const CHAT_ID = Deno.env.get("TELEGRAM_ARCHIVE_CHAT_ID");
    if (!BOT_TOKEN || !CHAT_ID) return new Response(JSON.stringify({ error: "telegram not configured" }), { status: 200 });

    await supabase.from("file_uploads").update({ archive_status: "sending" }).eq("id", f.id).eq("archive_status", "live");

    try {
      const { data: blob, error: dlErr } = await supabase.storage.from("submissions").download(f.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message || "download failed");

      let studentName = "طالب", courseName = "", assignmentTitle = "";
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", f.uploader_id).single();
      if (profile?.full_name) studentName = profile.full_name;
      if (f.course_id) {
        const { data: course } = await supabase.from("courses").select("name").eq("id", f.course_id).single();
        if (course?.name) courseName = course.name;
      }
      if (f.submission_id) {
        const { data: sub } = await supabase.from("submissions").select("assignment_id, assignments(title)").eq("id", f.submission_id).single();
        // deno-lint-ignore no-explicit-any
        const subAny = sub as any;
        if (subAny?.assignments?.title) assignmentTitle = subAny.assignments.title;
      }

      const caption = `📚 CodeUp Archive\n\nالطالب: ${studentName}\nالكورس: ${courseName}\nالواجب: ${assignmentTitle}\nنوع الملف: ${f.mime_type || ""}\nتاريخ الرفع: ${new Date(f.created_at).toLocaleDateString("ar-EG")}`;

      const isImage = (f.mime_type || "").startsWith("image/");
      const method = isImage ? "sendPhoto" : "sendDocument";
      const fieldName = isImage ? "photo" : "document";

      const form = new FormData();
      form.append("chat_id", CHAT_ID);
      form.append("caption", caption);
      form.append(fieldName, blob, f.file_name || "file");

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: "POST", body: form });
      const tgJson = await tgRes.json();
      if (!tgJson.ok) throw new Error("Telegram: " + JSON.stringify(tgJson));

      await supabase.from("file_uploads").update({
        archive_status: "sent",
        telegram_sent_at: new Date().toISOString(),
        telegram_chat_id: String(CHAT_ID),
        telegram_message_id: tgJson.result.message_id,
        archive_error: null
      }).eq("id", f.id);

      return new Response(JSON.stringify({ ok: true, telegram_message_id: tgJson.result.message_id }));
    } catch (sendErr) {
      await supabase.from("file_uploads").update({
        archive_status: "failed",
        archive_error: String((sendErr as Error)?.message || sendErr)
      }).eq("id", f.id);
      // ما نفشل التسليم نفسه — الملف باقٍ بأمان بـ Supabase، ونعيد المحاولة لاحقًا عبر مهمة يومية
      return new Response(JSON.stringify({ ok: false, error: "telegram send failed, will retry later" }));
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500 });
  }
});
