import { loadFn, call } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + l); };
function world(trackFails) {
  const w = { user: { id: 'u1' }, tg: [], rpcs: [], upserts: [], blob: new Blob(['x']),
    tgReply: (m) => m === 'sendDocument' ? { ok: true, result: { message_id: 321 } } : { ok: true, result: {} },
    rpc: async (n, a) => { w.rpcs.push(n); if (n === 'is_super_admin') return { data: true }; return { data: null }; },
    resolve: (st) => {
      if (st.table === 'lessons') return { data: { title: 'L', units: { title: 'U', course_id: 'c1', courses: { name: 'C' } } } };
      if (st.table === 'archive_destinations') return { data: [{ id: 'd1', telegram_chat_id: '-1004337039125', university_id: null, year_id: null }] };
      if (st.table === 'archive_topics') return { data: [{ topic_key: 'materials', telegram_thread_id: 5 }] };
      if (st.table === 'telegram_resource_files' && st.op === 'upsert') { w.upserts.push(st.payload); return { error: trackFails ? { message: 'db down' } : null }; }
      return { data: null };
    } };
  return w;
}
const body = { action: 'send', kind: 'lesson', ref_id: 'L1', title: 'T', file_name: 'a.pdf', mime_type: 'application/pdf', storage_path: 'u1/resource-uploads/x.pdf' };
// FormData upload path: patch fetch to accept FormData
async function run(trackFails) {
  const w = world(trackFails); const h = await loadFn('telegram-upload-resource', w);
  const f0 = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); w.tg.push({ m, body: init?.body instanceof FormData ? null : (init?.body ? JSON.parse(init.body) : null) }); return { json: async () => w.tgReply(m), status: 200 }; };
  const r = await call(h, body); const j = await r.json(); globalThis.fetch = f0; return { r, j, w };
}
{ const { r, j, w } = await run(false);
  ok(r.status === 200 && j.url === 'https://t.me/c/4337039125/5/321' && j.tracked === true, 'T-file.1 file upload still works and returns the message link');
  const u = w.upserts[0]; ok(u && u.kind === 'file' && u.created_by === 'u1' && u.message_id === 321 && u.chat_id === -1004337039125 && !!u.claim_deadline && new Date(u.claim_deadline) > new Date(), 'T-file.2 tracking row has explicit kind=file, creator, chat+message id, future claim_deadline'); }
{ const { r, j, w } = await run(true);
  ok(r.status === 500 && w.tg.some(x => x.m === 'deleteMessage'), 'T-file.3 tracking failure -> message just sent is deleted and the admin gets an error (no silent untracked message)'); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
