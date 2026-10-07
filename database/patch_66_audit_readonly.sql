-- Patch #66 — تقرير Audit للقراءة فقط (لا يغيّر شيئًا ولا يحذف شيئًا). يُشغَّل بعد تطبيق migration 66 من محرر SQL (postgres/service role).
-- الفئات: UNTRACKED_TELEGRAM_MESSAGE | TRACKING_WITHOUT_OWNER | PENDING_CLAIM(_EXPIRED) | OWNER_WITHOUT_SOURCE | OWNER_URL_MISMATCH | MULTI_OWNER_MESSAGE | CLEANUP_STUCK | CLEANUP_PENDING | CLEANUP_ALREADY_DELETED_ON_TELEGRAM | OWNED_OK_*
select * from public.telegram_archive_audit() order by issue, ref_type, ref_id;
