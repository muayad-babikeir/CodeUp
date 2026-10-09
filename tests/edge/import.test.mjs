import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
globalThis.setTimeout = (fn) => { fn(); return 0; };   // no real 3s pacing in tests

function world(o = {}) {
  let sid = 300;
  const w = { user: { id: 'u1' }, tg: [], rpcs: [], upserts: [], lessonUpdates: [],
    tgReply: (m, b) => {
      if (m === 'getChat') return String(b.chat_id) === '-1004337039125' ? { ok: true, result: { id: -1004337039125, is_forum: true } } : { ok: true, result: { id: -1001234567890, title: 'src', type: 'supergroup' } };
      if (m === 'getMe') return { ok: true, result: { id: 1 } };
      if (m === 'getChatMember') return { ok: true, result: { status: 'administrator' } };
      if (m === 'sendMessage') return { ok: true, result: { message_id: ++sid } };
      if (m === 'copyMessage') return o.copyFail ? { ok: false, description: o.copyFail } : { ok: true, result: { message_id: o.textSource && !b.caption ? 901 : (o.textSource ? 902 : 900) } };
      if (m === 'editMessageCaption') return o.textSource ? { ok: false, description: 'Bad Request: there is no caption in the message to edit' } : { ok: true, result: {} };
      return { ok: true, result: {} };
    },
    rpc: async (n, a) => { w.rpcs.push({ n, a }); if (n === 'is_super_admin') return { data: true }; if (n === 'next_episode') return { data: 2 }; if (n === 'telegram_attach_owner') return { data: o.attachOk !== false, error: null }; return { data: null, error: null }; },
    resolve: (st, single) => {
      const t = st.table;
      if (t === 'lessons' && st.op === 'update') { w.lessonUpdates.push(st.payload); return { error: null }; }
      if (t === 'lessons') return { data: { id: 'L1', title: 'Pointers', units: { title: 'C basics', course_id: 'c1', courses: { name: 'Linux' } } } };
      if (t === 'archive_destinations') return { data: [{ id: 'd1', title: 'Main', telegram_chat_id: '-1004337039125' }] };
      if (t === 'archive_topics') return single ? { data: { id: 'TOPIC1', telegram_thread_id: 107, index_message_id: 9 } } : { data: [] };
      if (t === 'telegram_resource_files' && st.op === 'upsert') { w.upserts.push(st.payload); return { error: null }; }
      if (t === 'telegram_resource_files') return { data: [] };
      return { data: [] };
    } };
  return w;
}
async function run(o) {
  const w = world(o); w.o = o; const h = await loadFn('telegram-import', w);
  const r = await call(h, { action: 'import_field', lesson_id: 'L1', field: 'anki_ar_url', from_url: 'https://t.me/c/1234567890/45' }, {});
  return { r, j: await r.json(), w };
}
const SEP = '───────── ✦ ─────────';
const HEAD = '<blockquote>#مصدر_بديل #Linux #C_basics\n#Pointers</blockquote>\n\n<blockquote>Anki AR · Pointers | 2</blockquote>';
// media source: ONE message (copyMessage with the unified caption); no separate header/separator/heading messages
{ const { r, j, w } = await run({});
  const order = w.tg.map(x => x.m).filter(m => ['sendMessage', 'copyMessage'].includes(m)).join(',');
  const cp = w.tg.find(x => x.m === 'copyMessage');
  ok(r.status === 200 && j.ok === true && j.url === 'https://t.me/c/4337039125/107/900', 'T-imp.1 imported lesson item goes to the COURSE topic (107) as before');
  ok(order === 'copyMessage' && cp.body.caption === HEAD + '\n\n' + SEP + '\n\nAnki AR · Pointers | 2' && cp.body.parse_mode === 'HTML' && cp.body.message_thread_id === 107, 'T-imp.2 ONE message: copyMessage with caption = [tags quote][title quote] / separator / "section | n"');
  ok(w.tg.some(x => x.m === 'editMessageCaption' && x.body.message_id === 900), 'T-imp.3 caption application verified on the copied message');
  const u = w.upserts[0];
  ok(u && u.kind === 'imported' && u.episode === 2 && u.episode_code === 'E02' && u.topic_id === 'TOPIC1' && JSON.stringify(u.aux_message_ids) === '[]', 'T-imp.4 tracking: kind=imported, E02, topic; aux = [] (nothing extra to clean)');
  const own = w.rpcs.find(x => x.n === 'telegram_attach_owner');
  ok(own && own.a.p_type === 'lesson_field' && own.a.p_field === 'anki_ar_url' && own.a.p_kind === 'imported' && own.a.p_id === 'L1', 'T-imp.5 ownership attach unchanged (lesson_field / anki_ar_url / imported)');
  ok(w.tg.some(x => x.m === 'editMessageText' && /الفهرس/.test(x.body.text)), 'T-imp.6 pinned index is still rebuilt'); }
// failure while recording ownership: only the copy is removed (no helper messages exist), episode released, ownership untouched
{ const { r, w } = await run({ attachOk: false });
  const dels = w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id);
  ok(r.status === 502 && JSON.stringify(dels) === JSON.stringify([900]) && w.rpcs.some(x => x.n === 'release_episode'), 'T-imp.7 failure -> the copy is deleted (no orphans), episode released'); }
// technical exception: text-only source has no caption -> the copy is replaced by the previous layout (header, unified separator, heading, copy)
{ const { r, w } = await run({ textSource: true });
  const sends = w.tg.filter(x => x.m === 'sendMessage');
  const order = w.tg.map(x => x.m).filter(m => ['sendMessage', 'copyMessage', 'deleteMessage'].includes(m)).join(',');
  ok(r.status === 200 && order === 'copyMessage,deleteMessage,sendMessage,sendMessage,sendMessage,copyMessage', 'T-imp.8 text-only source: caption-less copy removed, then header, separator, heading, plain copy');
  ok(sends[0].body.text === HEAD && sends[1].body.text === SEP && sends[2].body.text === 'Anki AR · Pointers | 2', 'T-imp.9 exception layout uses the same metadata and the unified separator');
  ok(JSON.stringify(w.upserts[0].aux_message_ids) === JSON.stringify([302, 303, 301]), 'T-imp.10 exception tracking: aux = [separator, heading, metadata] (cleanup deletes them with the copy)'); }
// deleted/service source message: skipped cleanly, episode released, nothing left behind
{ const { r, j, w } = await run({ copyFail: "Bad Request: message to copy not found" });
  ok(r.status === 400 && !w.tg.some(x => x.m === 'sendMessage') && w.rpcs.some(x => x.n === 'release_episode'), 'T-imp.11 missing source message: skipped, episode released, no messages created'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
