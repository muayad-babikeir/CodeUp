-- ============================================================
-- CodeUp — Patch #34: مزامنة بيانات الملف الشخصي مع GitHub OAuth
-- ============================================================
-- امتداد لباتش #30 (Google): مزوّد GitHub غالبًا ما يحطّ اسم المستخدم
-- تحت المفتاح 'user_name' (اسم حساب GitHub) بدل 'name'، خصوصًا لو
-- المستخدم ما ضبط "Name" بملفه الشخصي بـ GitHub أصلًا. بدون هذا
-- الاحتياط، حسابات GitHub الجديدة كثير منها بتدخل باسم فاضي.
-- يضيف فقط احتمال إضافي بنفس coalesce، بدون أي تغيير على سلوك
-- Email/Password أو Google الحاليين (full_name يبقى الأولوية دائمًا).
-- آمن للتشغيل فوق أي حالة حالية — يؤثر فقط على حسابات جديدة من الآن.
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
      new.raw_user_meta_data->>'user_name',
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
