# Security

## Design
RLS on patch-created tables; privileged work in `SECURITY DEFINER` RPCs; Edge Functions verify the JWT and then use the service role; secrets only in function secrets. The anon key in `js/supabase.js` is public by design. No real secrets were found in the repository.

## Edge Function JWT settings (live, read-only check 2026-10-10)

| `verify_jwt` | Functions |
|---|---|
| `true` | `telegram-send-immediate`, `delete-account`, `google-wallet`, `telegram-upload-resource`, `telegram-group-check` |
| `false` (called by cron; check `x-cron-secret` or a user JWT inside the code) | `archive-student-files`, `telegram-team-topic`, `telegram-resource-cleanup`, `telegram-import` |

## Findings (2026-10-10 audit)

| # | Finding | Evidence | Level | Status |
|---|---|---|---|---|
| 1 | `archive-student-files` (`verify_jwt=false`) ran without any check if `CRON_SECRET` was unset | source code, function settings | Latent: production **does** have the secret set (log shows a 401 for a wrong secret) | Fixed in the repo, **not deployed** |
| 2 | Fetch errors could embed the Telegram bot token and be stored in `file_uploads.archive_error` | code path; Deno error text not reproduced | Likely, not demonstrated | Redaction added in the repo, **not deployed** |
| 3 | Any signed-in user can pin their own post (shown first to everyone) and label it `admin`/`announcement`; only the UI and `pin_post()` restrict this | policy and column grants, `get_ranked_posts` body | Confirmed by reading definitions; **not exploited** (would write production data) | Patch 68 written, **not applied** |
| 4 | Tech Week `capacity` is not enforced; team limit only in an unlocked policy and not on UPDATE | live policy, triggers, functions | Confirmed | Patch 67 written, **not applied** |
| 5 | Duplicate cron job holds an old, different secret in `cron.job` | catalog (secret not printed) | Confirmed | Removal needs your approval |
| 6 | `anon` and `authenticated` have table-level TRUNCATE, TRIGGER, REFERENCES on all public tables | `information_schema.role_table_grants` | Confirmed; REST API cannot truncate, so not a confirmed vulnerability | Hardening suggestion |
| 7 | Cron SQL in the repo writes the secret into `cron.job` commands | repo SQL | Confirmed | Design limitation |
| 8 | All functions send `Access-Control-Allow-Origin: *` | source | Confirmed | Open |
| 9 | Owner can republish a post a super admin hid. No code or SQL function sets `status = 'hidden'` today (only a direct UPDATE by a super admin can), and the admin panel only offers delete | policies, function search, `admin/js/community.js` | Confirmed from definitions | Patch 68 now locks hidden posts against non-admins; **not applied** |
| 11 | `get_profile_emails()` lets any university admin or Tech Week admin read the email of **any** user, not only their own students | live migration SQL | Confirmed; matches the migration comment ("admin panels that already display email") | Design choice; review if scoping is wanted |
| 10 | No CI, dependency scanning or SQL/RLS tests; admin page loads supabase-js from a floating `@2` tag | repo | Confirmed | Open |

Edge Function `verify_jwt` settings are in the table above. Report vulnerabilities privately to the maintainer; no security contact file exists yet.
