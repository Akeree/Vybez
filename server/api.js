// Vybez API entry. One Web-standard handler (Request -> Response) used by the Vercel function
// (api/index.js) and the local dev server (scripts/dev.mjs).
//   lib/http.js      errors, validation, rate limits, router
//   domain/*.js      data and rules (users, music, live, nights, email)
//   routes/*.js      endpoints, grouped by product: auth, account, dj, social
import { routes, HttpError, fail, json, clientIp } from './lib/http.js';
import { sessionCookie } from './auth.js';
import { currentUser } from './domain/users.js';
import './routes/auth.js';
import './routes/account.js';
import './routes/dj.js';
import './routes/social.js';

export async function handle(req) {
  const url = new URL(req.url);
  let path = url.searchParams.get('route');
  if (path === null) path = url.pathname.replace(/^\/api\/?/, '');
  path = path.replace(/^\/+|\/+$/g, '');
  const method = req.method.toUpperCase();
  const cookies = [];
  const secure = url.protocol === 'https:' || (req.headers.get('x-forwarded-proto') || '').includes('https');
  try {
    if (method !== 'GET' && method !== 'HEAD') {
      // CSRF: mutating requests must be same-origin JSON.
      const origin = req.headers.get('origin');
      if (origin && new URL(origin).host !== (req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host)) fail(403, 'Cross-site request blocked.');
      if (!(req.headers.get('content-type') || '').includes('application/json')) fail(415, 'Send JSON.');
    }
    let body = {};
    if (method !== 'GET' && method !== 'HEAD') {
      const text = await req.text();
      if (text.length > 300000) fail(413, 'That’s too much data in one go.');
      try { body = text ? JSON.parse(text) : {}; } catch { fail(400, 'Invalid JSON.'); }
      if (!body || typeof body !== 'object') body = {};
    }
    const ctx = {
      req, body, query: url.searchParams, ip: clientIp(req), origin: `${secure ? 'https' : url.protocol.replace(':', '')}://${req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host}`,
      user: await currentUser(req),
      setCookie: (v) => cookies.push(sessionCookie(v, secure)),
    };
    const qs = url.searchParams;
    qs.delete('route');
    let matched = false;
    for (const r of routes) {
      const m = path.match(r.re);
      if (!m) continue;
      matched = true;
      if (r.method !== method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const data = await r.fn(ctx, params);
      const res = json(data);
      cookies.forEach((c) => res.headers.append('Set-Cookie', c));
      return res;
    }
    fail(matched ? 405 : 404, matched ? 'Method not allowed.' : 'Not found.');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...(err.extra || {}) }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong on our side. Try again.' }, 500);
  }
}
