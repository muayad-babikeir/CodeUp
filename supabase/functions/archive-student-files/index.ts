import { createClient } from "jsr:@supabase/supabase-js@2";

// هذه الدالة تُستدعى يوميًا عبر pg_cron (مو من المتصفح مباشرة).
// حماية بسيطة بمفتاح سري مشترك (CRON_SECRET) بدل التحقق بـ JWT مستخدم عادي.
Deno.serve(async (req: Request) => {
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const CHAT_ID = Deno.env.get("TELEGRAM_ARCHIVE_CHAT_ID");
  const RETENTION_DAYS = parseInt(Deno.env.get("ARCHIVE_RETENTION_DAYS") || "7");

  if (!BOT_TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({ error: "missing TELEGRAM_BOT_TOKEN or TELEGRAM_ARCHIVE_CHAT_ID" }), { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // فقط ملفات تسليمات الطلاب (bucket: submissions) — لا يلمس أي محتوى أدمن إطلاقًا
  const { data: files, error } = await supabase
    .from("file_uploads")
    .select("id, storage_path, file_name, mime_type, created_at, course_id, submission_id, related_type, uploader_id")
    .eq("archive_status", "live")
    .eq("related_type", "submission")
    .lt("created_at", cutoff)
    .limit(15);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!files || !files.length) return new Response(JSON.stringify({ archived: 0, failed: 0, message: "no files due for archiving" }));

  let archived = 0, failed = 0;

  for (const f of files) {
    try {
      await supabase.from("file_uploads").update({ archive_status: "archiving" }).eq("id", f.id);

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

      const now = new Date();
      const caption = `📚 CodeUp Archive\n\nالطالب: ${studentName}\nالكورس: ${courseName}\nالواجب: ${assignmentTitle}\nنوع الملف: ${f.mime_type || ""}\nتاريخ الرفع: ${new Date(f.created_at).toLocaleDateString("ar-EG")}\nتاريخ الأرشفة: ${now.toLocaleDateString("ar-EG")}`;

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

      const messageId = tgJson.result.message_id;

      // نحذف من Supabase Storage فقط بعد تأكيد نجاح الإرسال لتيليجرام
      const { error: rmErr } = await supabase.storage.from("submissions").remove([f.storage_path]);
      if (rmErr) throw new Error("archived but failed to delete original: " + rmErr.message);

      await supabase.from("file_uploads").update({
        archive_status: "archived",
        archived_at: now.toISOString(),
        telegram_chat_id: String(CHAT_ID),
        telegram_message_id: messageId,
        archive_error: null
      }).eq("id", f.id);

      archived++;
    } catch (e) {
      await supabase.from("file_uploads").update({
        archive_status: "failed",
        archive_error: String((e as Error)?.message || e)
      }).eq("id", f.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ archived, failed, total: files.length }), {
    headers: { "Content-Type": "application/json" }
  });
});
