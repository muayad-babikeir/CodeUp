import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };

function world(over = {}) {
  const w = {
    user: { id: 'u1' }, tg: [], rpcs: [], writes: [], nextId: 555, owner: null, linked: true, isAdmin: true, registerOk: true,
    tgReply: (m) => (over.tgReply ? over.tgReply(m, w) : (m === 'sendMessage' ? { ok: true, result: { message_id: w.nextId++ } } : { ok: true, result: {} })),
    rpc: async (n, a) => { w.rpcs.push({ n, a }); if (n === 'is_super_admin') return { data: w.isAdmin }; if (n === 'is_course_admin' || n === 'leader_has_permission') return { data: false }; if (n === 'telegram_register_message') return w.registerErr ? { data: null, error: { message: 'boom' } } : { data: w.registerOk, error: null }; if (n === 'next_episode') return { data: w.episode ?? 1 }; return { data: null }; },
    resolve: (st, single) => {
      const t = st.table;
      if (t === 'lessons') return { data: { title: 'Pointers', units: { title: 'C basics', course_id: w.noCourse ? null : 'c1', courses: { name: 'Linux' } } } };
      if (t === 'lesson_resources') return { data: w.linked ? { role: 'recommended', resources: { title: 'Linux guide <b>', url: 'https://youtube.com/watch?v=1&t=2' } } : null };
      if (t === 'archive_destinations') return { data: [{ id: 'd1', telegram_chat_id: '-1004337039125', university_id: null, year_id: null }] };
      if (t === 'archive_topics') return single ? { data: { id: 'TOPIC1', telegram_thread_id: 107, index_message_id: 9 } } : { data: [{ topic_key: 'materials', telegram_thread_id: 5 }] };
      if (t === 'telegram_resource_owners') return { data: w.owner };
      if (t === 'telegram_resource_files' && st.op !== 'select') { w.writes.push({ op: st.op, payload: st.payload, filters: st.filters }); if (st.op === 'upsert') return { error: w.trackErr ? { message: 'track failed' } : null }; return { data: { url: 'https://t.me/c/4337039125/107/' + (st.filters.message_id ?? 0), topic_id: 'TOPIC1' }, error: null }; }
      if (t === 'telegram_resource_files' && !single) return { data: [], count: 0 };
      if (t === 'telegram_resource_files') return { data: { url: 'https://t.me/c/4337039125/5/900', topic_id: null, aux_message_ids: w.aux, ...(w.trk || {}) } };
      return { data: null };
    },
  };
  return w;
}
const body = { action: 'publish_link', kind: 'lesson', ref_id: 'L1', resource_id: 'R1', title: 'EVIL title from client', storage_path: 'ignored' };

// 1) new link in a topic: THREE messages like a file (separator, "section | n", content)
const SEPL = '─── ✦ ────';
const CARD = '<blockquote>Linux guide &lt;b&gt;</blockquote>\n<blockquote><a href="https://youtube.com/watch?v=1&amp;t=2">الانتقال إلى الرابط</a></blockquote>';
{ const w = world(); const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  const sends = w.tg.filter(x => x.m === 'sendMessage');
  ok(r.status === 200 && j.mode === 'created' && j.url === 'https://t.me/c/4337039125/107/557' && sends.length === 3 && sends.every(x => x.body.message_thread_id === 107), 'T-link.1 new link: 3 messages in the COURSE topic (107); url = the third (content) message');
  ok(sends[0].body.text === SEPL && sends[1].body.text === 'Linux guide <b> | 1' && !sends[1].body.parse_mode, 'T-link.2 message 1 = the old separator, message 2 = "section | n" (plain text, same as files)');
  ok(sends[2].body.text === CARD && sends[2].body.parse_mode === 'HTML', 'T-link.3 content = [quote: title (escaped, from DB, client title ignored)] [quote: «الانتقال إلى الرابط» real link], no hashtags');
  ok(!/EVIL/.test(sends[2].body.text) && !/#/.test(sends[2].body.text) && !sends[2].body.text.replace(/href="[^"]*"/, '').includes('youtube.com'), 'T-link.4 no hashtags, no raw URL as text, client title ignored');
  ok(sends[2].body.link_preview_options?.url === 'https://youtube.com/watch?v=1&t=2' && sends[2].body.link_preview_options.show_above_text === false, 'T-link.6 link preview kept (below the text)');
  const up = w.writes.find(x => x.op === 'upsert');
  ok(up && up.payload.message_id === 557 && up.payload.kind === 'link' && up.payload.topic_id === 'TOPIC1' && up.payload.section === 'Linux guide <b>' && up.payload.episode === 1 && up.payload.episode_code === 'E01' && JSON.stringify(up.payload.aux_message_ids) === '[555,556]' && !!up.payload.claim_deadline, 'T-link.5 tracking row: content msg 557, aux = [separator 555, number 556], section/episode (index + numbering as files)');
  const reg = w.rpcs.find(x => x.n === 'telegram_register_message');
  ok(reg && reg.a.p_kind === 'link' && reg.a.p_type === 'resource' && reg.a.p_id === 'R1' && reg.a.p_msg === 557 && reg.a.p_chat === -1004337039125, 'T-link.7 ownership registered on the content message (kind=link, owner=resource R1) via the existing RPC');
  ok(!w.tg.some(x => x.m === 'deleteMessage') && w.tg.some(x => x.m === 'editMessageText' && /الفهرس/.test(x.body.text)), 'T-link.8 nothing deleted on success; pinned index rebuilt');
  const iUp = w.tg.findIndex(x => x.m === 'sendMessage'); ok(w.rpcs.findIndex(x => x.n === 'next_episode') >= 0 && iUp >= 0, 'T-link.8b numbering via next_episode (unchanged mechanism)'); }

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
  const del = w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort();
  ok(r.status === 409 && JSON.stringify(del) === '[555,556,557]' && w.rpcs.some(x => x.n === 'release_episode') && w.rpcs.some(x => x.n === 'telegram_discard_message'), 'T-link.14 source vanished -> ALL THREE messages deleted, episode released, unowned tracking row discarded'); }

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
// 8) lesson without a course context keeps the current fallback (MATERIALS topic)
{ const w = world(); w.noCourse = true; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  const send = w.tg.find(x => x.m === 'sendMessage');
  ok(r.status === 200 && send && send.body.message_thread_id === 5 && j.url.endsWith('/5/555'), 'T-link.22 lesson with no course context -> fallback MATERIALS topic (thread 5)'); }
// 9) title edit on an existing link message: same message edited, tags/title refreshed, no duplicate
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 777, kind: 'link' }; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); 
  const ed = w.tg.find(x => x.m === 'editMessageText');
  ok(ed && /^<blockquote>#مصدر_أساسي/.test(ed.body.text) && ed.body.text.includes('<blockquote>Linux guide &lt;b&gt;</blockquote>') && w.tg.filter(x => x.m === 'sendMessage').length === 0, 'T-link.23 edit keeps the new layout and sends no duplicate'); }

// 10) link with an invisible/blank title: no empty blockquote (link quote only), section falls back to "رابط"
{ const w = world(); w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: '\u200b\u3164 ', url: 'https://youtube.com/watch?v=1' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const sends = w.tg.filter(x => x.m === 'sendMessage');
  ok(r.status === 200 && (sends[2].body.text.match(/<blockquote>/g) || []).length === 1 && !/<blockquote>\s*<\/blockquote>/.test(sends[2].body.text) && sends[1].body.text === 'رابط | 1', 'T-link.24 blank title -> no empty blockquote (link quote only); number message uses the "رابط" fallback'); }

// 11) editing a FILE-owned resource refreshes the title in the SAME metadata message (aux=[sep,head,meta]); ownership/other messages untouched
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = [11, 12, 13];
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'recommended', resources: { title: 'New title', url: 'https://t.me/c/4337039125/5/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json(); const ed = w.tg.filter(x => x.m === 'editMessageText');
  ok(r.status === 200 && j.mode === 'unchanged_file' && j.meta_updated === true && ed.length === 1 && ed[0].body.message_id === 13 && ed[0].body.text.includes('<blockquote>New title</blockquote>'), 'T-edit.1 file resource: title updated in its metadata message (13) only');
  ok(!w.tg.some(x => ['sendMessage', 'deleteMessage', 'sendDocument'].includes(x.m)) && !w.rpcs.some(x => /telegram_(register|attach|set_owner|release|discard)/.test(x.n)), 'T-edit.2 no new message, no delete, no ownership RPC'); }
// 12) legacy file (aux=[sep,head], no metadata message): nothing touched
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = [11, 12];
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 'x', url: 'https://t.me/c/4337039125/5/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.meta_updated === false && w.tg.length === 0, 'T-edit.3 old file without metadata message: nothing is edited or created'); }
// 13) fallback-path file (aux=[meta]) edit
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = [41];
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 'Renamed', url: 'https://t.me/c/4337039125/5/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const ed = w.tg.find(x => x.m === 'editMessageText');
  ok(ed && ed.body.message_id === 41 && ed.body.text.includes('<blockquote>Renamed</blockquote>'), 'T-edit.4 fallback-path file: its single metadata message is refreshed'); }
// 14) metadata message deleted manually: edit failure is ignored, no crash, no recreation
{ const w = world({ tgReply: (m) => m === 'editMessageText' ? { ok: false, description: 'Bad Request: message to edit not found' } : { ok: true, result: { message_id: 1 } } });
  w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = [11, 12, 13];
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 'x', url: 'https://t.me/c/4337039125/5/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.meta_updated === false && !w.tg.some(x => x.m === 'sendMessage'), 'T-edit.5 missing metadata message: ignored, not recreated'); }
// 15) NEW one-message file (topic, aux=[]): title edit -> editMessageCaption on the SAME message with the stored "section | n"; nothing created/deleted; no ownership RPC
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = []; w.trk = { topic_id: 'TOPIC1', section: 'Lec', episode: 3 };
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'recommended', resources: { title: 'New title', url: 'https://t.me/c/4337039125/107/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json(); const ec = w.tg.filter(x => x.m === 'editMessageCaption');
  ok(r.status === 200 && j.mode === 'unchanged_file' && j.meta_updated === true && ec.length === 1 && ec[0].body.message_id === 900 && ec[0].body.caption.includes('<blockquote>New title</blockquote>') && ec[0].body.caption.endsWith('─── ✦ ────\n\nLec | 3'), 'T-edit.6 one-message file: caption refreshed in the same message (title updated, "Lec | 3" and numbering kept)');
  ok(!w.tg.some(x => ['sendMessage', 'deleteMessage', 'sendDocument', 'editMessageText'].includes(x.m)) && !w.rpcs.some(x => /telegram_(register|attach|set_owner|release|discard)/.test(x.n)), 'T-edit.7 no duplicate, no delete, no ownership RPC'); }
// 16) caption message deleted manually: ignored, not recreated
{ const w = world({ tgReply: (m) => m === 'editMessageCaption' ? { ok: false, description: 'Bad Request: message to edit not found' } : { ok: true, result: { message_id: 1 } } });
  w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = []; w.trk = { topic_id: 'TOPIC1', section: 'Lec', episode: 3 };
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 'x', url: 'https://t.me/c/4337039125/107/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.meta_updated === false && !w.tg.some(x => x.m === 'sendMessage'), 'T-edit.8 missing one-message file: edit failure ignored, nothing recreated'); }
// 17) OLD fallback file (topic_id null, aux=[]): untouched (cannot be told apart from pre-patch messages)
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 900, kind: 'file' }; w.aux = [];
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'study', resources: { title: 'x', url: 'https://t.me/c/4337039125/5/900' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.meta_updated === false && w.tg.length === 0, 'T-edit.9 no-topic message with empty aux: nothing is edited (old messages never modified)'); }

// ===== three-message link design: edit / failures / ownership / cleanup safety =====
const CARD_ROW = { topic_id: 'TOPIC1', section: 'Linux guide <b>', episode: 1 };
// 18) edit an existing three-message link: ONLY the content message is edited (title/destination/preview); separator + number untouched; no duplicates, no ownership RPC
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 557, kind: 'link' }; w.aux = [555, 556]; w.trk = CARD_ROW;
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json(); const ed = w.tg.filter(x => x.m === 'editMessageText' && x.body.message_id === 557);
  ok(r.status === 200 && j.mode === 'edited' && ed.length === 1 && ed[0].body.message_id === 557 && ed[0].body.text === CARD && ed[0].body.link_preview_options.url === 'https://youtube.com/watch?v=1&t=2', 'T-link3.1 content message edited in place (title, link, preview); layout = new card');
  ok(!w.tg.some(x => ['sendMessage', 'deleteMessage'].includes(x.m)) && !w.rpcs.some(x => /telegram_(register|attach|set_owner|release|discard)/.test(x.n)), 'T-link3.2 no new/deleted message, separator + number untouched, no ownership RPC');
  ok(w.writes.some(x => x.op === 'update' && x.payload.display_title === 'Linux guide <b>') && !w.writes.some(x => x.op === 'upsert'), 'T-link3.3 only display_title refreshed (numbering/section untouched)'); }
// 19) destination changed: href updates in the same message
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 557, kind: 'link' }; w.aux = [555, 556]; w.trk = CARD_ROW;
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'recommended', resources: { title: 'Linux guide <b>', url: 'https://example.org/new?a=1&b=2' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const ed = w.tg.find(x => x.m === 'editMessageText');
  ok(r.status === 200 && ed.body.text.includes('href="https://example.org/new?a=1&amp;b=2"') && ed.body.link_preview_options.url === 'https://example.org/new?a=1&b=2' && !w.tg.some(x => x.m === 'sendMessage'), 'T-link3.4 destination change -> same message, new href + preview, no duplicate'); }
// 20) content message gone: 3 NEW messages created + registered first; old (and its separator/number) are queued by the DB only after the new owner is set
{ const w = world({ tgReply: (m, ww) => m === 'editMessageText' && ww.tg.filter(x => x.m === 'editMessageText').length === 1 ? { ok: false, description: 'Bad Request: message to edit not found' } : (m === 'sendMessage' ? { ok: true, result: { message_id: ww.nextId++ } } : { ok: true, result: {} }) });
  w.owner = { chat_id: -1004337039125, message_id: 557, kind: 'link' }; w.aux = [555, 556]; w.trk = CARD_ROW;
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json(); const sends = w.tg.filter(x => x.m === 'sendMessage');
  ok(r.status === 200 && j.mode === 'replaced' && sends.length === 3 && w.rpcs.some(x => x.n === 'telegram_register_message' && x.a.p_msg === 557), 'T-link3.5 content message gone -> three new messages + new owner registered (replaced)');
  ok(!w.tg.some(x => x.m === 'deleteMessage'), 'T-link3.6 the function deletes nothing; the old trio is queued by the DB (set_owner -> enqueue_if_orphan incl. aux) only after registration'); }
// 21) transient edit error on a three-message link: nothing changes
{ const w = world({ tgReply: (m) => m === 'editMessageText' ? { ok: false, description: 'Too Many Requests: retry after 5' } : { ok: true, result: { message_id: 1 } } });
  w.owner = { chat_id: -1004337039125, message_id: 557, kind: 'link' }; w.aux = [555, 556]; w.trk = CARD_ROW;
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  ok(r.status === 502 && !w.tg.some(x => x.m === 'sendMessage') && !w.rpcs.some(x => x.n === 'telegram_register_message'), 'T-link3.7 transient error -> 502, no duplicates, ownership untouched'); }
// 22) a failure while sending any of the three messages: everything sent so far is deleted, episode released, nothing tracked/registered
for (const [k, label] of [[1, 'separator'], [2, 'number'], [3, 'content']]) {
  const w = world({ tgReply: (m, ww) => m === 'sendMessage' ? (ww.tg.filter(x => x.m === 'sendMessage').length === k ? { ok: false, description: 'Bad Request: x' } : { ok: true, result: { message_id: ww.nextId++ } }) : { ok: true, result: {} } });
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  const del = w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort();
  ok(r.status === 502 && JSON.stringify(del) === JSON.stringify([555, 556].slice(0, k - 1)) && w.rpcs.some(x => x.n === 'release_episode') && !w.rpcs.some(x => x.n === 'telegram_register_message') && !w.writes.some(x => x.op === 'upsert'), `T-link3.8.${k} ${label} send fails -> earlier messages deleted, episode released, nothing tracked or registered`); }
// 23) tracking write fails: all three deleted, no ownership attempt
{ const w = world(); w.trackErr = true; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  const del = w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort();
  ok(r.status === 500 && JSON.stringify(del) === '[555,556,557]' && !w.rpcs.some(x => x.n === 'telegram_register_message') && w.rpcs.some(x => x.n === 'release_episode'), 'T-link3.9 tracking failure -> three messages deleted, episode released, no ownership attempt'); }
// 24) ownership registration error (RPC error, not just "false"): same safe rollback
{ const w = world(); w.registerErr = true; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  const del = w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort();
  ok(r.status === 500 && JSON.stringify(del) === '[555,556,557]' && w.rpcs.some(x => x.n === 'telegram_discard_message') && !w.tg.some(x => x.m === 'editMessageText' && /الفهرس/.test(x.body.text)), 'T-link3.10 ownership RPC error -> three messages deleted + tracking row discarded, index not touched'); }
// 25) legacy single-message link (no section/aux) keeps being edited in place with its OLD layout (no automatic recreation)
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 777, kind: 'link' }; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const ed = w.tg.find(x => x.m === 'editMessageText');
  ok(r.status === 200 && ed.body.message_id === 777 && /^<blockquote>#مصدر_أساسي/.test(ed.body.text) && !w.tg.some(x => x.m === 'sendMessage'), 'T-link3.11 old single-message link: edited in place with the old layout, not recreated'); }
// 26) no archive topic (lesson without a course): ONE message as before (no numbering exists there)
{ const w = world(); w.noCourse = true; const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body);
  ok(r.status === 200 && w.tg.filter(x => x.m === 'sendMessage').length === 1 && !w.rpcs.some(x => x.n === 'next_episode') && w.tg.find(x => x.m === 'sendMessage').body.text.startsWith('<blockquote>#مصدر_أساسي'), 'T-link3.12 no topic -> single message with the previous layout (unchanged fallback)'); }

// 27) editing a resource owned by a THREE-message file (aux=[separator, number], topic): nothing to refresh -> no edit, no new message, no delete, no ownership RPC
{ const w = world(); w.owner = { chat_id: -1004337039125, message_id: 321, kind: 'file' }; w.aux = [301, 302]; w.trk = { topic_id: 'TOPIC1', section: 'T', episode: 4 };
  w.resolve = ((orig) => (st, s) => st.table === 'lesson_resources' ? { data: { role: 'recommended', resources: { title: 'New title', url: 'https://t.me/c/4337039125/107/321' } } } : orig(st, s))(w.resolve);
  const h = await loadFn('telegram-upload-resource', w); const r = await call(h, body); const j = await r.json();
  ok(r.status === 200 && j.mode === 'unchanged_file' && j.meta_updated === false && w.tg.length === 0 && !w.rpcs.some(x => /telegram_(register|attach|set_owner|release|discard)/.test(x.n)) && !w.writes.length, 'T-edit.10 three-message file: editing the resource data touches no Telegram message and no ownership/tracking row'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
