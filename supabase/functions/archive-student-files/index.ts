import { createClient } from "jsr:@supabase/supabase-js@2";

// تُستدعى يوميًا عبر pg_cron. مسؤوليتها الآن مختلفة عن قبل:
// 1) حذف نسخ Storage اللي اترسلت لتيليجرام بنجاح (archive_status='sent') ووصل موعد حذفها.
// 2) إعادة محاولة إرسال أي ملف فشل إرساله لتيليجرام قبل كده (archive_status='failed').
// لا تُرسل أي ملف "live" لأول مرة — هذا يصير فورًا عند الرفع عبر telegram-send-immediate.
Deno.serve(async (req: Request) => {
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const CHAT_ID = Deno.env.get("TELEGRAM_ARCHIVE_CHAT_ID");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let deleted = 0, deleteFailed = 0, retried = 0, retryFailed = 0;

  const { data: dueFiles } = await supabase
    .from("file_uploads")
    .select("id, storage_path, telegram_message_id")
    .eq("archive_status", "sent")
    .not("telegram_message_id", "is", null)
    .lte("scheduled_delete_at", new Date().toISOString())
    .limit(50);

  for (const f of dueFiles || []) {
    try {
      if (f.storage_path) {
        const { error: rmErr } = await supabase.storage.from("submissions").remove([f.storage_path]);
        if (rmErr) throw new Error(rmErr.message);
      }
      // لا يوجد ملف فعلي لصفوف الأرشفة النصية (storage_path فاضي) — نعلّمها مؤرشفة مباشرة، ما فيه شي نحذفه من Storage
      await supabase.from("file_uploads").update({ archive_status: "archived", archived_at: new Date().toISOString() }).eq("id", f.id);
      deleted++;
    } catch (e) {
      await supabase.from("file_uploads").update({ archive_error: "delete failed: " + String((e as Error)?.message || e) }).eq("id", f.id);
      deleteFailed++;
    }
  }

  if (BOT_TOKEN && CHAT_ID) {
    // نلتقط 'failed' (فشل إرسال حقيقي) + 'live' العالقة من قبل (بسبب علة CORS
    // السابقة في telegram-send-immediate اللي كانت تمنع وصول الحالة لـ 'failed'
    // أصلًا) وأقدم من ساعة (عشان ما نزاحم ملفًا لسه بالطريق عبر الإرسال الفوري).
    const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: failedFiles } = await supabase
      .from("file_uploads")
      .select("id, storage_path, file_name, mime_type, created_at, course_id, submission_id, uploader_id")
      .in("related_type", ["submission","post","comment"])
      .or(`archive_status.eq.failed,and(archive_status.eq.live,created_at.lte.${staleBefore})`)
      .limit(20);

    for (const f of failedFiles || []) {
      try {
        let studentName = "طالب", courseName = "", assignmentTitle = "", githubUrl = "", submissionContent = "";
        const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", f.uploader_id).single();
        if (profile?.full_name) studentName = profile.full_name;
        if (f.course_id) {
          const { data: course } = await supabase.from("courses").select("name").eq("id", f.course_id).single();
          if (course?.name) courseName = course.name;
        }
        if (f.submission_id) {
          const { data: sub } = await supabase.from("submissions").select("assignment_id, github_url, content, assignments(title)").eq("id", f.submission_id).single();
          // deno-lint-ignore no-explicit-any
          const subAny = sub as any;
          if (subAny?.assignments?.title) assignmentTitle = subAny.assignments.title;
          if (subAny?.github_url) githubUrl = subAny.github_url;
          if (subAny?.content) submissionContent = subAny.content;
        }

        const header = `📚 CodeUp Archive\n\nالطالب: ${studentName}\nالكورس: ${courseName}\nالواجب: ${assignmentTitle}`;
        const footer = `\nتاريخ الرفع: ${new Date(f.created_at).toLocaleDateString("ar-EG")}${githubUrl ? `\nGitHub: ${githubUrl}` : ""}`;

        // deno-lint-ignore no-explicit-any
        let tgJson: any;
        if (!f.storage_path) {
          const textBody = submissionContent ? `\n\nالمحتوى:\n${submissionContent}` : "";
          const text = `${header}${textBody}${footer}`.slice(0, 4096);
          const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: CHAT_ID, text })
          });
          tgJson = await tgRes.json();
        } else {
          const { data: blob, error: dlErr } = await supabase.storage.from("submissions").download(f.storage_path);
          if (dlErr || !blob) throw new Error(dlErr?.message || "download failed");

          const caption = `${header}\nنوع الملف: ${f.mime_type || ""}${footer}`;
          const isImage = (f.mime_type || "").startsWith("image/");
          const method = isImage ? "sendPhoto" : "sendDocument";
          const fieldName = isImage ? "photo" : "document";

          const form = new FormData();
          form.append("chat_id", CHAT_ID);
          form.append("caption", caption);
          form.append(fieldName, blob, f.file_name || "file");

          const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: "POST", body: form });
          tgJson = await tgRes.json();
        }
        if (!tgJson.ok) throw new Error("Telegram: " + JSON.stringify(tgJson));

        await supabase.from("file_uploads").update({
          archive_status: "sent",
          telegram_sent_at: new Date().toISOString(),
          telegram_chat_id: String(CHAT_ID),
          telegram_message_id: tgJson.result.message_id,
          archive_error: null
        }).eq("id", f.id);
        retried++;
      } catch (e) {
        await supabase.from("file_uploads").update({ archive_error: String((e as Error)?.message || e) }).eq("id", f.id);
        retryFailed++;
      }
    }
  }

  return new Response(JSON.stringify({ deleted, deleteFailed, retried, retryFailed }), {
    headers: { "Content-Type": "application/json" }
  });
});
