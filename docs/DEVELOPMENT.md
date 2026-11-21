# Development

**Prerequisites:** a Supabase project, any static file server, Node 18+ for tests, Supabase CLI for functions (optional).

1. Edit `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/supabase.js` (the admin panel loads the same file via `../js/supabase.js`).
2. Database: see [DATABASE](DATABASE.md). A complete schema cannot be rebuilt from the repo; capture the real one from the live project (for example `supabase db pull`, not run here).
3. Serve the root, for example `python3 -m http.server 8000`, then open `http://localhost:8000/`. This command is generic and was not run for this project.
4. Run the tests: [TESTING](TESTING.md).

Troubleshooting: Telegram functions fail without their secrets ([.env.example](../.env.example)); features backed by missing tables fail with RLS or "relation does not exist" errors.
