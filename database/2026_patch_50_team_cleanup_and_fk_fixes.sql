-- Patch #50 — (مطبَّق على القاعدة الحية بالفعل) حذف الفرق اليتيمة تلقائيًا + إصلاح مفاتيح أجنبية تمنع حذف الحساب
create or replace function tech_week_cleanup_empty_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and new.team_id is not null
     and not exists (select 1 from tech_week_registrations r where r.team_id = new.team_id and r.status in ('registered','attended')) then
    delete from tech_week_teams where id = new.team_id;
  end if;
  return null;
end $$;
drop trigger if exists tech_week_registrations_cleanup_empty_team on tech_week_registrations;
create trigger tech_week_registrations_cleanup_empty_team after update of status on tech_week_registrations
  for each row execute function tech_week_cleanup_empty_team();

delete from tech_week_teams t where not exists (select 1 from tech_week_registrations r where r.team_id = t.id and r.status in ('registered','attended'));

alter table tech_week_events drop constraint if exists tech_week_events_created_by_fkey, add constraint tech_week_events_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;
alter table tech_week_announcements drop constraint if exists tech_week_announcements_created_by_fkey, add constraint tech_week_announcements_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;
alter table tech_week_settings drop constraint if exists tech_week_settings_updated_by_fkey, add constraint tech_week_settings_updated_by_fkey foreign key (updated_by) references profiles(id) on delete set null;
alter table tech_week_teams drop constraint if exists tech_week_teams_created_by_fkey, add constraint tech_week_teams_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;
alter table tech_week_teams drop constraint if exists tech_week_teams_leader_id_fkey, add constraint tech_week_teams_leader_id_fkey foreign key (leader_id) references profiles(id) on delete set null;
alter table marketplace_listing_status_history drop constraint if exists marketplace_listing_status_history_changed_by_fkey, add constraint marketplace_listing_status_history_changed_by_fkey foreign key (changed_by) references profiles(id) on delete set null;
alter table marketplace_listings drop constraint if exists marketplace_listings_reviewed_by_fkey, add constraint marketplace_listings_reviewed_by_fkey foreign key (reviewed_by) references profiles(id) on delete set null;
alter table marketplace_listings drop constraint if exists marketplace_listings_owner_id_fkey, add constraint marketplace_listings_owner_id_fkey foreign key (owner_id) references profiles(id) on delete cascade;
alter table marketplace_requests drop constraint if exists marketplace_requests_requester_id_fkey, add constraint marketplace_requests_requester_id_fkey foreign key (requester_id) references profiles(id) on delete cascade;
alter table marketplace_reports drop constraint if exists marketplace_reports_reported_by_fkey, add constraint marketplace_reports_reported_by_fkey foreign key (reported_by) references profiles(id) on delete cascade;
alter table marketplace_requests drop constraint if exists marketplace_requests_listing_id_fkey, add constraint marketplace_requests_listing_id_fkey foreign key (listing_id) references marketplace_listings(id) on delete cascade;
alter table marketplace_reports drop constraint if exists marketplace_reports_listing_id_fkey, add constraint marketplace_reports_listing_id_fkey foreign key (listing_id) references marketplace_listings(id) on delete cascade;
