# Contributing to CodeUp

## Workflow
1. Branch from the main branch (no CI or branch rules exist in this repository yet).
2. Make focused changes; keep one concern per pull request.
3. Run the Edge Function tests (`node tests/edge/<name>.test.mjs`, see [docs/TESTING.md](docs/TESTING.md)).
4. Update the relevant document in `docs/` when behavior, schema, or configuration changes.

## Conventions observed in the code
- UI text is Arabic and RTL; keep identifiers (tables, functions, env vars) in exact English spelling.
- Sensitive operations go through `SECURITY DEFINER` RPCs, not direct table writes; permissions are enforced with RLS.
- Edge Functions validate the caller's JWT, then use the service role for privileged work; never trust ids from the request body without an ownership/role check.
- Database changes are numbered patch files in `database/`, written to be re-runnable (`if not exists`, `create or replace`). Note in the header whether the patch has been applied to a live database.
- Never commit secrets. The anon key in `js/supabase.js` is public by design; service-role keys, bot tokens and cron secrets are not.

## Documentation standards
Use the status vocabulary from the [README](README.md). Cite file paths. Do not describe planned features as existing ones.

## Pull requests
Describe what changed, how you verified it, and which migrations must be applied before deploying. Missing: license file and code-style tooling (no linter or formatter is configured).
