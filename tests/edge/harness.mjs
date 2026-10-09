import fs from 'node:fs';
export async function loadFn(name, world) {
  let src = fs.readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  src = src.replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";/, 'const createClient = globalThis.__createClient;');
  const f = `/tmp/${name}-${Math.random().toString(36).slice(2)}.mts`;
  fs.writeFileSync(f, src);
  globalThis.__world = world;
  globalThis.__createClient = (url, key, opts) => {
    if (opts?.global?.headers) return { auth: { getUser: async () => world.user ? ({ data: { user: world.user }, error: null }) : ({ data: null, error: { message: 'bad' } }) } };
    const mk = (table) => {
      const st = { table, filters: {}, op: 'select', payload: null };
      const self = new Proxy({}, { get(_, p) {
        if (p === 'then') return (res, rej) => Promise.resolve(world.resolve(st, false)).then(res, rej);
        if (p === 'maybeSingle' || p === 'single') return () => Promise.resolve(world.resolve(st, true));
        if (['update', 'upsert', 'insert', 'delete'].includes(p)) return (a) => { st.op = p; st.payload = a; return self; };
        return (...a) => { if (['eq', 'is', 'lt', 'gte', 'gt', 'in', 'neq'].includes(p)) st.filters[a[0]] = a[1]; return self; };
      } });
      return self;
    };
    return { from: mk, rpc: async (n, a) => world.rpc(n, a), storage: { from: () => ({ remove: async () => ({}), download: async () => (world.blob ? ({ data: world.blob, error: null }) : ({ data: null, error: { message: 'x' } })) }) } };
  };
  globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', TELEGRAM_BOT_TOKEN: 'BOT', CRON_SECRET: 'cron' })[k] }, serve: (h) => { globalThis.__handler = h; } };
  globalThis.fetch = async (u, init) => { const m = String(u).split('/').pop(); const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null; world.tg.push({ m, body }); const r = world.tgReply(m, body); return { json: async () => r, status: 200 }; };
  await import(f);
  return globalThis.__handler;
}
export const call = (h, body, headers = {}) => h(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
