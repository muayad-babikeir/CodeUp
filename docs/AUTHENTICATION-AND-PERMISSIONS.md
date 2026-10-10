# Authentication and permissions

## Authentication
Supabase Auth through `js/supabase.js`: email/password, Google and GitHub OAuth, password recovery. The client keeps the Supabase session. Account deletion calls the `delete-account` Edge Function, which verifies the JWT and removes the user with the service role.

## Roles
Resolved at login by `loadMyContext` in `js/shared.js` and, for the admin panel, in `admin/js/app.js`.

| Role | Source | Capabilities |
|---|---|---|
| Student | any signed-in user | learn, submit, post, message |
| Super admin | `profiles.is_super_admin` | everything, via `is_super_admin(uid)` |
| Course admin | `course_admins` | manage that course |
| Group leader | `squad_leaders.permissions` | keys `can_add_assignment`, `can_add_content`, `can_post_announcement` |
| University admin | `university_admins` | manage a university and its Telegram archive |
| Tech Week admin | `tech_week_admins` | manage events and registrations |

## Enforcement
RLS policies and `SECURITY DEFINER` RPCs enforce roles in the database; the UI also hides sections but is not the security boundary. Edge Functions re-check roles (for example `canManage(universityId)` in the Telegram functions). Cron-invoked functions accept an `x-cron-secret` header instead of a user JWT. Marketplace, messaging and membership policies exist in production but are not in the repo and were not reviewed. See [SECURITY](SECURITY.md).
