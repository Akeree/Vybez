// Local dev server: builds the site, serves dist/ like Vercel (clean URLs, vercel.json
// rewrites) and runs the API from server/api.js. Data persists in .data/db.json.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--no-build')) execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
const { handle } = await import('../server/api.js');
const dist = join(root, 'dist');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.json': 'application/json' };

function toRegex(source) {
  const keys = [];
  const re = source.replace(/:(\w+)(\*)?/g, (_, k, star) => { keys.push(k); return star ? '(.*)' : '([^/]+)'; });
  return { re: new RegExp(`^${re}$`), keys };
}
const rewrites = (vercel.rewrites || []).map((r) => ({ ...r, ...toRegex(r.source) }));

function fileFor(path) {
  const p = join(dist, decodeURIComponent(path));
  if (!p.startsWith(dist)) return null;
  for (const c of [p, `${p}.html`, join(p, 'index.html')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

async function api(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const r = await handle(request);
  const out = {};
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = r.headers.getSetCookie?.() || [];
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}

const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = fileFor(url.pathname);
    if (!file) {
      for (const r of rewrites) {
        const m = url.pathname.match(r.re);
        if (!m) continue;
        let dest = r.destination;
        r.keys.forEach((k, i) => { dest = dest.replace(new RegExp(`:${k}\\*?`, 'g'), m[i + 1]); });
        const d = new URL(dest, url);
        if (d.pathname.startsWith('/api')) return await api(req, res, url);
        file = fileFor(d.pathname);
        if (file) break;
      }
    }
    const status = file ? 200 : 404;
    file = file || join(dist, '404.html');
    res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Server error');
  }
}).listen(port, () => console.log(`Vybez dev server on http://localhost:${port}`));
