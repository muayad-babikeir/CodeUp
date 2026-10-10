-- RECORD of a migration that is already applied to the live project (not a new change).
-- Transcribed on 2026-10-10 from supabase_migrations.schema_migrations, version 20261003064748, name patch_59_profile_fields_and_completed_courses.
-- It had no file in this repository. Do NOT re-run blindly: check the live history first.
-- Transcription was done by hand (comments shortened); compare against the live record before relying on it.

alter table public.profiles add column if not exists university text;
alter table public.profiles add column if not exists major text;
alter table public.profiles add column if not exists study_level text;
alter table public.profiles add column if not exists skills text[] not null default '{}';
alter table public.profiles add column if not exists achievements text[] not null default '{}';
alter table public.profiles add column if not exists github_url text;
alter table public.profiles add column if not exists linkedin_url text;

alter table public.profiles drop constraint if exists profiles_profile_fields_check;
alter table public.profiles add constraint profiles_profile_fields_check check (
  (university is null or char_length(university) <= 120)
  and (major is null or char_length(major) <= 120)
  and (study_level is null or char_length(study_level) <= 40)
  and cardinality(skills) <= 20
  and char_length(array_to_string(skills, ',')) <= 600
  and cardinality(achievements) <= 20
  and char_length(array_to_string(achievements, E'\n')) <= 4000
  and (github_url is null or (char_length(github_url) <= 200 and github_url ~* '^https://(www\.)?github\.com/.+'))
  and (linkedin_url is null or (char_length(linkedin_url) <= 200 and linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/.+'))
);

grant select (university, major, study_level, skills, achievements, github_url, linkedin_url) on public.profiles to authenticated;

create or replace function public.profile_completed_courses(p_profile_id uuid)
returns table(course_id uuid, name text, slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.slug
  from courses c
  where c.status = 'published'
    and exists (select 1 from units u join lessons l on l.unit_id = u.id where u.course_id = c.id)
    and not exists (
      select 1 from units u join lessons l on l.unit_id = u.id
      where u.course_id = c.id
        and not exists (
          select 1 from lesson_progress lp
          where lp.lesson_id = l.id and lp.profile_id = p_profile_id and lp.status = 'completed'))
  order by c.created_at;
$$;
revoke execute on function public.profile_completed_courses(uuid) from public, anon;
grant execute on function public.profile_completed_courses(uuid) to authenticated;
