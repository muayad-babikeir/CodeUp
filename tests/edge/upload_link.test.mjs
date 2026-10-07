import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };

function world(over = {}) {
  const w = {
    user: { id: 'u1' }, tg: [], rpcs: [], owner: null, linked: true, isAdmin: true, registerOk: true,
    tgReply: (m) => (over.tgReply ? over.tgReply(m, w) : (m === 'sendMessage' ? { ok: true, result: { message_id: 555 } } : { ok: true, result: {} })),
    rpc: async (n, a) => { w.rpcs.push({ n, a }); if (n === 'is_super_admin') return { data: w.isAdmin }; if (n === 'is_course_admin' || n === 'leader_has_permission') return { data: false }; if (n === 'telegram_register_message') return { data: w.registerOk, error: null }; return { data: null }; },
    resolve: (st, single) => {
      const t = st.table;
      if (t === 'lessons') return { data: { title: 'Pointers', units: { title: 'C basics', course_id: 'c1', courses: { name: 'Linux' } } } };
      if (t === 'lesson_resources') return { data: w.linked ? { role: 'recommended', resources: { title: 'Linux guide <b>', url: 'https://youtube.com/watch?v=1&t=2' } } : null };
      if (t === 'archive_destinations') return { data: [{ id: 'd1', telegram_chat_id: '-1004337039125', university_id: null, year_id: null }] };
      if (t === 'archive_topics') return { data: [{ topic_key: 'materials', telegram_thread_id: 5 }] };
      if (t === 'telegram_resource_owners') return { data: w.owner };
      if (t === 'telegram_resource_files') return { data: { url: 'https://t.me/c/4337039125/5/900', topic_id: null } };
      return { data: null };
    },
  };
  return w;
}
const body = { action: 'publish_link', kind: 'lesson', ref_id: 'L1', resource_id: 'R1', title: 'EVIL title from client', storage_path: 'ignored' };

// 1) new link message
{ const w = world(); const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  const send = w.tg.find(x => x.m === 'sendMessage');
  ok(r.status === 200 && j.mode === 'created' && j.url === 'https://t.me/c/4337039125/5/555', 'T-link.1 new link: created, url built from chat/thread/message');
  ok(send && send.body.text.split('\n')[0].startsWith('#مصدر_أساسي') && /#Linux/.test(send.body.text.split('\n')[0]), 'T-link.2 tags on the first line (role + breadcrumbs)');
  ok(send && /<blockquote>Linux guide &lt;b&gt;<\/blockquote>/.test(send.body.text) && !/EVIL/.test(send.body.text), 'T-link.3 link name in blockquote, escaped, taken from DB (client title ignored)');
  ok(send && /<blockquote><a href="https:\/\/youtube\.com\/watch\?v=1&amp;t=2">الانتقال إلى الرابط<\/a><\/blockquote>/.test(send.body.text), 'T-link.4 «الانتقال إلى الرابط» is a real link inside blockquote');
  ok(send && !send.body.text.replace(/href="[^"]*"/, '').includes('youtube.com'), 'T-link.5 raw URL not shown as text');
  ok(send && send.body.link_preview_options?.url === 'https://youtube.com/watch?v=1&t=2' && send.body.parse_mode === 'HTML' && send.body.message_thread_id === 5, 'T-link.6 link_preview_options.url set, HTML mode, sent to the archive topic');
  const reg = w.rpcs.find(x => x.n === 'telegram_register_message');
  ok(reg && reg.a.p_kind === 'link' && reg.a.p_type === 'resource' && reg.a.p_id === 'R1' && reg.a.p_msg === 555 && reg.a.p_chat === -1004337039125, 'T-link.7 ownership registered (kind=link, owner=resource R1, chat+message ids)');
  ok(!w.tg.some(x => x.m === 'deleteMessage'), 'T-link.8 nothing deleted on success'); }

// 2) edit in place (message identity comes from DB, never from client)
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 777, kind: 'link' }; const h = await loadFn('telegram-upload-resource', w);
  const r = await call(h, { ...body, message_id: 1, chat_id: 2 }); const j = await r.json(); const ed = w.tg.find(x => x.m === 'editMessageText');
  ok(r.status === 200 && j.mode === 'edited', 'T-link.9 existing link message is edited in place');
  ok(ed && ed.body.message_id === 777 && ed.body.chat_id === '-1004337039125' && !w.tg.some(x => x.m === 'sendMessage'), 'T-link.10 edit targets the owner row message (client ids ignored), no new message'); }

// 3) edit impossible -> new message, registered (server cleans the old one via set_owner)
{ const w = world({ tgReply: (m) => m === 'editMessageText' ? { ok: false, description: 'Bad Request: message to edit not found' } : (m === 'sendMessage' ? { ok: true, result: { message_id: 556 } } : { ok: true }) });
  w.owner = { chat_id: -1004337039125, message_id: 777, kind: 'link' }; const h = await loadFn('telegram-upload-resource', w);
  const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.mode === 'replaced' && w.rpcs.some(x => x.n === 'telegram_register_message' && x.a.p_msg === 556), 'T-link.11 edit failed (message gone) -> new message created and registered for the same resource');
  ok(!w.tg.some(x => x.m === 'deleteMessage'), 'T-link.12 old message is NOT deleted by the function (DB queues it only after new owner is registered)'); }

// 4) transient edit error: no state change
{ const w = world({ tgReply: (m) => m === 'editMessageText' ? { ok: false, description: 'Too Many Requests: retry after 5' } : { ok: true, result: { message_id: 1 } } });
  w.owner = { chat_id: -1004337039125, message_id: 777, kind: 'link' }; const h = await loadFn('telegram-upload-resource', w);
  const r = await call(h, body);
  ok(r.status === 502 && !w.tg.some(x => x.m === 'sendMessage') && !w.rpcs.some(x => x.n === 'telegram_register_message'), 'T-link.13 transient Telegram error -> 502, no duplicate message, no ownership change'); }

// 5) registration refused (source vanished) -> message removed
{ const w = world(); w.registerOk = false; const h = await loadFn('telegram-upload-resource', w);
  const r = await call(h, body);
  ok(r.status === 409 && w.tg.some(x => x.m === 'deleteMessage' && x.body.message_id === 555), 'T-link.14 source vanished -> just-sent message deleted, no orphan'); }

// 6) authorization / ownership of the request
{ const w = world(); w.isAdmin = false; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  ok(r.status === 403 && w.tg.length === 0, 'T-link.15 non-admin -> 403, nothing sent'); }
{ const w = world(); w.linked = false; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  ok(r.status === 404 && w.tg.length === 0, 'T-link.16 resource not linked to the given lesson -> 404, nothing sent'); }
{ const w = world(); w.user = null; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  ok(r.status === 401, 'T-link.17 invalid session -> 401'); }
{ const w = world(); const h = await loadFn('telegram-upload-resource', w); const r = await h(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
  ok(r.status === 401, 'T-link.18 no JWT -> 401'); }
{ const w = world(); w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 't', url: 'javascript:alert(1)' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  ok(r.status === 400 && w.tg.length === 0, 'T-link.19 non-http(s) URL rejected'); }

// 7) editing metadata of a FILE-owned resource saved in "link" mode must never replace/delete the file message
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' };
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 'file res', url: 'https://t.me/c/4337039125/5/900?single' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.mode === 'unchanged_file' && w.tg.length === 0 && !w.rpcs.some(x => x.n === 'telegram_register_message'), 'T-link.20 file-owned resource whose url still points to its message: no card, no replace, nothing touched'); }
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' };
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.mode === 'replaced' && w.rpcs.some(x => x.n === 'telegram_register_message'), 'T-link.21 file-owned resource now pointing to an external url: new link card registered (DB queues the old file message)'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
