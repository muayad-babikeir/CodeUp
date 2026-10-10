// archive-student-files: auth boundary (fail closed) and secret redaction.
// Runs against the mock harness only; no network, no Supabase, no Telegram.
import { loadFn } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };

const FAKE_BOT = 'fake-bot-1234567890:AAFAKEFAKEFAKE';
const SECRET = 'cron-secret-value-for-tests-0123456789';

function world(o = {}) {
  const w = { user: null, tg: [], dbCalls: [], updates: [], rpc: async () => ({ data: null }),
    env: o.env || {},
    tgReply: (m) => { if (o.tgThrow) throw new TypeError(`error sending request for url (https://api.telegram.org/bot${FAKE_BOT}/${m})`); return { ok: true, result: { message_id: 1 } }; },
    resolve: (st) => {
      w.dbCalls.push(st.table + ':' + st.op);
      if (st.table === 'file_uploads' && st.op === 'update') { w.updates.push({ id: st.filters.id, ...st.payload }); return { error: null }; }
      if (st.table === 'file_uploads' && st.filters.archive_status === 'sent') return { data: o.due || [] };
      if (st.table === 'file_uploads' && st.filters.related_type !== undefined) return { data: o.failed || [] };
      if (st.table === 'profiles') return { data: { full_name: 'Test Student' } };
      return { data: null, count: 0 };
    } };
  return w;
}
const run = async (w, headers = {}) => { const h = await loadFn('archive-student-files', w); return h(new Request('http://x', { method: 'POST', headers, body: '{}' })); };
const full = { TELEGRAM_BOT_TOKEN: FAKE_BOT, TELEGRAM_ARCHIVE_CHAT_ID: '-100123', CRON_SECRET: SECRET };

// --- fail closed when the secret is not configured
{ const w = world({ env: { CRON_SECRET: undefined } }); const r = await run(w);
  ok(r.status === 503 && w.dbCalls.length === 0 && w.tg.length === 0, 'T-arch.1 CRON_SECRET unset + no header -> 503, no DB or Telegram access'); }
{ const w = world({ env: { CRON_SECRET: undefined } }); const r = await run(w, { 'x-cron-secret': '' });
  ok(r.status === 503 && w.dbCalls.length === 0, 'T-arch.2 CRON_SECRET unset + empty header -> still 503 (empty string is not a bypass)'); }
{ const w = world({ env: { CRON_SECRET: '' } }); const r = await run(w, { 'x-cron-secret': '' });
  ok(r.status === 503 && w.dbCalls.length === 0, 'T-arch.3 CRON_SECRET set to empty string -> 503'); }

// --- secret configured
{ const w = world({ env: full }); const r = await run(w);
  ok(r.status === 401 && w.dbCalls.length === 0, 'T-arch.4 missing header -> 401, nothing executed'); }
{ const w = world({ env: full }); const r = await run(w, { 'x-cron-secret': 'wrong' });
  ok(r.status === 401 && w.dbCalls.length === 0, 'T-arch.5 wrong secret -> 401'); }
{ const w = world({ env: full }); const r = await run(w, { 'x-cron-secret': SECRET.slice(0, -1) + 'X' });
  ok(r.status === 401 && w.dbCalls.length === 0, 'T-arch.6 same-length wrong secret -> 401'); }
{ const w = world({ env: full }); const r = await run(w, { 'x-cron-secret': SECRET + 'x' });
  ok(r.status === 401, 'T-arch.7 secret with extra suffix -> 401'); }
{ const w = world({ env: full }); const r = await run(w, { 'x-cron-secret': SECRET }); const j = await r.json();
  ok(r.status === 200 && j.deleted === 0 && j.retried === 0 && w.dbCalls.includes('file_uploads:select'), 'T-arch.8 correct secret -> 200 and the job runs (scheduled call keeps working)'); }

// --- error bodies and logs never contain the secret
{ const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  const w1 = world({ env: { CRON_SECRET: undefined } }); const r1 = await run(w1); const b1 = await r1.text();
  const w2 = world({ env: full }); const r2 = await run(w2, { 'x-cron-secret': 'guess' }); const b2 = await r2.text();
  console.error = orig;
  ok(!b1.includes(SECRET) && !b2.includes(SECRET) && !b2.includes('guess') && !logs.join(' ').includes(SECRET), 'T-arch.9 error responses and logs contain neither the configured secret nor the supplied value'); }

// --- behaviour preserved after the fix
{ const w = world({ env: full, due: [{ id: 'f1', storage_path: null, telegram_message_id: 5 }] }); const r = await run(w, { 'x-cron-secret': SECRET }); const j = await r.json();
  ok(j.deleted === 1 && w.updates.some(u => u.id === 'f1' && u.archive_status === 'archived'), 'T-arch.10 due text-only archive row is marked archived'); }
{ const w = world({ env: full, failed: [{ id: 'f2', storage_path: null, file_name: null, mime_type: null, created_at: new Date().toISOString(), course_id: null, submission_id: null, related_type: 'post', related_id: null, uploader_id: 'u1' }] });
  const r = await run(w, { 'x-cron-secret': SECRET }); const j = await r.json();
  ok(j.retried === 1 && w.updates.some(u => u.id === 'f2' && u.archive_status === 'sent'), 'T-arch.11 failed row is retried and marked sent'); }

// --- Telegram bot token never persisted into archive_error
{ const w = world({ env: full, tgThrow: true, failed: [{ id: 'f3', storage_path: null, file_name: null, mime_type: null, created_at: new Date().toISOString(), course_id: null, submission_id: null, related_type: 'post', related_id: null, uploader_id: 'u1' }] });
  const r = await run(w, { 'x-cron-secret': SECRET }); const j = await r.json();
  const saved = w.updates.find(u => u.id === 'f3')?.archive_error || '';
  ok(j.retryFailed === 1 && saved.length > 0 && !saved.includes(FAKE_BOT) && saved.includes('[redacted]'), 'T-arch.12 network error that embeds the bot token is redacted before it is saved'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
