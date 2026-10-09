import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
const SEP = '───────── ✦ ─────────';
const META_L = '<blockquote>#مصدر_بديل #C #U\n#L</blockquote>\n\n<blockquote>T</blockquote>';

function world(o = {}) {
  let sid = 300;
  const w = { user: { id: 'u1' }, tg: [], rpcs: [], upserts: [], blob: new Blob(['x']),
    tgReply: (m) => m === 'sendDocument' || m === 'sendVideo' ? { ok: true, result: { message_id: 321 } } : (m === 'sendMessage' ? { ok: true, result: { message_id: ++sid } } : { ok: true, result: {} }),
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

// ONE-MESSAGE layout: caption = [metadata quotes] blank SEP blank "القسم | رقم"; exactly one Telegram message per resource
const CAP = META_L + '\n\n' + SEP + '\n\nT | 4';

// 1) PDF into the course topic: a single sendDocument carrying metadata + separator + archive heading
{ const { r, j, w } = await run({}, {});
  const doc = w.tg.find(x => x.m === 'sendDocument');
  ok(r.status === 200 && j.url === 'https://t.me/c/4337039125/107/321' && j.tracked === true, 'T-file.1 PDF goes to the COURSE topic (107), link returned');
  ok(seq(w).join(',') === 'sendDocument' && !w.tg.some(x => x.m === 'sendMessage'), 'T-file.2 ONE Telegram message created (sendDocument only; no meta/separator/heading messages)');
  ok(doc && doc.body.caption === CAP && doc.body.parse_mode === 'HTML', 'T-file.3 caption = [quote tags][quote title] / separator / "T | 4" (old "اسم المصدر | رقم" heading kept)');
  ok(doc && String(doc.body.message_thread_id) === '107', 'T-file.5 file sent into topic 107 as document');
  const u = w.upserts[0];
  ok(u && u.kind === 'file' && u.created_by === 'u1' && u.message_id === 321 && u.thread_id === 107 && u.topic_id === 'TOPIC1' && u.section === 'T' && u.episode === 4 && u.episode_code === 'E04' && !!u.claim_deadline, 'T-file.6 tracking unchanged: kind=file, topic, section, episode E04 (old indexing data)');
  ok(JSON.stringify(u.aux_message_ids) === JSON.stringify([]), 'T-file.7 aux_message_ids = [] (nothing extra to clean; cleanup deletes the single message)');
  ok(w.tg.some(x => x.m === 'editMessageText' && /الفهرس/.test(x.body.text)), 'T-file.8 pinned index message is still rebuilt (old indexing runs)');
  ok(w.rpcs.filter(x => x.n === 'next_episode').length === 1, 'T-file.8b numbering still via next_episode (unchanged)'); }

// 2) video: same system, sendVideo preserved, caption identical, still one message
{ const { r, w } = await run({}, { file_name: 'a.mp4', mime_type: 'video/mp4' });
  const v = w.tg.find(x => x.m === 'sendVideo');
  ok(r.status === 200 && seq(w).join(',') === 'sendVideo' && v.body.supports_streaming === 'true' && v.body.caption === CAP, 'T-file.9 video: ONE sendVideo message with the same caption (streaming kept)'); }
// 2b) photo
{ const { r, w } = await run({}, { file_name: 'a.png', mime_type: 'image/png' });
  ok(r.status === 200 && seq(w).join(',') === 'sendPhoto' && w.tg.find(x => x.m === 'sendPhoto').body.caption === CAP, 'T-file.9b photo: one sendPhoto message with the caption'); }
// 2c) Telegram refuses the video -> falls back to document, still one message in the end
{ const w0 = world({}); const orig = w0.tgReply; w0.tgReply = (m) => m === 'sendVideo' ? { ok: false, description: 'Bad Request: wrong file' } : orig(m);
  const h = await loadFn('telegram-upload-resource', w0); const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); w0.tg.push({ m, body: init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : (init?.body ? JSON.parse(init.body) : null) }); return { json: async () => w0.tgReply(m), status: 200 }; };
  const r = await call(h, mk({ file_name: 'a.mp4', mime_type: 'video/mp4' })); globalThis.fetch = f0;
  ok(r.status === 200 && w0.tg.filter(x => x.m === 'sendDocument').length === 1 && w0.tg.find(x => x.m === 'sendDocument').body.caption === CAP, 'T-file.9c video rejected -> document fallback keeps the same caption'); }

// 3) failure after the file was sent: only the file is deleted + episode released (no orphan helper messages exist anymore)
{ const { r, w } = await run({ trackFails: true }, {});
  ok(r.status === 500 && w.tg.filter(x => x.m === 'deleteMessage').length === 1 && w.tg.find(x => x.m === 'deleteMessage').body.message_id === 321 && w.rpcs.some(x => x.n === 'release_episode'), 'T-file.10 tracking failure -> the file message deleted + episode released'); }
// 3b) Telegram rejects the file: nothing created, episode released, temp file kept for retry
{ const w0 = world({}); const orig = w0.tgReply; w0.tgReply = (m) => (m === 'sendDocument' ? { ok: false, description: 'Bad Request: x' } : orig(m));
  const h = await loadFn('telegram-upload-resource', w0); const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); w0.tg.push({ m, body: null }); return { json: async () => w0.tgReply(m), status: 200 }; };
  const r = await call(h, mk()); globalThis.fetch = f0;
  ok(r.status === 502 && w0.rpcs.some(x => x.n === 'release_episode') && w0.upserts.length === 0, 'T-file.10b send failure -> 502, episode released, nothing tracked'); }

// 4) fallback (lesson without course): MATERIALS topic, ONE message (meta + separator + old details) with the file
{ const { r, j, w } = await run({ noCourse: true }, {});
  const doc = w.tg.find(x => x.m === 'sendDocument');
  ok(r.status === 200 && j.url === 'https://t.me/c/4337039125/5/321' && seq(w).join(',') === 'sendDocument', 'T-file.11 fallback: MATERIALS (5), ONE message (no separate header message)');
  const OLD = '<b>T</b>\nالقسم: مصدر بديل\nالكورس: C\nالوحدة: U\nالدرس: L\n\n\n\n#مصدر_بديل #C #U #L #PDF';
  ok(doc.body.caption === META_L + '\n\n' + SEP + '\n\n' + OLD, 'T-file.12 fallback caption = NEW metadata + separator + the FULL OLD caption (bold title, القسم, context, tag line with #PDF) unchanged');
  ok(String(doc.body.message_thread_id) === '5' && JSON.stringify(w.upserts[0].aux_message_ids ?? []) === '[]', 'T-file.12b fallback: MATERIALS thread, no aux messages'); }

// 5) empty / junk title -> never an empty blockquote
{ const { w } = await run({}, { title: '\u200b \u3164', file_name: '\u200b' });
  const c = w.tg.find(x => x.m === 'sendDocument').body.caption;
  ok((c.match(/<blockquote>/g) || []).length === 1 && !/<blockquote>\s*<\/blockquote>/.test(c) && c.startsWith('<blockquote>#'), 'T-file.13 invisible/blank title -> only the tags quote, no empty blockquote'); }
// 5b) HTML in the title is escaped
{ const { w } = await run({}, { title: '<b>x</b> & y' });
  const c = w.tg.find(x => x.m === 'sendDocument').body.caption;
  ok(c.includes('<blockquote>&lt;b&gt;x&lt;/b&gt; &amp; y</blockquote>') && !c.includes('<b>'), 'T-file.13b title is HTML-escaped inside the caption'); }
// 5c) caption limit: oversized details are dropped, never exceed 1024 visible chars, metadata kept
{ const { r, w } = await run({ noCourse: true }, { publisher: 'p'.repeat(2000), language: 'ar' });
  const c = w.tg.find(x => x.m === 'sendDocument').body.caption;
  ok(r.status === 200 && c.replace(/<[^>]+>/g, '').length <= 1024 && c.startsWith(META_L) && !/ppp/.test(c), 'T-file.13c caption never exceeds 1024; oversized publisher dropped, metadata kept'); }

// 6) University subject with a year group: subject topic, same one-message layout (university tags)
{ const { r, j, w } = await run({ kind: 'subject' }, { kind: 'subject', ref_id: 'S1', title: 'Lecture 1' });
  const doc = w.tg.find(x => x.m === 'sendDocument');
  ok(r.status === 200 && j.url === 'https://t.me/c/2222/55/321' && String(doc.body.message_thread_id) === '55', 'T-uni.1 university file -> the SUBJECT topic (55) in the year group, not a course topic');
  ok(seq(w).join(',') === 'sendDocument' && doc.body.caption === '<blockquote>#مصدر_بديل #Uni #CS #Year_1 #Sem1\n#OS</blockquote>\n\n<blockquote>Lecture 1</blockquote>\n\n' + SEP + '\n\nLecture 1 | 4', 'T-uni.2 ONE message: university/program/year/semester/subject hashtags, separator, "Lecture 1 | 4"');
  const u = w.upserts[0]; ok(u && u.topic_id === 'TS' && u.episode === 4 && u.episode_code === 'E04' && JSON.stringify(u.aux_message_ids) === '[]', 'T-uni.3 same tracking/indexing data as before (topic, episode), aux empty'); }
// 7) University subject without a year group: UNIVERSITY topic fallback kept
{ const { r, j, w } = await run({ kind: 'subject', noYearDest: true }, { kind: 'subject', ref_id: 'S1', title: 'Lecture 1' });
  ok(r.status === 200 && j.url === 'https://t.me/c/3333/77/321' && seq(w).join(',') === 'sendDocument' && w.tg.find(x => x.m === 'sendDocument').body.caption.startsWith('<blockquote>#مصدر_بديل #Uni'), 'T-uni.4 no year group -> UNIVERSITY topic (77) fallback, ONE message'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
