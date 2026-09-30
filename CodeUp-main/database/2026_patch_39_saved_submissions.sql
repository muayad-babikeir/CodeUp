-- ============================================================
-- CodeUp — Patch #39: زر "الحفظ" (Bookmark) للتسليمات
-- ============================================================
-- جدول Minimal جديد فقط — لا علاقة له بأي نظام آخر، ولا يؤثر على grade/
-- XP/status. القراءة والكتابة والحذف كلها مقصورة على صاحب السجل نفسه
-- (كل مستخدم يدير حفظياته الخاصة فقط) — لا حاجة لـ RPC هنا لأن العملية
-- بسيطة (toggle) وRLS كافية تمامًا لحمايتها.
-- ============================================================

create table if not exists saved_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (submission_id, profile_id)
);
create index if not exists idx_saved_submissions_profile on saved_submissions(profile_id);

alter table saved_submissions enable row level security;

drop policy if exists "saved_submissions: كل مستخدم يدير حفظياته فقط" on saved_submissions;
create policy "saved_submissions: كل مستخدم يدير حفظياته فقط" on saved_submissions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
