// STATIC checks of the new SQL files. This is NOT a database test: it cannot prove the SQL
// parses in Postgres or behaves correctly. It only catches typos (unbalanced quotes/parens,
// missing search_path, missing revoke, stray DML or secrets) before a real run on a database.
import fs from 'node:fs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
const dir = new URL('../../database/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, dir), 'utf8');
const strip = (s) => s.replace(/--[^\n]*/g, '');
const count = (s, re) => (s.match(re) || []).length;

const patches = ['2026_patch_67_tech_week_limits_enforcement.sql', '2026_patch_68_posts_privileged_fields_guard.sql'];
const cronPatch = '2026_patch_69_remove_duplicate_archive_cron.sql';
const tests = ['2026_patch_67_tests_in_transaction.sql', '2026_patch_68_tests_in_transaction.sql'];

for (const f of [...patches, cronPatch, ...tests]) {
  const s = strip(read(f));
  ok(count(s, /\$[a-z]*\$/g) % 2 === 0, `${f}: dollar-quote markers are paired`);
  const noDollar = s.replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, (m) => m); // keep bodies: quotes inside must balance too
  ok(count(noDollar, /'/g) % 2 === 0, `${f}: single quotes are balanced`);
  ok(count(s, /\(/g) === count(s, /\)/g), `${f}: parentheses are balanced`);
  ok(!/eyJ[A-Za-z0-9_-]{20,}|service_role_key|bot\d{6,}:/i.test(read(f)), `${f}: no secret-looking strings`);
}
for (const f of patches) {
  const s = strip(read(f)).toLowerCase();
  ok(count(s, /\bbegin;/g) === 1 && count(s, /\bcommit;/g) === 1, `${f}: exactly one begin; and one commit;`);
  ok(!/\b(drop\s+table|truncate|delete\s+from|insert\s+into|update\s+public\.)/.test(s), `${f}: no destructive or data-changing statements`);
  const defs = s.split(/create or replace function/).slice(1);
  ok(defs.length > 0 && defs.every((d) => !/security definer/.test(d.split(/\$\$/)[0]) || /set search_path/.test(d.split(/\$\$/)[0])), `${f}: every SECURITY DEFINER function pins search_path`);
  ok(/revoke all on function public\.\w+\(\) from public, anon, authenticated/.test(s), `${f}: trigger function is revoked from API roles`);
  ok(/create trigger/.test(s) && /drop trigger if exists/.test(s), `${f}: trigger creation is re-runnable`);
}
{ const s = strip(read(cronPatch)).toLowerCase();
  ok(count(s, /\bbegin;/g) === 1 && count(s, /\bcommit;/g) === 1, `${cronPatch}: exactly one begin; and one commit;`);
  ok(!/\b(drop\s+table|truncate|delete\s+from|insert\s+into|update\s+)/.test(s), `${cronPatch}: no destructive or data-changing statements`);
  ok((s.match(/cron\.unschedule/g) || []).length === 1 && /unschedule\(d_id\)/.test(s), `${cronPatch}: exactly one unschedule, by job id of the duplicate`);
  ok(/refusing to remove/.test(s) && /k_active/.test(s), `${cronPatch}: guarded by the kept job being active`);
  ok(!/raise notice[^;]*(command|secret)[^;]*,\s*(k|d)_command/.test(s), `${cronPatch}: never prints a job command`); }
const locks = strip(read(patches[0]));
ok(/for no key update/.test(locks) && !/\bfor update\b/.test(locks), 'patch 67 locks the event row with FOR NO KEY UPDATE (no FOR UPDATE upgrade deadlock)');
for (const f of tests) {
  const s = strip(read(f)).toLowerCase();
  ok(/\brollback;/.test(s) && !/\bcommit;/.test(s), `${f}: ends with rollback and never commits`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
