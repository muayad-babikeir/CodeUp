import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
const SEP = '─── ✦ ────';
const META_L = '<blockquote>#مصدر_بديل #C #U\n#L</blockquote>\n\n<blockquote>T</blockquote>';

function world(o = {}) {
  let sid = 300;
  const w = { user: { id: 'u1' }, tg: [], rpcs: [], upserts: [], blob: new Blob(['x']),
    tgReply: (m) => {
      if (m === 'sendMessage') { const k = w.tg.filter(x => x.m === 'sendMessage').length; if (o.failMsg === k) return { ok: false, description: 'Bad Request: msg' }; return { ok: true, result: { message_id: ++sid } }; }
      if (m === 'sendDocument' || m === 'sendVideo' || m === 'sendPhoto') { if (o.failFile || (o.failFileOnce && !w.failedOnce && (w.failedOnce = true))) return { ok: false, description: 'Bad Request: file' }; return { ok: true, result: { message_id: 321 } }; }
      return { ok: true, result: {} };
    },
    rpc: async (n, a) => { w.rpcs.push({ n, a }); if (n === 'is_super_admin' || n === 'is_university_admin') return { data: true }; if (n === 'next_episode') return { data: 4 }; return { data: null }; },
    resolve: (st, single) => {
      const t = st.table;
      if (t === 'lessons') return { data: { title: 'L', units: { title: 'U', course_id: o.noCourse ? null : 'c1', courses: { name: 'C' } } } };
      if (t === 'university_subjects') return { data: { title: 'OS', university_semesters: { title: 'Sem1', university_id: 'u1', year_id: 'y1', universities: { name: 'Uni' }, university_years: { year_number: 1, title: null, university_programs: { name: 'CS' } } } } };
      if (t === 'archive_destinations') {
        if (o.kind === 'subject') return { data: o.noYearDest ? [{ id: 'd3', telegram_chat_id: '-1003333', university_id: 'u1', year_id: null }] : [{ id: 'd2', telegram_chat_id: '-1002222', university_id: null, year_id: 'y1' }] };
        return { data: [{ id: 'd1', telegram_chat_id: '-1004337039125', university_id: null, year_id: null }] };
      }
      if (t === 'archive_topics') {
        if (single) return { data: { id: o.kind === 'subject' ? 'TS' : 'TOPIC1', telegram_thread_id: o.kind === 'subject' ? 55 : 107, index_message_id: 9 } };
        return { data: [{ topic_key: 'university', telegram_thread_id: 77 }, { topic_key: 'materials', telegram_thread_id: 5 }] };
      }
      if (t === 'telegram_resource_files' && st.op === 'upsert') { w.upserts.push(st.payload); return { error: o.trackFails ? { message: 'db down' } : null }; }
      return { data: null };
    } };
  return w;
}
const mk = (over = {}) => ({ action: 'send', kind: 'lesson', ref_id: 'L1', title: 'T', file_name: 'a.pdf', mime_type: 'application/pdf', storage_path: 'u1/resource-uploads/x.pdf', ...over });
async function run(o, bodyOver) {
  const w = world(o); const h = await loadFn('telegram-upload-resource', w);
  const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); w.tg.push({ m, body: init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : (init?.body ? JSON.parse(init.body) : null) }); return { json: async () => w.tgReply(m), status: 200 }; };
  const r = await call(h, mk({ kind: o.kind || 'lesson', ...bodyOver })); const j = await r.json(); globalThis.fetch = f0; return { r, j, w };
}
const seq = (w) => w.tg.map(x => x.m).filter(m => ['sendMessage', 'sendDocument', 'sendVideo', 'sendPhoto'].includes(m));

// THREE-MESSAGE layout inside an archive topic: [separator] ["section | n"] [the file itself]; the two helper messages are tracked as aux of the file row
const delIds = (w) => w.tg.filter(x => x.m === 'deleteMessage').map(x => x.body.message_id).sort((a, b) => a - b);

// 1) PDF into the course topic
{ const { r, j, w } = await run({}, {});
  const msgs = w.tg.filter(x => x.m === 'sendMessage'); const doc = w.tg.find(x => x.m === 'sendDocument');
  ok(r.status === 200 && j.url === 'https://t.me/c/4337039125/107/321' && j.tracked === true, 'T-file.1 PDF goes to the COURSE topic (107), link points at the FILE message');
  ok(seq(w).join(',') === 'sendMessage,sendMessage,sendDocument', 'T-file.2 exactly THREE messages in order: separator, "section | n", file');
  ok(msgs[0].body.text === SEP && !msgs[0].body.parse_mode && msgs[1].body.text === 'T | 4' && !msgs[1].body.parse_mode && msgs.every(x => String(x.body.message_thread_id) === '107'), 'T-file.3 message 1 = the unified short separator, message 2 = "T | 4" (plain text), both in topic 107');
  ok(doc && !doc.body.caption && String(doc.body.message_thread_id) === '107', 'T-file.4 the third message is the file itself (no caption, same topic)');
  const u = w.upserts[0];
  ok(u && u.kind === 'file' && u.created_by === 'u1' && u.message_id === 321 && u.thread_id === 107 && u.topic_id === 'TOPIC1' && u.section === 'T' && u.episode === 4 && u.episode_code === 'E04' && !!u.claim_deadline, 'T-file.5 tracking unchanged: kind=file, topic, section, episode E04');
  ok(JSON.stringify(u.aux_message_ids) === '[301,302]', 'T-file.6 aux_message_ids = [separator 301, number 302] -> the DB cleanup removes them together with the file message');
  ok(w.tg.some(x => x.m === 'editMessageText' && /الفهرس/.test(x.body.text)) && w.rpcs.filter(x => x.n === 'next_episode').length === 1, 'T-file.7 pinned index still rebuilt; numbering via next_episode (unchanged)'); }

// 2) video / photo: same three messages, media method preserved
{ const { r, w } = await run({}, { file_name: 'a.mp4', mime_type: 'video/mp4' });
  const v = w.tg.find(x => x.m === 'sendVideo');
  ok(r.status === 200 && seq(w).join(',') === 'sendMessage,sendMessage,sendVideo' && v.body.supports_streaming === 'true' && !v.body.caption, 'T-file.8 video: separator, number, then the video (streaming kept)'); }
{ const { r, w } = await run({}, { file_name: 'a.png', mime_type: 'image/png' });
  ok(r.status === 200 && seq(w).join(',') === 'sendMessage,sendMessage,sendPhoto', 'T-file.9 photo: separator, number, then the photo'); }
// 2c) Telegram refuses the video -> document fallback, still exactly three messages
{ const w0 = world({}); const orig = w0.tgReply; w0.tgReply = (m) => m === 'sendVideo' ? { ok: false, description: 'Bad Request: wrong file' } : orig(m);
  const h = await loadFn('telegram-upload-resource', w0); const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); w0.tg.push({ m, body: init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : (init?.body ? JSON.parse(init.body) : null) }); return { json: async () => w0.tgReply(m), status: 200 }; };
  const r = await call(h, mk({ file_name: 'a.mp4', mime_type: 'video/mp4' })); globalThis.fetch = f0;
  ok(r.status === 200 && w0.tg.filter(x => x.m === 'sendDocument').length === 1 && w0.tg.filter(x => x.m === 'sendMessage').length === 2, 'T-file.10 video rejected -> document fallback; still separator + number + one file'); }

// 3) failures: nothing is left half-built, the episode number is released
{ const { r, w } = await run({ failMsg: 1 }, {});
  ok(r.status === 502 && delIds(w).length === 0 && w.rpcs.some(x => x.n === 'release_episode') && !w.tg.some(x => x.m === 'sendDocument') && w.upserts.length === 0, 'T-file.11 separator send fails -> nothing sent after it, nothing tracked, episode released'); }
{ const { r, w } = await run({ failMsg: 2 }, {});
  ok(r.status === 502 && JSON.stringify(delIds(w)) === '[301]' && w.rpcs.some(x => x.n === 'release_episode') && !w.tg.some(x => x.m === 'sendDocument') && w.upserts.length === 0, 'T-file.12 number send fails -> the separator is deleted, no file sent, episode released'); }
{ const { r, w } = await run({ failFile: true }, {});
  ok(r.status === 502 && JSON.stringify(delIds(w)) === '[301,302]' && w.rpcs.some(x => x.n === 'release_episode') && w.upserts.length === 0, 'T-file.13 file send fails -> separator + number deleted (no orphans), episode released, temp file kept for retry'); }
{ const { r, w } = await run({ trackFails: true }, {});
  ok(r.status === 500 && JSON.stringify(delIds(w)) === '[301,302,321]' && w.rpcs.some(x => x.n === 'release_episode'), 'T-file.14 tracking failure -> ALL THREE messages deleted + episode released'); }
// 3b) retry after a failure: no duplicated separator/number remains, the same number is reused
{ const w0 = world({ failFileOnce: true }); const h = await loadFn('telegram-upload-resource', w0); const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); w0.tg.push({ m, body: init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : (init?.body ? JSON.parse(init.body) : null) }); return { json: async () => w0.tgReply(m), status: 200 }; };
  const r1 = await call(h, mk()); const r2 = await call(h, mk()); globalThis.fetch = f0;
  const created = w0.tg.filter(x => x.m === 'sendMessage').length, removed = w0.tg.filter(x => x.m === 'deleteMessage').length;
  ok(r1.status === 502 && r2.status === 200 && created - removed === 2 && w0.upserts.length === 1 && JSON.stringify(w0.upserts[0].aux_message_ids) === '[303,304]', 'T-file.15 retry after failure -> first attempt cleaned up, second attempt leaves exactly one separator + one number (aux [303,304])'); }

// 4) fallback (lesson without course, no archive topic): MATERIALS, ONE message (metadata + separator + old details) — unchanged apart from the unified separator
{ const { r, j, w } = await run({ noCourse: true }, {});
  const doc = w.tg.find(x => x.m === 'sendDocument');
  ok(r.status === 200 && j.url === 'https://t.me/c/4337039125/5/321' && seq(w).join(',') === 'sendDocument', 'T-file.16 fallback: MATERIALS (5), single message (no topic -> no numbering/index)');
  const OLD = '<b>T</b>\nالقسم: مصدر بديل\nالكورس: C\nالوحدة: U\nالدرس: L\n\n\n\n#مصدر_بديل #C #U #L #PDF';
  ok(doc.body.caption === META_L + '\n\n' + SEP + '\n\n' + OLD, 'T-file.17 fallback caption = metadata + unified separator + the full old caption');
  ok(String(doc.body.message_thread_id) === '5' && JSON.stringify(w.upserts[0].aux_message_ids ?? []) === '[]', 'T-file.18 fallback: MATERIALS thread, no aux messages'); }
// 5) fallback caption hygiene: blank title, escaping, 1024 limit
{ const { w } = await run({ noCourse: true }, { title: '\u200b \u3164', file_name: '\u200b' });
  const c = w.tg.find(x => x.m === 'sendDocument').body.caption;
  ok((c.match(/<blockquote>/g) || []).length === 1 && !/<blockquote>\s*<\/blockquote>/.test(c) && c.startsWith('<blockquote>#'), 'T-file.19 blank title -> no empty blockquote'); }
{ const { w } = await run({ noCourse: true }, { title: '<b>x</b> & y' });
  const c = w.tg.find(x => x.m === 'sendDocument').body.caption;
  ok(c.includes('<blockquote>&lt;b&gt;x&lt;/b&gt; &amp; y</blockquote>'), 'T-file.20 title is HTML-escaped in the caption'); }
{ const { r, w } = await run({ noCourse: true }, { publisher: 'p'.repeat(2000), language: 'ar' });
  const c = w.tg.find(x => x.m === 'sendDocument').body.caption;
  ok(r.status === 200 && c.replace(/<[^>]+>/g, '').length <= 1024 && c.startsWith(META_L) && !/ppp/.test(c), 'T-file.21 caption never exceeds 1024; oversized publisher dropped'); }

// 6) University subject with a year group: subject topic, same three messages
{ const { r, j, w } = await run({ kind: 'subject' }, { kind: 'subject', ref_id: 'S1', title: 'Lecture 1' });
  const msgs = w.tg.filter(x => x.m === 'sendMessage');
  ok(r.status === 200 && j.url === 'https://t.me/c/2222/55/321' && seq(w).join(',') === 'sendMessage,sendMessage,sendDocument' && msgs.every(x => String(x.body.message_thread_id) === '55'), 'T-uni.1 university file -> the SUBJECT topic (55): separator, "Lecture 1 | 4", file (not a course topic)');
  ok(msgs[0].body.text === SEP && msgs[1].body.text === 'Lecture 1 | 4', 'T-uni.2 same unified separator and number message');
  const u = w.upserts[0]; ok(u && u.topic_id === 'TS' && u.episode === 4 && u.episode_code === 'E04' && JSON.stringify(u.aux_message_ids) === '[301,302]', 'T-uni.3 same tracking/indexing data as before (topic, episode) + aux [separator, number]'); }
// 7) University subject without a year group: UNIVERSITY topic fallback kept (single message with the metadata caption)
{ const { r, j, w } = await run({ kind: 'subject', noYearDest: true }, { kind: 'subject', ref_id: 'S1', title: 'Lecture 1' });
  ok(r.status === 200 && j.url === 'https://t.me/c/3333/77/321' && seq(w).join(',') === 'sendDocument' && w.tg.find(x => x.m === 'sendDocument').body.caption.startsWith('<blockquote>#مصدر_بديل #Uni'), 'T-uni.4 no year group -> UNIVERSITY topic (77) fallback unchanged'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
