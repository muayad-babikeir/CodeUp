# Feature catalog

Status terms are defined in the [README](../README.md). "Tested" here means only the mocked Edge Function tests in `tests/edge/` (see [TESTING](TESTING.md)); no feature is *Deployment verified*.

| Feature | Who | Where | Backend | Status |
|---|---|---|---|---|
| Sign-up, sign-in, OAuth (Google, GitHub), password recovery | Anyone | `index.html`, `js/app.js` | Supabase Auth | Implemented |
| Profile and account settings | Signed-in user | Account modal | `profiles`, `avatars` bucket | Implemented (profile columns not in repo SQL) |
| Account deletion | Signed-in user | Account modal | `delete-account` function | Implemented |
| Courses, units, lessons | Students; course admins manage | Home → Courses | `courses`, `units`, `lessons` | Implemented |
| Learning resources and tracks | Students; admins manage | Lesson view; admin | patch 54 tables | Implemented |
| Assignments and submissions | Students submit; admins/leaders review and grade | Course tabs | `assignments`, `submissions`, `submissions` bucket (8 MB client limit) | Implemented |
| XP, streak, progress, leaderboard | Students | Course | trigger in patch 4 (`xp = completed × 10 + reviewed grades`) | Implemented |
| Community review of submissions | Signed-in members | Submission view | `submit_community_review` (`meets_requirements` / `needs_review`) | Implemented |
| Groups (squads) | Students, leaders, course admins | Course | join requests, leader applications, `leave_squad`, `assign_squad_leader` | Implemented |
| University archive | Students read; university admins manage | Home → University | `university_*` tables | Implemented |
| Telegram upload / import / cleanup | University admins | Admin | 4 Edge Functions | Implemented; logic Tested (mocked) |
| Technical Week | Students; Tech Week admins manage | Home → Technical Week | `tech_week_*` tables | Implemented, Partial limits below |
| Marketplace | Students; admin review | Home → Marketplace | `marketplace_*` tables and 16 functions (live, not in repo) | Implemented; live objects exist |
| Membership card | Members | Account modal | `google-wallet`, `memberships`, `membership_wallet_passes` | Partial: QR page missing; wallet pass rows exist live |
| Feed, comments, reactions | Signed-in users | Home | `posts`, `comments`, `reactions`, `get_ranked_posts` | Implemented (`posts` DDL not in repo) |
| Direct messages | Signed-in users | Messages | `conversations`, `messages`, `send_message` RPC, Realtime | Implemented, text only, 2000 chars |
| Notifications | Signed-in users | Bell | `notifications`, Realtime | Implemented |

## Technical Week
Events have individual or team registration. Team size is capped by `team_max_size` in RLS (patch 46). Team leaders can hand over leadership, and members can leave. Team joining is also governed by `join_policy` (`open` or `approval`); pending requests have status `pending`. **Not enforced in production:** individual event `capacity` (no check in the live INSERT policy or any trigger) and `team_min_size`. The team maximum is checked only in the INSERT policy, without locking and not on UPDATE. Verified against the live definitions on 2026-10-10. `database/2026_patch_67_tech_week_limits_enforcement.sql` enforces capacity and the team maximum safely under concurrency; it is **not applied** (see [ROLLOUT-PLAN](ROLLOUT-PLAN.md)).

## Marketplace
A classifieds model: listing types sale, exchange, borrow and free. Contact is arranged off-platform through WhatsApp or Telegram links returned by an RPC. There is no payment or checkout. Listing states (live check constraint): `pending_review`, `active`, `reserved`, `sold`, `borrowed`, `exchanged`, `given_away`, `cancelled`, `rejected`. Requests: `pending`, `accepted`, `rejected`, `cancelled`, `completed`. Tables also include `marketplace_contacts` and a status-history table. Feature flag: `marketplace_enabled`.

## Membership card
`google-wallet` builds a Google Wallet pass from `get_membership_snapshot`. The pass QR points to `/verify?m=…`; **no verify page exists in this repo**. Two `membership_wallet_passes` rows exist live, but successful addition to a real Google Wallet was not verified.

## Telegram archive and import
Limits in code: 50 MB per upload, 300 messages per import job, 3 s pacing, ~100 s function budget. Resources use a three-message topic layout; ownership rows prevent cleanup from deleting messages that belong to a resource. See [INTEGRATIONS](INTEGRATIONS.md).

## Not present in the code
Quizzes or tests, certificates, flowchart tool, voice notes, DM attachments, star ratings, language switcher, service worker, `/verify` page.
