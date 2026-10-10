# Database

> **Read this first.** The SQL files in `database/` are *not* a complete, reproducible schema, but the production database is. A read-only inspection of the live project on 2026-10-10 found every table and RPC the code uses (listed below). The gaps exist because many patches were applied directly to the live database and never copied here: live migration history contains `patch_7` to `patch_26`, the marketplace, membership, Technical Week and security-hardening migrations, which have no matching file in `database/`. A fresh project therefore cannot be rebuilt from this repository; run `supabase db pull` against the live project to capture the real schema. Patch numbers 3, 7–26, 44 and 47 are absent from the repo, and patch 45's file calls itself "44".

**Live inspection summary (read-only, counts only):** 66 tracked migrations, 99 functions, 157 RLS policies, 23 triggers and 163 indexes in `public`; RLS enabled on every public table I listed. Patch 66 (`patch_66_telegram_ownership`) **is applied live**, despite the repo header saying it is not.

Recorded live-only migrations (grants, profile fields, `get_profile_emails`) are in `database/live-history/`.

Files: `2026_codeup_final_merged_schema.sql` (base), `2026_platform_migration.sql`, `2026_fix_patch_4_gamification.sql`, then `2026_patch_5` … `2026_patch_66_*`.

## Tables defined in the repository (by area)

| Area | Tables | Source |
|---|---|---|
| Identity & settings | `profiles` (has `is_super_admin`), `points_rules`, `activity_log`, `reports` | merged schema; patches 27, 48 |
| Courses | `courses`, `units`, `lessons`, `assignments`, `submissions`, `enrollments`, `course_admins`, `announcements`, `comments`, `reactions`, `challenges`, `challenge_participants`, `file_uploads`, `notifications` | merged schema |
| Groups | `squads`, `squad_leaders`, `squad_join_requests`, `leader_applications` | merged schema; patches 6, 37 |
| Review & saving | `community_reviews`, `saved_submissions` | patches 38, 39 |
| Archiving | `archive_settings` | patch 28 |
| Learning resources & tracks | `resources`, `lesson_resources`, `resource_reports`, `tracks`, `track_courses` | patch 54 |
| University | `universities`, `university_admins`, `university_programs`, `university_years`, `university_semesters`, `university_subjects`, `university_materials` | patches 33, 43, 61 |
| Technical Week | `tech_week_events`, `tech_week_registrations`, `tech_week_teams`, `tech_week_announcements`, `tech_week_settings`, `tech_week_admins` | patches 45, 46 |
| Telegram | `telegram_topic_cleanup`, `telegram_message_cleanup`, `telegram_resource_files`, `telegram_import_jobs`, `telegram_import_items`, `telegram_resource_owners` | patches 53, 60, 63, 66 |

Enrollment progress: the patch 4 trigger computes `xp = completed assignments × 10 + sum of grades of reviewed submissions`, plus `progress` and `streak`, and a status of `on_track` (progress ≥ 70) or `at_risk` (≥ 30). Late submissions are flagged by trigger `trg_set_submission_late_status`.

Resource roles (patch 54): `recommended` (at most one per lesson, partial unique index), `alternative`, `deep_dive`.

Leader permission keys (patch 6): `can_add_assignment`, `can_add_content`, `can_post_announcement`.

File archiving (patch 28): `file_uploads.archive_status` ∈ `live, sending, sent, failed, archived`, with scheduled deletion and per-scope retention (default 7 days).

## Present in production but not created by files in this repository

Tables (verified to exist live): `posts`, `conversations`, `messages`, `app_settings`, `memberships`, `membership_wallet_passes`, `marketplace_categories`, `marketplace_listings`, `marketplace_requests`, `marketplace_reports`, `marketplace_contacts`, `marketplace_listing_status_history`, `squad_proposals`, `squad_proposal_votes`, `lesson_progress`, `assignment_squads`, `archive_destinations`, `archive_topics`.

Functions (verified live): `send_message`, `get_or_create_conversation`, `mark_conversation_read`, `vote_squad_proposal`, `profile_completed_courses`, `delete_course_permanently`, `get_membership_snapshot`, `get_ranked_posts`, `telegram_register_message`, `telegram_attach_owner`, `telegram_sweep_unclaimed`, and 16 `marketplace_*` functions (create, update status, admin review, requests, exchange, contact link, delete, and guards).

### Live definitions (read-only inspection, `!` = NOT NULL)

| Table | Columns | Foreign keys |
|---|---|---|
| `posts` | id!, profile_id!, content!, created_at!, updated_at!, status!, deleted_at, is_pinned!, pinned_until, post_type! | profile_id → profiles (cascade) |
| `conversations` | id!, user_a!, user_b!, last_message_at!, created_at! | user_a, user_b → profiles (cascade) |
| `messages` | id!, conversation_id!, sender_id!, content!, is_read!, created_at! | conversation_id → conversations, sender_id → profiles (cascade). No attachment or audio columns. |
| `memberships` | id!, user_id!, member_id!, member_type!, status!, joined_at!, updated_at! | user_id → profiles |
| `membership_wallet_passes` | id!, user_id!, membership_id!, object_id, class_id!, status!, sync_status!, last_synced_at, last_error, snapshot!, created_at!, updated_at! | membership_id → memberships, user_id → profiles |
| `marketplace_categories` | id!, name!, slug!, order_index!, created_at! | none |
| `marketplace_listings` | id!, owner_id!, category_id, title!, description, condition!, listing_type!, price, quantity!, quantity_remaining!, exchange_wanted_for, borrow_duration_days, status!, rejection_reason, reviewed_by, reviewed_at, created_at!, updated_at! | owner_id → profiles (cascade), category_id → categories, reviewed_by → profiles |
| `marketplace_requests` | id!, listing_id!, requester_id!, request_type!, status!, message, exchange_offer_description, borrow_agreed_return_date, created_at!, decided_at | listing_id → listings, requester_id → profiles |
| `marketplace_contacts` | listing_id!, whatsapp_number, telegram_username, created_at!, updated_at! | listing_id → listings |
| `marketplace_reports` | id!, listing_id!, reported_by!, reason!, status!, created_at! | listing_id, reported_by |
| `marketplace_listing_status_history` | id!, listing_id!, old_status!, new_status!, changed_by, created_at! | listing_id, changed_by |
| `app_settings` | key!, value!, updated_by, updated_at! (keys present: `message_retention_days`, `marketplace_enabled`) | updated_by → profiles |
| `lesson_progress` | id!, lesson_id!, profile_id!, status!, completed_at | lesson_id → lessons, profile_id → profiles |
| `assignment_squads` | assignment_id!, squad_id! | both cascade |
| `squad_proposals` | id!, course_id!, proposed_by!, name!, schedule_days!, time_from, time_to, min_approvals!, status!, resulting_squad_id, created_at!, approved_at | course_id, proposed_by, resulting_squad_id |
| `squad_proposal_votes` | id!, proposal_id!, profile_id!, created_at! | proposal_id, profile_id |
| `archive_destinations` | id!, university_id, title!, telegram_chat_id!, is_active!, created_at!, year_id, serial_code | university_id → universities, year_id → university_years |
| `archive_topics` | id!, destination_id!, topic_key!, telegram_thread_id!, title, created_at!, subject_id, index_message_id, episode_counters!, course_id | destination_id, subject_id, course_id |

Technical Week (live): `tech_week_events` (id, type, title, description, speaker, location, starts_at, ends_at, capacity, registration_open, status, created_by, created_at, updated_at, registration_mode, team_min_size, team_max_size); `tech_week_registrations` (id, event_id, profile_id, status, created_at, team_id; unique `(event_id, profile_id)`); `tech_week_teams` (id, event_id, name, created_by, created_at, leader_id, join_policy, description, telegram_chat_id, telegram_thread_id, telegram_topic_status, telegram_topic_closed_at; unique `(event_id, name)`; unique `(telegram_chat_id, telegram_thread_id)` where thread not null). Registrations cascade when an event or a team is deleted. Functions: `tech_week_create_team`, `tech_week_join_team`, `tech_week_team_active_count` (counts status ≠ `cancelled`), `tech_week_cleanup_empty_team`, `is_tech_week_admin`.

Live RLS for these tables (names only; bodies not reviewed): `posts` select by status/owner/super admin, insert/update owner, delete owner or super admin; `messages` select/insert by conversation participants, **no update or delete policy**; `conversations` select by participants; `memberships` and `membership_wallet_passes` select by owner or super admin; `app_settings` select for everyone, write super admin; `archive_*` super admin only; marketplace tables have owner/admin policies. Storage (`storage.objects`): `avatars` public read and own-folder upload; `course-assets` public read, course-admin write; `submissions` (private bucket) own-folder read/upload, course admin/leader read via `file_uploads`, public read of marketplace images through a policy, super admin delete. No bucket has a size limit set.

Constraints seen live:
- `posts.status` ∈ `published, hidden, deleted`; `posts.post_type` ∈ `general, question, educational, announcement, course_announcement, contest_result, admin`.
- `marketplace_listings.listing_type` ∈ `sale, exchange, borrow, free`; `status` ∈ `pending_review, active, reserved, sold, borrowed, exchanged, given_away, cancelled, rejected`; `condition` ∈ `new, like_new, good, acceptable, needs_repair`. A price is required exactly when the type is `sale`, `exchange_wanted_for` exactly when `exchange`, and `borrow_duration_days` exactly when `borrow`.
- `marketplace_requests.status` ∈ `pending, accepted, rejected, cancelled, completed`.
- `tech_week_events.type` ∈ `workshop, course, competition, talk`; `status` ∈ `draft, published, cancelled`; `registration_mode` ∈ `individual, team`.
- `tech_week_registrations.status` ∈ `registered, cancelled, attended, pending`.

## RLS and functions

RLS is enabled on the tables created by the patches, with policies written in Arabic names such as `"tracks: قراءة"`. Patch 48 restricts `profiles` reads with column-level grants. In production the `authenticated` role can select `id, full_name, avatar_url, is_super_admin, created_at` plus `university, major, study_level, skills, achievements, github_url, linkedin_url` (verified live), so the profile fields the client reads are covered; the repo patch alone does not show this (live migration `patch_59_profile_fields_and_completed_courses`).

To list every function, trigger, index and policy, search the patch files for `create function`, `create trigger`, `create index` and `create policy`. A generated inventory was not committed.
