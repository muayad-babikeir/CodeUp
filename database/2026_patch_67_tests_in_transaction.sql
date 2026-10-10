-- Tests for patch 67 (Tech Week limits). NOT RUN during the audit: no Postgres was available.
-- Run ONLY on a throwaway branch/staging database that has patch 67 applied and at least
-- 5 rows in public.profiles. Everything happens inside one transaction that is rolled back.
-- Never run this against production. A failure raises an exception; success prints a NOTICE.
begin;

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
  p uuid[]; e_ind uuid; e_unl uuid; e_team uuid; e_appr uuid; ta uuid; tb uuid; tc uuid;
begin
  select array_agg(id) into p from (select id from public.profiles order by created_at limit 5) s;
  if coalesce(array_length(p, 1), 0) < 5 then raise exception 'SKIP: need at least 5 profiles'; end if;

  -- T1: individual capacity = 2
  insert into tech_week_events(type, title, status, registration_mode, capacity) values ('workshop','T67 individual','published','individual',2) returning id into e_ind;
  insert into tech_week_registrations(event_id, profile_id, status) values (e_ind, p[1], 'registered'), (e_ind, p[2], 'registered');
  perform pg_temp.expect_error(format($q$insert into tech_week_registrations(event_id, profile_id, status) values (%L, %L, 'registered')$q$, e_ind, p[3]), 'tech_week_capacity_full');

  -- T2: a cancelled registration frees its slot
  update tech_week_registrations set status = 'cancelled' where event_id = e_ind and profile_id = p[2];
  insert into tech_week_registrations(event_id, profile_id, status) values (e_ind, p[3], 'registered');

  -- T3: re-activating a cancelled row into a full event is refused
  perform pg_temp.expect_error(format($q$update tech_week_registrations set status = 'registered' where event_id = %L and profile_id = %L$q$, e_ind, p[2]), 'tech_week_capacity_full');

  -- T4: status change inside a counted state never fails, even if capacity was lowered below the count
  update tech_week_events set capacity = 1 where id = e_ind;
  update tech_week_registrations set status = 'attended' where event_id = e_ind and profile_id = p[1];

  -- T5: NULL capacity is unlimited
  insert into tech_week_events(type, title, status, registration_mode) values ('talk','T67 unlimited','published','individual') returning id into e_unl;
  insert into tech_week_registrations(event_id, profile_id, status) select e_unl, x, 'registered' from unnest(p) x;

  -- T6: team_max_size = 2 on insert
  insert into tech_week_events(type, title, status, registration_mode, team_min_size, team_max_size) values ('competition','T67 team','published','team',1,2) returning id into e_team;
  insert into tech_week_teams(event_id, name, leader_id, created_by, join_policy) values (e_team, 'A', p[1], p[1], 'open') returning id into ta;
  insert into tech_week_registrations(event_id, profile_id, status, team_id) values (e_team, p[1], 'registered', ta), (e_team, p[2], 'registered', ta);
  perform pg_temp.expect_error(format($q$insert into tech_week_registrations(event_id, profile_id, status, team_id) values (%L, %L, 'registered', %L)$q$, e_team, p[3], ta), 'tech_week_team_full');

  -- T7: a cancelled member cannot re-activate into a team that filled up meanwhile (UPDATE path)
  update tech_week_registrations set status = 'cancelled' where team_id = ta and profile_id = p[2];
  insert into tech_week_registrations(event_id, profile_id, status, team_id) values (e_team, p[3], 'registered', ta);
  perform pg_temp.expect_error(format($q$update tech_week_registrations set status = 'registered' where team_id = %L and profile_id = %L$q$, ta, p[2]), 'tech_week_team_full');

  -- T8: moving to another team that is full is refused
  insert into tech_week_teams(event_id, name, leader_id, created_by, join_policy) values (e_team, 'B', p[4], p[4], 'open') returning id into tb;
  insert into tech_week_registrations(event_id, profile_id, status, team_id) values (e_team, p[4], 'registered', tb), (e_team, p[5], 'registered', tb);
  perform pg_temp.expect_error(format($q$update tech_week_registrations set team_id = %L where event_id = %L and profile_id = %L$q$, tb, e_team, p[3]), 'tech_week_team_full');

  -- T9: approving a pending member (already counted) is not blocked, even when the team is at its maximum
  insert into tech_week_events(type, title, status, registration_mode, team_min_size, team_max_size) values ('competition','T67 approval','published','team',1,2) returning id into e_appr;
  insert into tech_week_teams(event_id, name, leader_id, created_by, join_policy) values (e_appr, 'C', p[1], p[1], 'approval') returning id into tc;
  insert into tech_week_registrations(event_id, profile_id, status, team_id) values (e_appr, p[1], 'registered', tc), (e_appr, p[2], 'pending', tc);
  update tech_week_registrations set status = 'registered' where team_id = tc and profile_id = p[2];

  -- T10: CHECK constraints
  perform pg_temp.expect_error($q$insert into tech_week_events(type, title, capacity) values ('talk','bad cap',0)$q$, 'tech_week_events_capacity_positive');
  perform pg_temp.expect_error($q$insert into tech_week_events(type, title, registration_mode, team_min_size, team_max_size) values ('talk','bad sizes','team',5,3)$q$, 'tech_week_events_team_sizes_valid');

  raise notice 'patch 67: all 10 scenarios passed';
end $$;

-- Concurrency (manual, two sessions; cannot be scripted in a single transaction):
--   1) create an individual event with capacity = 1 and commit.
--   2) Session A: begin; insert a registration for profile X; -- do not commit yet
--   3) Session B: begin; insert a registration for profile Y; -- must BLOCK on the event row lock
--   4) Session A: commit;  Session B must now fail with tech_week_capacity_full.
--   5) Delete the test event and registrations afterwards.

rollback;
