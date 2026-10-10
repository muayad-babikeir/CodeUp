# Testing

Five Node scripts in `tests/edge/` use `harness.mjs` to run Edge Function code against a mock Supabase and Telegram. No test framework or `package.json` exists.

```bash
node tests/sql/static.test.mjs        # static SQL checks only, not a database test
node tests/edge/cleanup.test.mjs
node tests/edge/import.test.mjs
node tests/edge/upload_file.test.mjs
node tests/edge/upload_link.test.mjs
node tests/edge/archive_auth.test.mjs
```

Observed during this audit (Node v22.22.2): cleanup 14, import 15, upload_file 25, upload_link 49, archive_auth 12 passing assertions, 0 failures (115 total). `tests/sql/static.test.mjs` adds 28 static checks (balanced quotes/parentheses, search_path, revoke, no DML, no secrets) that passed; they cannot prove the SQL parses or behaves correctly in Postgres. The 12 `archive_auth` tests were also run against the original function: 4 of them failed there (unset secret x3, token redaction), which shows they detect the defect.

Coverage gaps: no tests for the frontend, SQL/RLS, `google-wallet`, `delete-account`, `telegram-team-topic`, `telegram-group-check`, `telegram-send-immediate`. Passing mocked tests do not prove production behavior. SQL test scripts exist for patches 66, 67 and 68 (`database/2026_patch_6*_tests_in_transaction.sql`); **none was run**. Patches 67 and 68 and their tests have not even been parsed by Postgres, because no Postgres was available. Run them on a development branch, never on production. No integration or end-to-end test was run.
