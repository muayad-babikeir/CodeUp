# live-history

Records of migrations that are **already applied** to the live project but had no file in `database/`. They were copied by hand from `supabase_migrations.schema_migrations` on 2026-10-10, only for the grant/profile/email changes (small, secret-free). They are documentation, not new migrations: never apply them to the live project again.

Still missing from the repo (live versions with no file): `patch_7` to `patch_21`, `patch_23` to `patch_26`, all `marketplace_*` and `tech_week_*` migrations, `fix_membership_snapshot_course_name_column`. Recovering them needs either a reviewed export of `schema_migrations.statements` (some migrations may contain secrets, so screen each first) or a schema dump. See `docs/PRODUCTION-DIFFERENCES.md`.
