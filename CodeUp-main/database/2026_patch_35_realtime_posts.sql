-- ============================================================
-- CodeUp — Patch #35: تفعيل Realtime على جدول posts
-- ============================================================
-- لدعم زر "منشورات جديدة" بأسلوب X بالصفحة الرئيسية (يظهر فورًا لما
-- ينشر أي شخص بالمنصة، بدل ما يقفز المنشور تلقائيًا لأعلى القائمة).
-- notifications مفعّلة أصلًا لـ Realtime (تعمل فعليًا بالتطبيق حاليًا)،
-- على الأغلب أُضيفت مباشرة من تبويب Database → Replication بلوحة
-- Supabase (بدون SQL) — نفس نمط باقي الجداول غير الموثقة بالريبو.
-- هذا الباتش يضيف "posts" لنفس القائمة عبر SQL مباشرة، بأمان (يتحقق
-- أولًا إنها مو مضافة مسبقًا لتفادي خطأ "already member of publication").
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table posts;
  end if;
end $$;
