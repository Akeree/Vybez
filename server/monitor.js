// Error tracking. When SENTRY_DSN is set, every unexpected API error (the ones that return
// "Something went wrong on our side") and every crash in a visitor's browser is sent to Sentry,
// which emails you and groups repeats. Without SENTRY_DSN this only logs to Vercel → Logs.
// No dependencies: events go to Sentry's envelope endpoint with fetch.
// Privacy: no cookies, request bodies, query strings, emails or IP addresses are sent. Only the
// error, its stack, the method and path, and which deployment it came from.
import crypto from 'node:crypto';
import { routes } from './lib/http.js';

function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!u.username || !project) return null;
    return { key: u.username, url: `${u.protocol}//${u.host}/api/${project}/envelope/`, dsn };
  } catch { return null; }
}
const DSN = parseDsn(process.env.SENTRY_DSN || '');
export const errorTrackingOn = () => !!DSN;

const ENV = process.env.VERCEL_ENV || 'development';
const RELEASE = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || undefined;

// Paths keep their shape but lose ids, codes, handles and tokens: only words that appear in the
// API's own routes or the site's page names survive. /api/invites/ab12cd/moments -> /api/invites/:id/moments
const PAGE_WORDS = ['api', 'i', 'u', 's', 'live', 'social', 'dj', 'group', 'door', 'sets', 'moment', 'photo', 'v', 'signin', 'signup', 'reset', 'forgot', 'settings', 'notifications', 'plan', 'nights', 'help', 'privacy', 'terms', 'pricing', 'explore', 'welcome', 'me', 'following', 'library', 'crates', 'insights', 'golive', 'connections', 'dashboard', 'upgrade'];
let words = null;
export function cleanPath(path) {
  if (!words) words = new Set([...PAGE_WORDS, ...routes.flatMap((r) => r.pattern.split('/').filter((w) => w && !w.startsWith(':')))]);
  const p = String(path || '').split(/[?#]/)[0];
  return p.split('/').map((seg) => (!seg || words.has(seg) ? seg : ':id')).join('/').slice(0, 200);
}

function frames(stack) {
  // V8 ("at fn (file:1:2)") and Safari/Firefox ("fn@file:1:2") lines; the message line matches neither.
  return String(stack || '').split('\n').slice(0, 30).reverse().map((line) => {
    const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()) || /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line.trim());
    return m ? { function: m[1] || '?', filename: m[2].replace(/^.*\/(server|api|js)\//, '$1/'), lineno: +m[3], colno: +m[4], in_app: !m[2].includes('node:') } : null;
  }).filter(Boolean);
}

async function send(event) {
  if (!DSN) return;
  const id = crypto.randomUUID().replace(/-/g, '');
  const body = [
    JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn: DSN.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify({ event_id: id, timestamp: Date.now() / 1000, environment: ENV, release: RELEASE, server_name: 'vybez', level: 'error', ...event }),
  ].join('\n');
  try {
    await fetch(DSN.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${DSN.key}, sentry_client=vybez/1.0` },
      body,
      signal: AbortSignal.timeout(2500),
    });
  } catch { /* never let reporting break a request */ }
}

// A server error. req is the incoming Request (only its method and path are used).
export async function reportError(err, req) {
  console.error(err);
  const e = err instanceof Error ? err : new Error(String(err));
  let path = '';
  try { path = cleanPath(new URL(req.url).searchParams.get('route') ? `/api/${new URL(req.url).searchParams.get('route')}` : new URL(req.url).pathname); } catch { /* no request */ }
  await send({
    platform: 'node',
    transaction: req ? `${req.method} ${path}` : undefined,
    tags: { side: 'server' },
    exception: { values: [{ type: e.name || 'Error', value: String(e.message).slice(0, 500), stacktrace: { frames: frames(e.stack) } }] },
  });
}

// A crash in someone's browser, posted by src/js/site.js to /api/client-error.
export async function reportClientError(b, ua) {
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  await send({
    platform: 'javascript',
    transaction: cleanPath(s(b.page, 200)),
    tags: { side: 'browser', browser: s(ua, 200) },
    exception: { values: [{ type: s(b.type, 80) || 'Error', value: s(b.message, 500), stacktrace: { frames: frames(s(b.stack, 4000)) } }] },
  });
}
