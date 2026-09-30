-- ============================================================
-- CodeUp — Patch #42: بطاقات Anki كرابط مباشر (مثل pdf_url تمامًا)
-- ============================================================
-- الخلفية: بطاقات Anki كانت تُرفع كملفات .apkg إلى Supabase Storage
-- عبر جدول file_uploads (related_type = 'anki_ar' / 'anki_en'، مع
-- related_id = lessons.id من نوع uuid). هذا كان يسبب خطأ:
--   "invalid input syntax for type uuid: anki"
-- وتمت إزالة منطق الرفع هذا بالكامل من admin/js/content.js.
--
-- القرار: نفس آلية lessons.pdf_url بالضبط — عمودان نصّيان بسيطان على
-- lessons لتخزين رابط جاهز (تيليجرام أو أي رابط مباشر آخر)، بدون أي
-- جدول جديد وبدون أي علاقة بـ file_uploads أو Supabase Storage.
-- آمن للتشغيل أكثر من مرة (IF NOT EXISTS في كل مكان).
-- ============================================================

alter table public.lessons
  add column if not exists anki_ar_url text;

alter table public.lessons
  add column if not exists anki_en_url text;

comment on column public.lessons.anki_ar_url is
  'رابط مباشر (اختياري) لبطاقات Anki بالنسخة العربية لهذا الدرس — نفس فكرة pdf_url تمامًا، وليس ملفًا مرفوعًا لـ Storage. تمت إضافته عبر patch_42.';

comment on column public.lessons.anki_en_url is
  'رابط مباشر (اختياري) لبطاقات Anki بالنسخة الإنجليزية لهذا الدرس — نفس فكرة pdf_url تمامًا، وليس ملفًا مرفوعًا لـ Storage. تمت إضافته عبر patch_42.';

-- ملاحظة: لا يوجد هنا أي تعديل على جدول file_uploads أو bucket
-- "course-assets" أو سياساته — لم تعد بطاقات Anki تستخدمها إطلاقًا.
-- أي ملفات .apkg قديمة مرفوعة سابقًا تبقى في Storage كما هي (لم تُحذف
-- تلقائيًا هنا)؛ يمكن حذفها يدويًا من لوحة Supabase إن رغبتم بذلك.
