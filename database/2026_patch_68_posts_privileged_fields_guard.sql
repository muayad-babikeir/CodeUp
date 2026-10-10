-- ============================================================
-- Patch 68 — منع المستخدمين العاديين من تثبيت المنشورات أو وسمها كإدارية
-- STATUS: NOT APPLIED to any database. Review, then apply to a branch first.
-- Added by the 2026-10-10 audit. See docs/SECURITY.md and docs/ROLLOUT-PLAN.md.
--
-- Confirmed by reading the live definitions (read-only, nothing was exploited):
--   * RLS "posts: صاحبه ينشئه" / "posts: صاحبه أو سوبر أدمن يعدّل" only check ownership.
--   * authenticated has column UPDATE on is_pinned, pinned_until, post_type, status.
--   * get_ranked_posts() puts an active pinned post first for everyone (effective date
--     now() + 10 years) and boosts post_type 'admin'/'announcement' by 20-24 hours.
--   * pin_post() is super-admin only, and the compose UI offers privileged types only
--     when profiles.is_super_admin is true, but the database does not enforce either.
--   => any signed-in user could pin their own post indefinitely and label it as an
--      admin announcement by calling the REST API directly.
-- Live data: posts has 0 rows, so existing content is unaffected.
--
-- Rule enforced (only for signed-in non-super-admins; service role / SQL editor / cron
-- have auth.uid() NULL and are not restricted):
--   INSERT: is_pinned must be false, pinned_until NULL, post_type in
--           (general, question, educational).
--   UPDATE: is_pinned and pinned_until cannot change; post_type cannot change to a
--           privileged type. Content edits and soft delete (status = 'deleted') work.
-- pin_post()/unpin_post() keep working: they run in the admin's own session, so
-- is_super_admin(auth.uid()) is true inside the trigger.
--
-- Moderation lock (added after the 2026-10-10 re-audit; no code or SQL function in the
-- project sets status = 'hidden' today, it is only an allowed value, so a super admin
-- can hide a post only by a direct UPDATE):
--   * non-admins cannot set status = 'hidden' (INSERT or UPDATE);
--   * a post whose status is 'hidden' cannot be changed back by a non-admin
--     (owners could otherwise republish a post a super admin hid).
--   Owners can still edit content and soft-delete their own visible posts.
--
-- Errors raised (SQLSTATE 42501): posts_pin_forbidden, posts_type_forbidden,
--   posts_status_forbidden, posts_hidden_locked.
-- Rollback: drop trigger trg_posts_guard_privileged on posts;
--           drop function posts_guard_privileged_fields();
-- ============================================================

begin;

create or replace function public.posts_guard_privileged_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_super_admin(auth.uid()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_pinned, false) or new.pinned_until is not null then
      raise exception 'posts_pin_forbidden' using errcode = '42501';
    end if;
    if new.post_type not in ('general', 'question', 'educational') then
      raise exception 'posts_type_forbidden' using errcode = '42501';
    end if;
    if new.status = 'hidden' then
      raise exception 'posts_status_forbidden' using errcode = '42501';
    end if;
  else
    if old.status = 'hidden' and new.status is distinct from old.status then
      raise exception 'posts_hidden_locked' using errcode = '42501';
    end if;
    if new.status = 'hidden' and old.status is distinct from 'hidden' then
      raise exception 'posts_status_forbidden' using errcode = '42501';
    end if;
    if new.is_pinned is distinct from old.is_pinned
       or new.pinned_until is distinct from old.pinned_until then
      raise exception 'posts_pin_forbidden' using errcode = '42501';
    end if;
    if new.post_type is distinct from old.post_type
       and new.post_type not in ('general', 'question', 'educational') then
      raise exception 'posts_type_forbidden' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

-- Same convention as live patch 59: trigger functions are not executable by API roles.
revoke all on function public.posts_guard_privileged_fields() from public, anon, authenticated;

drop trigger if exists trg_posts_guard_privileged on public.posts;
create trigger trg_posts_guard_privileged
  before insert or update on public.posts
  for each row execute function public.posts_guard_privileged_fields();

commit;
