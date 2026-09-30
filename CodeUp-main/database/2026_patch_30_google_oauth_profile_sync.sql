-- ============================================================
-- CodeUp — Patch #30: مزامنة بيانات الملف الشخصي مع Google OAuth
-- ============================================================
-- المشكلة: trigger الحالي handle_new_user() يقرأ الاسم من
-- raw_user_meta_data->>'full_name' فقط. هذا صحيح لتسجيل
-- Email/Password (الكود يرسل {data:{full_name:name}} صراحة)،
-- لكن مزوّدي OAuth (Google) عادة يضعون الاسم تحت المفتاح 'name'
-- وأحيانًا 'full_name' حسب الإصدار، والصورة تحت 'avatar_url' أو
-- 'picture'. النتيجة بدون هذا التصحيح: مستخدمو Google الجدد
-- يدخلون بحساب اسمه فاضي وبدون صورة رغم توفرهما من Google فعليًا.
--
-- التعديل: coalesce على كل الاحتمالات المعروفة، بدون أي تغيير على
-- سلوك Email/Password الحالي (لأن full_name المُرسَل صراحة من نموذج
-- التسجيل يبقى الأولوية الأولى دائمًا).
-- آمن للتشغيل فوق أي حالة حالية — لا يغيّر بيانات مستخدمين موجودين،
-- يؤثر فقط على الحسابات الجديدة من الآن فصاعدًا.
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    ),
    new.email,
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  );
  return new;
end;
$$;
-- drop trigger if exists on_auth_user_created on auth.users; create trigger ... — غير
-- لازم لإعادة التشغيل: التريغر يستدعي الدالة بالاسم فقط، وتعديل
-- الدالة بـ create or replace كافٍ لتفعيل السلوك الجديد فورًا.
