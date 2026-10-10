-- Tests for patch 68 (posts privileged-field guard). NOT RUN during the audit.
-- Run ONLY on a throwaway branch/staging database with patch 68 applied, at least one
-- non-super-admin profile and (optionally) one super-admin profile. Rolled back at the end.
-- The JWT is simulated with request.jwt.claims; RLS itself is not exercised here (this
-- runs as the table owner), only the trigger. Never run against production.
begin;

create function pg_temp.as_user(p_id uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true)
$f$;

create function pg_temp.expect_error(p_sql text, p_msg text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_msg in sqlerrm) > 0 then return; end if;
    raise exception 'wrong error: expected "%", got "%" for: %', p_msg, sqlerrm, p_sql;
  end;
  raise exception 'expected error "%" but the statement succeeded: %', p_msg, p_sql;
end $f$;

do $$
declare
  u uuid; a uuid; pid uuid;
begin
  select id into u from public.profiles where coalesce(is_super_admin, false) = false limit 1;
  select id into a from public.profiles where is_super_admin limit 1;
  if u is null then raise exception 'SKIP: need a non-super-admin profile'; end if;

  perform pg_temp.as_user(u);

  -- ordinary post works
  insert into posts(profile_id, content, post_type) values (u, 'plain', 'general') returning id into pid;
  update posts set content = 'edited' where id = pid;
  update posts set status = 'deleted', deleted_at = now() where id = pid;

  -- privileged inserts refused
  perform pg_temp.expect_error(format($q$insert into posts(profile_id, content, post_type, is_pinned) values (%L,'x','general',true)$q$, u), 'posts_pin_forbidden');
  perform pg_temp.expect_error(format($q$insert into posts(profile_id, content, post_type) values (%L,'x','admin')$q$, u), 'posts_type_forbidden');
  perform pg_temp.expect_error(format($q$insert into posts(profile_id, content, post_type) values (%L,'x','announcement')$q$, u), 'posts_type_forbidden');

  -- privileged updates refused
  insert into posts(profile_id, content, post_type) values (u, 'mine', 'question') returning id into pid;
  perform pg_temp.expect_error(format($q$update posts set is_pinned = true where id = %L$q$, pid), 'posts_pin_forbidden');
  perform pg_temp.expect_error(format($q$update posts set pinned_until = now() + interval '1 day' where id = %L$q$, pid), 'posts_pin_forbidden');
  perform pg_temp.expect_error(format($q$update posts set post_type = 'admin' where id = %L$q$, pid), 'posts_type_forbidden');
  update posts set post_type = 'educational' where id = pid;  -- allowed type change

  -- moderation lock: owners cannot hide, and cannot republish a post a super admin hid
  perform pg_temp.expect_error(format($q$update posts set status = 'hidden' where id = %L$q$, pid), 'posts_status_forbidden');
  perform pg_temp.expect_error(format($q$insert into posts(profile_id, content, post_type, status) values (%L,'x','general','hidden')$q$, u), 'posts_status_forbidden');
  if a is not null then
    perform pg_temp.as_user(a);
    update posts set status = 'hidden' where id = pid;           -- super admin may hide
    perform pg_temp.as_user(u);
    perform pg_temp.expect_error(format($q$update posts set status = 'published' where id = %L$q$, pid), 'posts_hidden_locked');
    update posts set content = 'edit while hidden' where id = pid;  -- content edits stay possible
    perform pg_temp.as_user(a);
    update posts set status = 'published' where id = pid;        -- super admin may restore
    perform pg_temp.as_user(u);
  end if;

  -- super admin is not restricted (the path pin_post() uses)
  if a is not null then
    perform pg_temp.as_user(a);
    insert into posts(profile_id, content, post_type, is_pinned) values (a, 'official', 'admin', true);
  end if;

  -- no JWT (service role / SQL editor / cron) is not restricted
  perform set_config('request.jwt.claims', '', true);
  insert into posts(profile_id, content, post_type, is_pinned) values (u, 'system', 'announcement', true);

  raise notice 'patch 68: all scenarios passed (admin scenario skipped if no super admin exists)';
end $$;

rollback;
