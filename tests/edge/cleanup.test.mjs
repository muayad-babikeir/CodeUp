import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
function world(rows, o = {}) {
  const w = { user: { id: 'u1' }, tg: [], rpcs: [], updates: [], rows, owned: o.owned || {}, roles: o.roles || { sa: true }, stuck: o.stuck || 0,
    tgReply: (m, b) => o.tgReply ? o.tgReply(m, b) : ({ ok: true, result: true }),
    rpc: async (n, a) => { w.rpcs.push(n); if (n === 'is_super_admin') return { data: !!w.roles.sa }; return { data: 0, error: null }; },
    resolve: (st) => {
      if (st.table === 'telegram_message_cleanup' && st.op === 'select') { return st.filters.processed_at === null && st.filters.attempts === undefined && !('lt' in st.filters) ? { data: w.rows, count: w.stuck } : { data: w.rows, count: w.stuck }; }
      if (st.table === 'telegram_message_cleanup' && st.op === 'update') { w.updates.push({ id: st.filters.id, ...st.payload }); return { error: null }; }
      if (st.table === 'telegram_resource_owners') return { count: w.owned[st.filters.message_id] ? 1 : 0 };
      if (['course_admins', 'university_admins', 'squad_leaders'].includes(st.table)) return { count: w.roles[st.table] ? 1 : 0 };
      if (st.table === 'archive_topics') return { data: null };
      return { data: null, count: 0 };
    } };
  return w;
}
const rowsOf = (...r) => r.map((x, i) => ({ id: i + 1, chat_id: -100, message_id: 10 + i, thread_id: null, attempts: 0, rebuild_topic_id: null, ...x }));

// authz
{ const w = world([], { roles: {} }); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {});
  ok(r.status === 403 && w.tg.length === 0, 'T-clean.1 authenticated non-admin -> 403 (cannot trigger cleanup)'); }
{ const w = world([], { roles: { course_admins: true } }); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {});
  ok(r.status === 200, 'T-clean.2 course admin allowed'); }
{ const w = world([], { roles: { squad_leaders: true } }); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {});
  ok(r.status === 200, 'T-clean.3 squad leader allowed'); }
{ const w = world([]); const h = await loadFn('telegram-resource-cleanup', w); const r = await h(new Request('http://x', { method: 'POST', headers: { 'x-cron-secret': 'wrong' }, body: '{}' }));
  ok(r.status === 401, 'T-clean.4 wrong cron secret -> 401'); }
{ const w = world([]); const h = await loadFn('telegram-resource-cleanup', w); const r = await h(new Request('http://x', { method: 'POST', headers: { 'x-cron-secret': 'cron' }, body: '{}' })); const j = await r.json();
  ok(r.status === 200 && w.rpcs.includes('telegram_sweep_unclaimed'), 'T-clean.5 cron allowed and unclaimed-upload sweeper runs'); }
// behaviour
{ const w = world(rowsOf({}), {}); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json();
  ok(j.deleted === 1 && w.tg.some(x => x.m === 'deleteMessage' && x.body.message_id === 10) && w.updates[0].processed_at, 'T-clean.6 queued message deleted from Telegram and marked processed'); }
{ const w = world(rowsOf({ message_id: 11 }), { owned: { 11: true } }); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json();
  ok(j.skipped === 1 && !w.tg.some(x => x.m === 'deleteMessage') && /still owned/.test(w.updates[0].last_error), 'T-clean.7 message that still has an owner is never deleted (last-line guard)'); }
{ const w = world(rowsOf({}), { tgReply: () => ({ ok: false, description: 'Bad Request: message to delete not found' }) }); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json();
  ok(r.status === 200 && j.deleted === 1 && j.failed === 0 && w.updates[0].processed_at, 'T-clean.8 already-deleted Telegram message = success (idempotent), no crash'); }
{ const w = world(rowsOf({ attempts: 2 }), { tgReply: () => ({ ok: false, description: 'Bad Request: not enough rights to delete' }) }); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json();
  ok(j.failed === 1 && w.updates[0].attempts === 3 && !w.updates[0].processed_at && /not enough rights/.test(w.updates[0].last_error), 'T-clean.9 real failure keeps the job (attempts+1, error recorded) for retry'); }
{ const w = world(rowsOf({ attempts: 4 }), { tgReply: () => ({ ok: false, description: 'Bad Request: not enough rights' }), stuck: 1 });
  const logs = []; const oe = console.error; console.error = (...a) => logs.push(a.join(' '));
  const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json(); console.error = oe;
  ok(logs.some(l => /gave up after 5 attempts/.test(l)) && j.stuck === 1, 'T-clean.10 job that exhausts retries is logged loudly and reported as stuck in the response'); }
{ const w = world(rowsOf({ message_id: null, thread_id: 777 })); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json();
  ok(w.tg.some(x => x.m === 'deleteForumTopic' && x.body.message_thread_id === 777) && j.deleted === 1, 'T-clean.11 topic job -> deleteForumTopic'); }
// three-message link: when its resource is deleted the DB queues the content message + its separator + number (aux) -> all three are deleted
{ const w = world(rowsOf({ message_id: 557 }, { message_id: 555 }, { message_id: 556 })); const h = await loadFn('telegram-resource-cleanup', w); const r = await call(h, {}); const j = await r.json();
  const del = w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort();
  ok(j.deleted === 3 && JSON.stringify(del) === '[555,556,557]' && w.updates.every(u => u.processed_at), 'T-clean.12 link trio (content + separator + number) queued by the DB -> all three deleted and marked processed'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
