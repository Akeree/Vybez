// Vybez API entry. One Web-standard handler (Request -> Response) used by the Vercel function
// (api/index.js) and the local dev server (scripts/dev.mjs).
//   lib/http.js      errors, validation, rate limits, router
//   domain/*.js      data and rules (users, music, live, nights, email)
//   routes/*.js      endpoints, grouped by product: auth, account, dj, social
import { routes, HttpError, fail, json, clientIp } from './lib/http.js';
import { sessionCookie, productCookie, getCookie, PRODUCT_COOKIE } from './auth.js';
import { currentUser } from './domain/users.js';
import { invitePage, photoResponse } from './pages.js';
import './routes/auth.js';
import './routes/account.js';
import './routes/dj.js';
import './routes/social.js';
import './routes/group.js';
import { momentResponse } from './domain/group.js';

export async function handle(req) {
  const url = new URL(req.url);
  let path = url.searchParams.get('route');
  if (path === null) path = url.pathname.replace(/^\/api\/?/, '');
  path = path.replace(/^\/+|\/+$/g, '');
  const method = req.method.toUpperCase();
  const cookies = [];
  const secure = url.protocol === 'https:' || (req.headers.get('x-forwarded-proto') || '').includes('https');
  // Invite pages (/i/:code) come through here so link previews show the night (server/pages.js).
  const invite = (method === 'GET' || method === 'HEAD') && /^(?:page\/invite|i)\/([\w-]{1,40})$/.exec(path);
  if (invite) {
    const site = (process.env.SITE_URL || `${secure ? 'https' : 'http'}://${req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host}`).replace(/\/$/, '');
    const page = await invitePage(invite[1], site);
    if (page) return page;
  }
  // Hosts' cover photos (/photo/:night/:version.jpg), public like the invite itself.
  const photo = (method === 'GET' || method === 'HEAD') && /^photo\/([\w-]{1,20})\/(\w{1,20})\.jpg$/.exec(path);
  if (photo) return photoResponse(photo[1], photo[2]);
  // Moments (/moment/:night/:id.jpg): only the list is ever given these long random URLs.
  const moment = (method === 'GET' || method === 'HEAD') && /^moment\/([\w-]{1,20})\/([\w-]{8,32})\.jpg$/.exec(path);
  if (moment) return momentResponse(moment[1], moment[2]);
  try {
    if (method !== 'GET' && method !== 'HEAD') {
      // CSRF: mutating requests must be same-origin JSON.
      const origin = req.headers.get('origin');
      let originHost = null;
      try { originHost = origin ? new URL(origin).host : null; } catch { originHost = 'invalid'; }
      if (origin && originHost !== (req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host)) fail(403, 'Cross-site request blocked.');
      if (!(req.headers.get('content-type') || '').includes('application/json')) fail(415, 'Send JSON.');
    }
    let body = {};
    if (method !== 'GET' && method !== 'HEAD') {
      const text = await req.text();
      // Cover photos arrive as a data URL (about 4/3 of the JPEG's size); everything else is small.
      if (text.length > (/^nights\/[\w-]+\/photo$|^invites\/[\w-]+\/moments$/.test(path) ? 900000 : 300000)) fail(413, 'That’s too much data in one go.');
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
      // Keep the product hint cookie in step with the account: set it whenever a response
      // carries the signed-in user (sign-up, sign-in, reset, /me, profile or product change),
      // clear it on sign-out, deletion, or when /me finds no session.
      const hint = getCookie(req, PRODUCT_COOKIE) || '';
      const signedOut = cookies.some((c) => c.startsWith('vz_session=;'));
      // Only for the caller's own account (never another user's profile).
      if (data && 'user' in data && (!data.user || !ctx.user || data.user.id === ctx.user.id)) {
        const want = data.user?.product || '';
        if (want !== hint) cookies.push(productCookie(want, secure));
      } else if (signedOut && hint) cookies.push(productCookie('', secure));
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
