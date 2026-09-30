-- ============================================================
-- CodeUp — Patch #36: فهارس لدعم Cursor Pagination بالـ Feed
-- ============================================================
-- الترقيم بالمؤشر (keyset pagination) الجديد بالواجهة يعتمد على
-- استعلامات created_at < cursor بترتيب تنازلي — هذا الفهرس يخليها
-- سريعة حتى مع نمو عدد الصفوف، بدل الاعتماد على full scan.
-- CREATE INDEX عادي (بدون CONCURRENTLY) لأنه يشتغل من SQL Editor
-- بمعاملة واحدة؛ الجداول هنا غير ضخمة بما يستدعي قفل مزعج وقت الإنشاء.
-- آمن للتشغيل فوق أي حالة حالية — IF NOT EXISTS يمنع أي تكرار أو خطأ.
-- ============================================================

create index if not exists idx_posts_created_at on posts (created_at desc);
create index if not exists idx_submissions_created_at on submissions (created_at desc);
