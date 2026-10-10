-- ============================================================
-- Patch 67 — فرض حدود التسجيل في الأسبوع التقني على مستوى قاعدة البيانات
-- STATUS: NOT APPLIED to any database. Review, then apply to a branch first.
-- Added by the 2026-10-10 audit. See docs/ROLLOUT-PLAN.md.
--
-- Verified read-only on the live DB (2026-10-10) before writing this patch:
--   * No trigger or policy enforces tech_week_events.capacity (individual events).
--   * team_max_size is checked only in the INSERT policy (tech_week_team_active_count),
--     which (a) is evaluated without a lock, so concurrent joins can both pass, and
--     (b) is not applied on UPDATE: tech_week_join_team() re-activates an existing
--     row with UPDATE, and leaders approving 'pending' rows use UPDATE too.
--   * Live data: 1 event (team mode, capacity NULL, team 4..5), 0 registrations,
--     so this patch cannot affect existing registrations.
--
-- What this patch does
--   1) Sanity CHECKs on tech_week_events (capacity > 0, 1 <= team_min <= team_max).
--   2) BEFORE INSERT/UPDATE trigger on tech_week_registrations that:
--        - locks the parent event row (FOR UPDATE) so concurrent registrations for the
--          same event are serialised and cannot overshoot a limit;
--        - individual events: counts rows with team_id IS NULL and status IN
--          ('registered','attended') against capacity;
--        - team events: counts rows of that team with status <> 'cancelled'
--          (same definition as tech_week_team_active_count) against team_max_size.
--      A limit is checked only when a row ENTERS a counted state (insert, re-activation
--      from 'cancelled', or moving to another team). Status changes inside a counted
--      state (registered -> attended, pending -> registered for an already counted
--      row) never fail, so existing approval, leadership-transfer and leave flows keep
--      working.
--   3) Supporting indexes.
--
-- Deliberately NOT enforced (needs a product decision, see docs/ROLLOUT-PLAN.md):
--   * capacity on team-mode events (could mean "max teams" or be unused).
--   * team_min_size (a minimum cannot be enforced at registration time).
--
-- Errors raised (SQLSTATE P0001): tech_week_capacity_full, tech_week_team_full.
-- Rollback: drop trigger trg_tech_week_enforce_limits on tech_week_registrations;
--           drop function tech_week_enforce_limits(); drop the two constraints and indexes.
-- ============================================================

begin;

-- 1) CHECK constraints (idempotent) -------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tech_week_events_capacity_positive') then
    alter table public.tech_week_events
      add constraint tech_week_events_capacity_positive
      check (capacity is null or capacity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tech_week_events_team_sizes_valid') then
    alter table public.tech_week_events
      add constraint tech_week_events_team_sizes_valid
      check (
        (team_min_size is null or team_min_size >= 1)
        and (team_max_size is null or team_max_size >= 1)
        and (team_min_size is null or team_max_size is null or team_min_size <= team_max_size)
      );
  end if;
end $$;

-- 2) Indexes used by the trigger counts and by the team_id foreign key ----------
create index if not exists idx_tech_week_regs_team
  on public.tech_week_registrations (team_id) where team_id is not null;
create index if not exists idx_tech_week_regs_event_status
  on public.tech_week_registrations (event_id, status);

-- 3) Enforcement trigger ----------------------------------------------------------
create or replace function public.tech_week_enforce_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event            public.tech_week_events;
  v_count            int;
  v_held_capacity    boolean := false;  -- old row already counted against capacity
  v_held_team_slot   boolean := false;  -- old row already counted in this same team
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.event_id = new.event_id then
    v_held_capacity  := old.team_id is null and old.status in ('registered', 'attended');
    v_held_team_slot := old.team_id is not null and old.team_id = new.team_id and old.status <> 'cancelled';
  end if;

  -- Serialise concurrent registrations for the same event (row lock held until commit).
  select * into v_event from public.tech_week_events where id = new.event_id for update;
  if not found then
    return new;  -- the foreign key reports the missing event
  end if;

  if new.team_id is null then
    if v_event.capacity is not null
       and v_event.registration_mode = 'individual'
       and new.status in ('registered', 'attended')
       and not v_held_capacity then
      select count(*) into v_count
      from public.tech_week_registrations r
      where r.event_id = new.event_id
        and r.team_id is null
        and r.status in ('registered', 'attended')
        and r.id <> new.id;
      if v_count >= v_event.capacity then
        raise exception 'tech_week_capacity_full'
          using errcode = 'P0001', hint = 'The event has reached its capacity.';
      end if;
    end if;
  else
    if v_event.team_max_size is not null and not v_held_team_slot then
      select count(*) into v_count
      from public.tech_week_registrations r
      where r.team_id = new.team_id
        and r.status <> 'cancelled'
        and r.id <> new.id;
      if v_count >= v_event.team_max_size then
        raise exception 'tech_week_team_full'
          using errcode = 'P0001', hint = 'The team has reached team_max_size.';
      end if;
    end if;
  end if;

  return new;
end $$;

revoke all on function public.tech_week_enforce_limits() from public, anon, authenticated;

drop trigger if exists trg_tech_week_enforce_limits on public.tech_week_registrations;
create trigger trg_tech_week_enforce_limits
  before insert or update of status, team_id, event_id
  on public.tech_week_registrations
  for each row execute function public.tech_week_enforce_limits();

commit;
