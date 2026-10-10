# Integrations

| Integration | Where | Status |
|---|---|---|
| Supabase (Auth, DB, Storage, Realtime, Edge Functions, cron) | everywhere | Implemented |
| Telegram Bot API | 7 functions | Implemented; mocked tests only |
| Google Wallet | `google-wallet` | Partial |
| Google / GitHub OAuth | Supabase Auth | Implemented in client; provider setup **Unknown** |
| Google Search Console verification | `google*.html` | Files present |

## Edge Functions
| Function | Purpose | Secrets used |
|---|---|---|
| `telegram-upload-resource` | upload a file or link to a university topic, 50 MB limit | bot token |
| `telegram-import` | import a message range as resources, 300 per job | bot token, cron secret |
| `telegram-resource-cleanup` | delete queued Telegram messages, 5 attempts | bot token, cron secret |
| `telegram-team-topic` | create and delete team topics | bot token, cron secret, teams chat id, invite link |
| `telegram-group-check` | verify bot access to a group | bot token |
| `telegram-send-immediate` | send a file to the archive chat now | bot token, archive chat id |
| `archive-student-files` | nightly cleanup of archived copies and retry of failed Telegram sends | bot token, archive chat id, **cron secret (required: the function now returns 503 without it)** |
| `google-wallet` | build membership pass | `GOOGLE_WALLET_SERVICE_ACCOUNT` |
| `delete-account` | delete the caller's account | service role |

All nine functions are `ACTIVE` in production (read-only check, 2026-10-10); whether deployed code matches the repo was not compared. Names are listed in [.env.example](../.env.example). Referencing a variable in code does not prove it is set in production. `tests/edge/` covers cleanup, import and upload only.
