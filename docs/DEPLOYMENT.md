# Deployment

The production project was inspected read-only (functions, migrations, cron, constraints). The deployment *procedures* below were not executed and are **untested assumptions**. All nine Edge Functions are `ACTIVE` in production; whether the deployed code equals the repo copy was not compared.

- **Frontend:** `CNAME` and `CHANGELOG_v2.md` indicate GitHub Pages. No workflow file exists.
- **Database:** apply patches in numeric order on a database that already has the tables listed in [DATABASE](DATABASE.md). Patch 66's header says it is not yet applied, but the live database already has it (`patch_66_telegram_ownership`). On a new project, apply it **before** deploying the Telegram functions that call its RPCs.
- **Edge Functions:** `supabase functions deploy <name>` for the nine functions, then set secrets from [.env.example](../.env.example). Production uses `verify_jwt=false` for the four cron-invoked functions and `true` for the rest (see [SECURITY](SECURITY.md)); there is no `config.toml`, so set this at deploy time (`--no-verify-jwt`).
- **Not yet applied anywhere:** `database/2026_patch_67_*` (Tech Week limits) and `2026_patch_68_*` (posts guard), and the local `archive-student-files` fix. Follow [ROLLOUT-PLAN](ROLLOUT-PLAN.md) and test on a development branch first.
- **Cron:** edit the URL and `REPLACE_WITH_YOUR_CRON_SECRET` placeholder in patches 31, 53, 60 and 63, then run them.
- **Wallet:** needs a Google Wallet issuer and service account; the QR target page is missing.
