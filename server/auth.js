// Passwords (scrypt) and signed session cookies. No dependencies.
import crypto from 'node:crypto';

const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
// SESSION_SECRET wins. Otherwise derive a stable secret from the storage token so a fresh
// Vercel project works with one setup step (adding Upstash). Local dev uses a fixed secret.
const SECRET = process.env.SESSION_SECRET
  || (TOKEN ? crypto.createHash('sha256').update(`vybez-session:${TOKEN}`).digest('hex') : 'vybez-local-dev-secret');

export const COOKIE = 'vz_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return { salt, hash };
}

export function checkPassword(password, pw) {
  if (!pw?.salt || !pw?.hash) return false;
  const want = Buffer.from(pw.hash, 'base64url');
  const got = crypto.scryptSync(password, pw.salt, 64, { N: 16384, r: 8, p: 1 });
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ u: user.id, v: user.sv || 1, e: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(value) {
  if (!value || !value.includes('.')) return null;
  const [payload, sig] = value.split('.');
  const want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return s.e > Date.now() ? s : null;
  } catch { return null; }
}

export function sessionCookie(value, secure) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${value ? MAX_AGE : 0}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const randomId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomCode(len = 6, alphabet = ALPHA) {
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}
