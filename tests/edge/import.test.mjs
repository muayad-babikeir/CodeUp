import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
globalThis.setTimeout = (fn) => { fn(); return 0; };   // no real 3s pacing in tests

function world(o = {}) {
  let sid = 300;
  const w = { user: { id: 'u1' }, tg: [], rpcs: [], upserts: [], lessonUpdates: [], jobUpdates: [], resInserts: [],
    tgReply: (m, b) => {
      if (m === 'getChat') return String(b.chat_id) === '-1004337039125' ? { ok: true, result: { id: -1004337039125, is_forum: true } } : { ok: true, result: { id: -1001234567890, title: 'src', type: 'supergroup' } };
      if (m === 'getMe') return { ok: true, result: { id: 1 } };
      if (m === 'getChatMember') return { ok: true, result: { status: 'administrator' } };
      if (m === 'copyMessage') { if (o.copyFail || (o.copyFailOnce && !w.cfOnce && (w.cfOnce = true))) return { ok: false, description: o.copyFail || 'Too Many Requests: slow down' }; return { ok: true, result: { message_id: 900 } }; }
      if (m === 'sendMessage') { const k = w.tg.filter(x => x.m === 'sendMessage').length; if (o.failMsg === k) return { ok: false, description: 'Bad Request: msg' }; return { ok: true, result: { message_id: ++sid } }; }
      return { ok: true, result: {} };
    },
    rpc: async (n, a) => { w.rpcs.push({ n, a }); if (n === 'is_super_admin') return { data: true }; if (n === 'next_episode') return { data: 2 }; if (n === 'telegram_attach_owner') return { data: o.attachOk !== false, error: null }; if (n === 'claim_import_job') return { data: [{ id: 'J1', subject_id: null, lesson_id: 'L1', course_id: 'c1', created_by: 'u1', source_chat_id: -1001234567890, from_message_id: 45, to_message_id: 45, cursor_message_id: 45, section: 'Anki', role: 'alternative', language: null, publisher: null, force_reimport: true, copied: 0, skipped: 0, status: 'running' }], error: null }; return { data: null, error: null }; },
    resolve: (st, single) => {
      const t = st.table;
      if (t === 'lessons' && st.op === 'update') { w.lessonUpdates.push(st.payload); return { error: null }; }
      if (t === 'lessons') return { data: { id: 'L1', title: 'Pointers', units: { title: 'C basics', course_id: 'c1', courses: { name: 'Linux' } } } };
      if (t === 'archive_destinations') return { data: [{ id: 'd1', title: 'Main', telegram_chat_id: '-1004337039125' }] };
      if (t === 'archive_topics') return single ? { data: { id: 'TOPIC1', telegram_thread_id: 107, index_message_id: 9 } } : { data: [] };
      if (t === 'telegram_import_jobs' && st.op === 'select') return { data: { id: 'J1', subject_id: null, lesson_id: 'L1', status: 'pending' } };
      if (t === 'telegram_import_jobs') { w.jobUpdates.push(st.payload); return { data: null, error: null }; }
      if (t === 'resources') { if (st.op === 'insert') w.resInserts.push(st.payload); return { data: { id: 'RES1' }, error: null }; }
      if (t === 'telegram_resource_files' && st.op === 'upsert') { w.upserts.push(st.payload); return { error: null }; }
      if (t === 'telegram_resource_files') return { data: [] };
      return { data: [] };
    } };
  return w;
}
async function runJobAction(o) {
  const w = world(o); w.o = o; const h = await loadFn('telegram-import', w);
  const r = await call(h, { action: 'run', job_id: 'J1' }, {});
  return { r, j: await r.json(), w };
}
async function run(o) {
  const w = world(o); w.o = o; const h = await loadFn('telegram-import', w);
  const r = await call(h, { action: 'import_field', lesson_id: 'L1', field: 'anki_ar_url', from_url: 'https://t.me/c/1234567890/45' }, {});
  return { r, j: await r.json(), w };
}
const SEP = '─── ✦ ────';
const delIds = (w) => w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort((a, b) => a - b);
const order = (w) => w.tg.map(x => x.m).filter(m => ['sendMessage', 'copyMessage', 'deleteMessage'].includes(m)).join(',');

// 1) single-field import (lesson): THREE messages — separator, "section | n", the original message copied as-is
{ const { r, j, w } = await run({});
  const sends = w.tg.filter(x => x.m === 'sendMessage'); const cp = w.tg.find(x => x.m === 'copyMessage');
  ok(r.status === 200 && j.ok === true && j.url === 'https://t.me/c/4337039125/107/900', 'T-imp.1 imported lesson item goes to the COURSE topic (107); link points at the copied content message');
  ok(order(w) === 'sendMessage,sendMessage,copyMessage' && sends[0].body.text === SEP && sends[1].body.text === 'Anki AR · Pointers | 2' && !sends[0].body.parse_mode, 'T-imp.2 exactly three messages in order: unified separator, "section | n", copy');
  ok(cp.body.from_chat_id === '-1001234567890' && cp.body.message_id === 45 && cp.body.chat_id === '-1004337039125' && cp.body.message_thread_id === 107 && !('caption' in cp.body) && !('parse_mode' in cp.body), 'T-imp.3 the copy keeps its original source (chat + message id) and is NOT altered (no caption/text override: type and content preserved)');
  const u = w.upserts[0];
  ok(u && u.kind === 'imported' && u.episode === 2 && u.episode_code === 'E02' && u.topic_id === 'TOPIC1' && u.message_id === 900 && JSON.stringify(u.aux_message_ids) === '[301,302]', 'T-imp.4 tracking: kind=imported, E02, topic; aux = [separator 301, number 302] (cleanup deletes them with the content)');
  const own = w.rpcs.find(x => x.n === 'telegram_attach_owner');
  ok(own && own.a.p_type === 'lesson_field' && own.a.p_field === 'anki_ar_url' && own.a.p_kind === 'imported' && own.a.p_id === 'L1', 'T-imp.5 ownership attach unchanged (lesson_field / anki_ar_url / imported)');
  ok(w.lessonUpdates.length === 1 && w.tg.some(x => x.m === 'editMessageText' && /الفهرس/.test(x.body.text)), 'T-imp.6 lesson field saved and pinned index rebuilt'); }

// 2) failures never leave half-built resources
{ const { r, w } = await run({ failMsg: 1 });
  ok(r.status === 502 && delIds(w).length === 0 && !w.tg.some(x => x.m === 'copyMessage') && w.rpcs.some(x => x.n === 'release_episode') && w.upserts.length === 0, 'T-imp.7 separator fails -> nothing copied, episode released, nothing tracked'); }
{ const { r, w } = await run({ failMsg: 2 });
  ok(r.status === 502 && JSON.stringify(delIds(w)) === '[301]' && !w.tg.some(x => x.m === 'copyMessage') && w.rpcs.some(x => x.n === 'release_episode'), 'T-imp.8 number message fails -> the separator is deleted, nothing copied, episode released'); }
{ const { r, j, w } = await run({ copyFail: 'Bad Request: CHAT_FORWARDS_RESTRICTED' });
  ok(r.status === 502 && /تقييد حفظ المحتوى/.test(j.error || '') && JSON.stringify(delIds(w)) === '[301,302]' && w.rpcs.some(x => x.n === 'release_episode') && w.upserts.length === 0, 'T-imp.9 protected source (copy refused) -> clear error, separator + number deleted, episode released, nothing tracked'); }
{ const { r, w } = await run({ attachOk: false });
  ok(r.status === 502 && JSON.stringify(delIds(w)) === '[301,302,900]' && w.rpcs.some(x => x.n === 'telegram_discard_message') && w.rpcs.some(x => x.n === 'release_episode'), 'T-imp.10 ownership registration fails -> copy + separator + number all deleted, tracking discarded, episode released'); }
// 3) deleted / service source message: skipped cleanly (no orphan separator/number)
{ const { r, w } = await run({ copyFail: 'Bad Request: message to copy not found' });
  ok(r.status === 400 && JSON.stringify(delIds(w)) === '[301,302]' && w.rpcs.some(x => x.n === 'release_episode') && w.upserts.length === 0, 'T-imp.11 missing source message: skipped, separator + number removed, episode released'); }
// 4) retry after a transient failure: no duplicated separator/number
{ const w0 = world({ copyFailOnce: true }); w0.o = {}; const h = await loadFn('telegram-import', w0);
  const b = { action: 'import_field', lesson_id: 'L1', field: 'anki_ar_url', from_url: 'https://t.me/c/1234567890/45' };
  const r1 = await call(h, b, {}); const r2 = await call(h, b, {});
  const made = w0.tg.filter(x => x.m === 'sendMessage').length, removed = w0.tg.filter(x => x.m === 'deleteMessage').length;
  ok(r1.status === 502 && r2.status === 200 && made - removed === 2 && JSON.stringify(w0.upserts[0].aux_message_ids) === '[303,304]', 'T-imp.12 retry after failure: first attempt cleaned up, second leaves exactly one separator + one number'); }

// 5) regular import job (resources): same three messages, resource + ownership recorded, source preserved
{ const { r, j, w } = await runJobAction({});
  const sends = w.tg.filter(x => x.m === 'sendMessage'); const cp = w.tg.find(x => x.m === 'copyMessage');
  ok(r.status === 200 && order(w) === 'sendMessage,sendMessage,copyMessage' && sends[0].body.text === SEP && sends[1].body.text === 'Anki | 2' && cp.body.from_chat_id === '-1001234567890' && cp.body.message_id === 45 && !('caption' in cp.body), 'T-imp.13 import job: separator, "Anki | 2", original message copied untouched');
  const own = w.rpcs.find(x => x.n === 'telegram_attach_owner'); const u = w.upserts[0];
  ok(own && own.a.p_type === 'resource' && own.a.p_kind === 'imported' && own.a.p_id === 'RES1' && u && JSON.stringify(u.aux_message_ids) === '[301,302]' && u.kind === 'imported' && w.resInserts[0] && w.resInserts[0].title === 'Anki | 2' && w.resInserts[0].url === 'https://t.me/c/4337039125/107/900', 'T-imp.14 job: resource row title "Anki | 2" with the content link, owner = resource (imported), aux = [separator, number]'); }
// 6) job paused on a restricted source: the half-built separator/number are removed, the job keeps its cursor for resume
{ const { w } = await runJobAction({ copyFail: 'Bad Request: CHAT_FORWARDS_RESTRICTED' });
  ok(JSON.stringify(delIds(w)) === '[301,302]' && w.jobUpdates.some(x => x.status === 'paused' && /تقييد حفظ المحتوى/.test(x.last_error || '')) && w.upserts.length === 0, 'T-imp.15 job: copy refused -> separator + number deleted, job paused with a clear error, nothing tracked'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
