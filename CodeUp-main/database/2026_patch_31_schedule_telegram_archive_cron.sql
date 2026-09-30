-- ============================================================
-- CodeUp — Patch #31: جدولة المهمة اليومية لأرشفة تيليجرام (pg_cron)
-- ============================================================
-- التشخيص (فحص كل ملفات SQL بالريبو): دالة
-- supabase/functions/archive-student-files تحمل تعليقًا يقول
-- "تُستدعى يوميًا عبر pg_cron"، لكن لا يوجد أي استدعاء
-- cron.schedule(...) في أي ملف — يعني هذي الدالة على الأغلب لم
-- تُستدعَ تلقائيًا ولا مرة منذ إنشائها. وبالتزامن مع علة CORS في
-- telegram-send-immediate (المُصلَحة بهذا التحديث)، النتيجة العملية
-- المرجّحة: لا يوجد أي ملف تسليم/منشور/تعليق أُرسل فعليًا لتيليجرام
-- حتى الآن، وكل الملفات عالقة على archive_status='live' الافتراضية.
--
-- ⚠️ قبل تشغيل هذا الملف:
-- 1) روح Supabase Dashboard → Edge Functions → archive-student-files
--    → Settings/Secrets → أضف Secret باسم CRON_SECRET بقيمة عشوائية
--    طويلة من اختيارك (مثال: افتح أي مولّد كلمات مرور وخذ نص عشوائي
--    32 حرف على الأقل).
-- 2) استبدل النص REPLACE_WITH_YOUR_CRON_SECRET أدناه بنفس القيمة
--    بالضبط قبل تشغيل هذا الملف بـ SQL Editor.
-- بدون هذا، الدالة تفضل بلا حماية (أي شخص يعرف الرابط يقدر يشغّلها).
--
-- آمن للتشغيل فوق أي حالة حالية — cron.schedule بالاسم نفسه يستبدل
-- الجدولة القديمة لو كانت موجودة (via cron.unschedule أولًا).
-- ============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('codeup-archive-student-files-daily')
where exists (select 1 from cron.job where jobname = 'codeup-archive-student-files-daily');

select cron.schedule(
  'codeup-archive-student-files-daily',
  '0 2 * * *', -- كل يوم الساعة 2:00 صباحًا (UTC)
  $$
  select net.http_post(
    url := 'https://hodjfdhapxnygrnzoggr.supabase.co/functions/v1/archive-student-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'REPLACE_WITH_YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- ============================================================
-- استعلام تحقق: يعرض الجدولة الحالية للتأكد إنها اتسجلت صح
-- select jobname, schedule, active from cron.job where jobname = 'codeup-archive-student-files-daily';
--
-- استعلام تحقق بعد أول تشغيل فعلي (خلال يوم): يعرض آخر نتائج الاستدعاء
-- select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'codeup-archive-student-files-daily')
--   order by start_time desc limit 5;
-- ============================================================
