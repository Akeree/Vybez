// HTTP plumbing shared by every route: errors, JSON responses, input validation,
// rate limiting and the tiny router.
import { store } from '../store.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function str(v, { max = 200, min = 0, name = 'This field', required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') fail(400, `${name} should be text.`);
  v = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (required && !v) fail(400, `${name} is required.`);
  if (v && v.length < min) fail(400, `${name} should be at least ${min} characters.`);
  if (v.length > max) fail(400, `${name} should be ${max} characters or fewer.`);
  return v;
}
export const bool = (v, d = false) => (v === undefined ? d : !!v);
export const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const now = () => Date.now();
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

export async function rateLimit(key, limit, windowSec) {
  const k = `rl:${key}:${Math.floor(now() / (windowSec * 1000))}`;
  const [n] = await store.pipe([['INCR', k], ['EXPIRE', k, windowSec + 5]]);
  if (n > limit) fail(429, 'Too many tries. Wait a few minutes and try again.');
}

// ---------- router ----------
export const routes = [];
export const route = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, fn });
};
