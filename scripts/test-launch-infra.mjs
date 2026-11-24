// Checks the launch plumbing without touching any real service: node scripts/test-launch-infra.mjs
//  - Preview deployments keep their data apart (key prefix) from live data
//  - Photos go to Vercel Blob (a fake Blob API here) and old base64 photos still load
//  - Server and browser errors reach Sentry (a fake Sentry here) without personal data
//  - /api/health reports all of it, and answers 503 when the database is down
import http from 'node:http';

const blobs = new Map();
const sentry = [];
const seen = { puts: [], deletes: [] };
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  const authed = req.headers.authorization === 'Bearer vercel_blob_rw_teststore_secret';
  if (url.pathname.startsWith('/api/1/envelope')) { sentry.push({ headers: req.headers, lines: body.toString().split('\n').map((l) => JSON.parse(l)) }); return res.end('{}'); }
  if (!authed) { res.statusCode = 403; return res.end('{"error":"forbidden"}'); }
  if (url.pathname === '/blob/' && req.method === 'PUT') {
    const p = url.searchParams.get('pathname');
    seen.puts.push({ p, access: req.headers['x-vercel-blob-access'], suffix: req.headers['x-add-random-suffix'], version: req.headers['x-api-version'] });
    blobs.set(p, body);
    return res.end(JSON.stringify({ url: `http://store/${p}`, pathname: p }));
  }
  if (url.pathname === '/blob/delete' && req.method === 'POST') {
    for (const u of JSON.parse(body).urls) { const p = new URL(u).pathname.replace(/^\/files\//, ''); seen.deletes.push(p); blobs.delete(p); }
    return res.end('{}');
  }
  if (url.pathname.startsWith('/files/') && req.method === 'GET') {
    const b = blobs.get(url.pathname.slice('/files/'.length));
    if (!b) { res.statusCode = 404; return res.end('not found'); }
    return res.end(b);
  }
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

process.env.VYBEZ_STORE = 'memory';
process.env.VERCEL_ENV = 'preview';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_secret';
process.env.VERCEL_BLOB_API_URL = `${base}/blob`;
process.env.VYBEZ_BLOB_HOST = `${base}/files`;
process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${server.address().port}/1`;

const { handle } = await import('../server/api.js');
const { store, prefixed } = await import('../server/store.js');
const { cleanPath } = await import('../server/monitor.js');
const { routes } = await import('../server/lib/http.js');

let failures = 0;
const check = (name, cond, extra) => { if (cond) console.log(`  ok  ${name}`); else { failures++; console.log(`  FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra)); } };
const jar = {};
async function call(method, path, body, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', host: 'localhost:3000', ...extraHeaders };
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.cookie = cookie;
  const res = await handle(new Request(`http://localhost:3000/api/${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }));
  for (const c of res.headers.getSetCookie?.() || []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; }
  return { status: res.status, data: await res.json().catch(() => null) };
}
const raw = (path) => handle(new Request(`http://localhost:3000/api?route=${path}`, { headers: { host: 'localhost:3000' } }));
const jpeg = (n) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 9)]).toString('base64')}`;

// ---------- Preview isolation ----------
check('Preview keys are prefixed', store.prefix === 'preview:' && prefixed(['SET', 'night:1', 'x'])[1] === 'preview:night:1' && prefixed(['SET', 'night:1', 'x'])[2] === 'x');
check('MGET and DEL prefix every key', prefixed(['DEL', 'a', 'b']).slice(1).every((k) => k.startsWith('preview:')) && prefixed(['MGET', 'a', 'b']).slice(1).every((k) => k.startsWith('preview:')));

let r = await call('GET', 'health');
check('health: storage answers, Preview isolated, Blob and Sentry on', r.status === 200 && r.data.ok && r.data.isolated === true && r.data.photos === 'blob' && r.data.errorTracking === true && r.data.env === 'preview', r.data);

r = await call('POST', 'auth/signup', { email: 'host@infra.dev', password: 'longenough1', name: 'Infra Host', product: 'social' });
check('sign up on Preview', r.status === 200, r.data);
r = await call('POST', 'nights', { title: 'Blob night', when: '2031-01-10T20:00', place: '1 Test St', area: 'Yaba', cap: 10, approve: false });
const night = r.data.night;
check('night created on Preview', !!night?.id && !!(await store.getJSON(`night:${night.id}`)));

// ---------- Photos in Blob ----------
r = await call('PUT', `nights/${night.id}/photo`, { image: jpeg(3000) });
const v1 = r.data.night.photo;
check('cover photo goes to Blob as a private file under preview/', seen.puts.length === 1 && seen.puts[0].p === `preview/cover/${night.id}/${v1}.jpg` && seen.puts[0].access === 'private' && seen.puts[0].suffix === '0', seen.puts);
check('nothing big is left in the key-value store', !(await store.cmd('GET', `file:cover/${night.id}/${v1}.jpg`)) && !(await store.cmd('GET', `photo:${night.id}`)));
let img = await raw(`photo/${night.id}/${v1}.jpg`);
check('cover photo is served from Blob', img.status === 200 && (await img.arrayBuffer()).byteLength === 3004 && /immutable/.test(img.headers.get('cache-control')));
r = await call('PUT', `nights/${night.id}/photo`, { image: jpeg(4000) });
const v2 = r.data.night.photo;
check('replacing the cover deletes the old file', seen.deletes.includes(`preview/cover/${night.id}/${v1}.jpg`) && blobs.has(`preview/cover/${night.id}/${v2}.jpg`), seen.deletes);

// A photo saved before Blob (base64 under photo:<id>) still loads.
const legacy = await call('POST', 'nights', { title: 'Old photo night', when: '2031-01-11T20:00', place: '2 Test St', area: 'Yaba', cap: 10 });
const ln = legacy.data.night;
const lnStored = await store.getJSON(`night:${ln.id}`);
await store.setJSON(`night:${ln.id}`, { ...lnStored, photo: 'oldver', cover: 'photo' });
await store.cmd('SET', `photo:${ln.id}`, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(600, 1)]).toString('base64'));
img = await raw(`photo/${ln.id}/oldver.jpg`);
check('a pre-Blob photo still loads', img.status === 200 && (await img.arrayBuffer()).byteLength === 603);

// Moments
const guest = (await call('POST', `invites/${night.code}/rsvp`, { name: 'Ada Okafor' })).data.guest;
r = await call('POST', `invites/${night.code}/moments`, { guest, image: jpeg(2000), w: 1080, h: 1080 });
const mid = r.data.moment?.id;
check('moment goes to Blob', r.status === 200 && blobs.has(`preview/moment/${night.id}/${mid}.jpg`), r.data);
img = await raw(r.data.moment.url.slice(1));
check('moment is served from Blob', img.status === 200 && (await img.arrayBuffer()).byteLength === 2004);
r = await call('DELETE', `invites/${night.code}/moments/${mid}`, { guest });
check('removing a moment deletes its file', r.status === 200 && !blobs.has(`preview/moment/${night.id}/${mid}.jpg`));
r = await call('POST', `invites/${night.code}/moments`, { guest, image: jpeg(2000) });
const mid2 = r.data.moment.id;
r = await call('DELETE', `nights/${night.id}`);
check('deleting a night deletes its cover and moments', r.status === 200 && !blobs.has(`preview/cover/${night.id}/${v2}.jpg`) && !blobs.has(`preview/moment/${night.id}/${mid2}.jpg`), [...blobs.keys()]);

// ---------- Errors ----------
check('paths lose ids, codes and handles', cleanPath('/api/invites/ab12cd/moments') === '/api/invites/:id/moments' && cleanPath('/u/kemi-lagos?x=1') === '/u/:id' && cleanPath('/social/abc123/door') === '/social/:id/door', [cleanPath('/api/invites/ab12cd/moments'), cleanPath('/u/kemi-lagos?x=1')]);
routes.push({ method: 'GET', pattern: 'boom/:id', re: /^boom\/([^/]+)$/, keys: ['id'], fn: async () => { throw new TypeError('kaboom for someone@example.com'); } });
r = await call('GET', 'boom/secret-token-123?email=x@y.z');
const ev = sentry.at(-1)?.lines[2];
check('a server error answers 500 and reaches Sentry', r.status === 500 && ev?.exception.values[0].type === 'TypeError' && ev.environment === 'preview' && ev.platform === 'node', ev);
check('the Sentry event has no token, query or cookie', ev && !JSON.stringify(ev).includes('secret-token-123') && !JSON.stringify(ev).includes('x@y.z') && !JSON.stringify(ev).includes('vz_session') && /^GET \/api\//.test(ev.transaction), ev?.transaction);
check('Sentry auth header uses the DSN key', /sentry_key=publickey/.test(sentry.at(-1)?.headers['x-sentry-auth'] || ''));
const before = sentry.length;
r = await call('POST', 'client-error', { type: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at render (https://vybez.app/js/pages/social.js:10:5)\nrender@https://vybez.app/js/pages/social.js:10:5', page: '/social/n1abc/door' });
const cev = sentry.at(-1)?.lines[2];
check('a browser crash reaches Sentry', r.status === 200 && sentry.length === before + 1 && cev.platform === 'javascript' && cev.transaction === '/social/:id/door' && cev.exception.values[0].stacktrace.frames.length === 2, cev);
for (let i = 0; i < 25; i++) await call('POST', 'client-error', { message: 'spam' }, { 'x-forwarded-for': '9.9.9.9' });
check('browser reports are rate limited', sentry.length - before - 1 === 20, sentry.length - before - 1);

// ---------- Health when the database is down ----------
const realCmd = store.cmd;
store.cmd = async () => { throw new Error('Storage error: down'); };
const down = await handle(new Request('http://localhost:3000/api/health', { headers: { host: 'localhost:3000' } })); // monitors send no cookies
r = { status: down.status, data: await down.json() };
store.cmd = realCmd;
check('health answers 503 when the database is down', r.status === 503 && r.data.storageOk === false, r.data);

server.close();
console.log(failures ? `\n${failures} failed` : '\nAll launch plumbing checks passed');
process.exit(failures ? 1 : 0);
