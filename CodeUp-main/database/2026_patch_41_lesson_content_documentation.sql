-- 2026_patch_41_lesson_content_documentation.sql
--
-- هذا الباتش لا يضيف أي وظيفة جديدة — كل ما فيه IF NOT EXISTS / آمن للتشغيل بأي وقت.
--
-- خلفية: فحص كود الطالب (index.html) أظهر أنه يقرأ ويعرض lessons.text_content
-- و lessons.pdf_url فعليًا، لكن هذين العمودين غير موجودين بأي ملف SQL بهذا المشروع
-- (غالبًا أُضيفا يدويًا من لوحة Supabase بدون migration مسجّلة — نفس النمط الموثّق
-- سابقًا بالمشروع لجداول أخرى، راجع تعليق patch_28).
--
-- الهدف من هذا الباتش: توثيق هذين العمودين رسميًا بدون أي مخاطرة —
-- لو موجودين فعلًا بقاعدة البيانات الحية، فـ IF NOT EXISTS يخليه no-op تمامًا.
-- لو غير موجودين لأي سبب، هذا الباتش يضيفهم بنفس النوع اللي يستخدمه الكود الحالي (text، بدون قيود).
--
-- لا يوجد هنا أي جدول جديد لـ Anki: تخزين ملفات APKG يعتمد بالكامل على جدول
-- file_uploads الموجود أصلًا (نفس الآلية المستخدمة لمرفقات الواجبات) عبر قيم
-- جديدة لعمود related_type الموجود أصلًا كـ text بدون CHECK constraint:
--   related_type = 'anki_ar'  → ملف APKG بالعربية، related_id = lessons.id
--   related_type = 'anki_en'  → ملف APKG بالإنجليزية، related_id = lessons.id
-- هذا لا يحتاج أي تعديل schema إطلاقًا.

alter table public.lessons
  add column if not exists text_content text;

alter table public.lessons
  add column if not exists pdf_url text;

comment on column public.lessons.text_content is
  'محتوى نصي اختياري للدرس (شرح مكتوب) — يُعرض بصفحة الدرس للطالب. تمت إضافته للتوثيق فقط عبر patch_41؛ الكود الفعلي كان يستخدمه مسبقًا.';

comment on column public.lessons.pdf_url is
  'رابط ملف PDF اختياري مرفق بالدرس (رابط مباشر، وليس نظام ملفات متعدد). تمت إضافته للتوثيق فقط عبر patch_41؛ الكود الفعلي كان يستخدمه مسبقًا.';
