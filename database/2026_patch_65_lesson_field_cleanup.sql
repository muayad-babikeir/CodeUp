-- (طُبّق مسبقًا على القاعدة الحية عبر Supabase MCP — للأرشفة؛ إعادة التشغيل آمنة)
-- Patch #65 — حقول الدرس (Anki عربي/إنجليزي، PDF، فيديو) التي قد تحمل رابط ملف نسخه CodeUp إلى تيليجرام:
-- استبدال الرابط أو حذف الدرس يحذف رسائل تيليجرام المرتبطة (الملف + الفاصل + العنوان) ويحدّث الفهرس.
-- لا يُمَسّ إلا ما سجّله النظام في telegram_resource_files؛ الروابط العادية تُتجاهل.
create or replace function public.trg_lesson_url_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_telegram_resource_cleanup(old.anki_ar_url);
    perform public.enqueue_telegram_resource_cleanup(old.anki_en_url);
    perform public.enqueue_telegram_resource_cleanup(old.pdf_url);
    perform public.enqueue_telegram_resource_cleanup(old.video_url);
    return old;
  end if;
  if old.anki_ar_url is distinct from new.anki_ar_url then perform public.enqueue_telegram_resource_cleanup(old.anki_ar_url); end if;
  if old.anki_en_url is distinct from new.anki_en_url then perform public.enqueue_telegram_resource_cleanup(old.anki_en_url); end if;
  if old.pdf_url is distinct from new.pdf_url then perform public.enqueue_telegram_resource_cleanup(old.pdf_url); end if;
  if old.video_url is distinct from new.video_url then perform public.enqueue_telegram_resource_cleanup(old.video_url); end if;
  return new;
end $$;
revoke execute on function public.trg_lesson_url_cleanup() from public, anon, authenticated;
drop trigger if exists lessons_tg_cleanup on public.lessons;
create trigger lessons_tg_cleanup after delete or update of anki_ar_url, anki_en_url, pdf_url, video_url on public.lessons
  for each row execute function public.trg_lesson_url_cleanup();
