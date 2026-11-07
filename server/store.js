// Storage for the Vybez API. One small key-value interface with three backends:
//  - Upstash Redis over its REST API (production). Set by Vercel's Upstash integration:
//    KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
//  - A JSON file in .data/ for local development (persists between restarts).
//  - Memory, when running on Vercel without Redis. Data can vanish between requests, so
//    /api/health reports it and the app shows a warning.
// No dependencies: Upstash is called with fetch.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

function redisBackend() {
  async function call(body, path = '') {
    const res = await fetch(URL_.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Storage error: ${data.error || res.status}`);
    return data;
  }
  return {
    kind: 'redis',
    async cmd(...args) {
      const d = await call(args.map(String));
      if (d.error) throw new Error(`Storage error: ${d.error}`);
      return d.result;
    },
    async pipe(cmds) {
      if (!cmds.length) return [];
      const d = await call(cmds.map((c) => c.map(String)), '/pipeline');
      return d.map((r) => { if (r.error) throw new Error(`Storage error: ${r.error}`); return r.result; });
    },
  };
}

// A tiny Redis subset in plain JS: strings, sets, lists, counters with expiry.
function localBackend(file) {
  let db = { s: {}, x: {} };
  if (file && existsSync(file)) {
    try { db = JSON.parse(readFileSync(file, 'utf8')); } catch { /* start fresh */ }
  }
  let timer = null;
  const save = () => {
    if (!file || timer) return;
    timer = setTimeout(() => { timer = null; try { writeFileSync(file, JSON.stringify(db)); } catch { /* ignore */ } }, 50);
  };
  const live = (k) => {
    const exp = db.x[k];
    if (exp && exp < Date.now()) { delete db.s[k]; delete db.x[k]; }
    return db.s[k];
  };
  const ops = {
    GET: (k) => { const v = live(k); return typeof v === 'string' ? v : null; },
    MGET: (...ks) => ks.map((k) => ops.GET(k)),
    SET: (k, v, ...opts) => {
      if (opts[0] === 'NX' && live(k) !== undefined) return null;
      db.s[k] = String(v); delete db.x[k];
      const ex = opts.indexOf('EX'); if (ex >= 0) db.x[k] = Date.now() + Number(opts[ex + 1]) * 1000;
      return 'OK';
    },
    DEL: (...ks) => { let n = 0; for (const k of ks) { if (live(k) !== undefined) n++; delete db.s[k]; delete db.x[k]; } return n; },
    INCR: (k) => ops.INCRBY(k, 1),
    INCRBY: (k, by) => { const v = Number(live(k) || 0) + Number(by); db.s[k] = String(v); return v; },
    EXPIRE: (k, sec) => { if (live(k) === undefined) return 0; db.x[k] = Date.now() + Number(sec) * 1000; return 1; },
    SADD: (k, ...m) => { const s = new Set(live(k) || []); const b = s.size; m.forEach((x) => s.add(String(x))); db.s[k] = [...s]; return s.size - b; },
    SREM: (k, ...m) => { const s = new Set(live(k) || []); const b = s.size; m.forEach((x) => s.delete(String(x))); db.s[k] = [...s]; return b - s.size; },
    SMEMBERS: (k) => [...(live(k) || [])],
    SISMEMBER: (k, m) => ((live(k) || []).includes(String(m)) ? 1 : 0),
    SCARD: (k) => (live(k) || []).length,
    LPUSH: (k, ...v) => { const l = live(k) || []; v.forEach((x) => l.unshift(String(x))); db.s[k] = l; return l.length; },
    LRANGE: (k, a, b) => { const l = live(k) || []; const end = Number(b) < 0 ? l.length + Number(b) : Number(b); return l.slice(Number(a), end + 1); },
    LTRIM: (k, a, b) => { const l = live(k) || []; const end = Number(b) < 0 ? l.length + Number(b) : Number(b); db.s[k] = l.slice(Number(a), end + 1); return 'OK'; },
    LLEN: (k) => (live(k) || []).length,
  };
  return {
    kind: file ? 'file' : 'memory',
    async cmd(name, ...args) {
      const op = ops[String(name).toUpperCase()];
      if (!op) throw new Error(`Unsupported command ${name}`);
      const r = op(...args.map(String));
      if (!['GET', 'MGET', 'SMEMBERS', 'SISMEMBER', 'SCARD', 'LRANGE', 'LLEN'].includes(String(name).toUpperCase())) save();
      return r;
    },
    async pipe(cmds) { const out = []; for (const c of cmds) out.push(await this.cmd(...c)); return out; },
  };
}

function pick() {
  if (URL_ && TOKEN) return redisBackend();
  if (process.env.VYBEZ_STORE === 'memory' || process.env.VERCEL) return localBackend(null);
  const dir = join(process.cwd(), '.data');
  mkdirSync(dir, { recursive: true });
  return localBackend(join(dir, 'db.json'));
}

const backend = pick();

export const store = {
  kind: backend.kind,
  cmd: (...a) => backend.cmd(...a),
  pipe: (c) => backend.pipe(c),
  async getJSON(k) { const v = await backend.cmd('GET', k); return v ? JSON.parse(v) : null; },
  async setJSON(k, v, ttlSec) { return ttlSec ? backend.cmd('SET', k, JSON.stringify(v), 'EX', ttlSec) : backend.cmd('SET', k, JSON.stringify(v)); },
  async mgetJSON(keys) {
    if (!keys.length) return [];
    const vals = await backend.cmd('MGET', ...keys);
    return vals.map((v) => (v ? JSON.parse(v) : null));
  },
};
