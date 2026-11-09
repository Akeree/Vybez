// Accounts. Every account belongs to one product: 'dj' (Vybez DJ) or 'social' (Vybez Social).
import { store } from '../store.js';
import { readSession, getCookie, COOKIE, randomCode } from '../auth.js';
import { fail, now } from '../lib/http.js';

export const RESERVED = new Set(['api', 'dj', 'social', 'i', 's', 'u', 'live', 'me', 'signin', 'signup', 'login', 'logout', 'admin', 'explore', 'pricing', 'help', 'guides', 'privacy', 'terms', 'settings', 'vybez', 'support', 'forgot', 'reset', 'notifications', 'upgrade', 'onboarding', 'new', 'www']);
export const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

export const DEFAULT_PREFS = {
  visibility: 'public', liveTracklist: true, comments: true, exploreLive: true,
  notify: { rsvp: true, follow: true, comments: true, product: false },
};

// ---------- products ----------
// Accounts made before the split stored role 'dj' or 'listener' ("listen or host").
// 'listener' accounts mostly hosted nights, so they become Vybez Social accounts.
export const PRODUCTS = ['dj', 'social'];
export const productOf = (u) => (u?.product === 'social' || u?.product === 'dj' ? u.product : u?.role === 'dj' ? 'dj' : 'social');
export const readProduct = (v) => (v === 'social' || v === 'listener' ? 'social' : 'dj');
export const PRODUCT_NAME = { dj: 'Vybez DJ', social: 'Vybez Social' };
// Activity types each product shows. Anything else stays in storage but isn't listed.
export const ACTIVITY_TYPES = { dj: ['follow', 'save', 'comment', 'live'], social: ['rsvp'] };

export function publicUser(u) {
  if (!u) return null;
  const product = productOf(u);
  return {
    id: u.id, name: u.name, handle: u.handle, product, role: product === 'dj' ? 'dj' : 'host', bio: u.bio || '', city: u.city || '',
    genres: u.genres || [], links: u.links || {}, software: u.software || '', createdAt: u.createdAt,
  };
}
export function selfUser(u) {
  return { ...publicUser(u), email: u.email, prefs: { ...DEFAULT_PREFS, ...(u.prefs || {}) }, onboarded: !!u.onboarded, plan: u.plan || 'free' };
}

export async function getUser(id) { return id ? store.getJSON(`u:${id}`) : null; }
export async function saveUser(u) { u.updatedAt = now(); await store.setJSON(`u:${u.id}`, u); return u; }
export async function userByHandle(h) {
  const id = await store.cmd('GET', `handle:${String(h).toLowerCase()}`);
  return id ? getUser(id) : null;
}

export async function claimHandle(base, uid) {
  let h = slug(base) || 'dj';
  if (h.length < 3) h = `${h}-dj`;
  if (RESERVED.has(h)) h = `${h}-dj`;
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? h : `${h.slice(0, 20)}-${randomCode(3, '0123456789')}`;
    const ok = await store.cmd('SET', `handle:${candidate}`, uid, 'NX');
    if (ok) return candidate;
  }
  fail(500, 'Could not pick a handle. Try again.');
}

export async function currentUser(req) {
  const s = readSession(getCookie(req, COOKIE));
  if (!s) return null;
  const u = await getUser(s.u);
  if (!u || (u.sv || 1) !== s.v) return null;
  return u;
}

export async function needUser(ctx) {
  if (!ctx.user) fail(401, 'Sign in to do that.');
  return ctx.user;
}

// Signed in AND on the right product. A Vybez Social account can't use DJ tools and the
// other way round; each sees only its own side. Public pages (sets, profiles, live rooms,
// invites) stay open to everyone, signed in or not.
export async function needProduct(ctx, product) {
  const u = await needUser(ctx);
  if (productOf(u) !== product) {
    fail(403, product === 'dj'
      ? 'That’s part of Vybez DJ. This is a Vybez Social account.'
      : 'That’s part of Vybez Social. This is a Vybez DJ account.', { product: productOf(u) });
  }
  return u;
}

// Keep the public DJ index (Explore) in step with the account's product.
export async function syncDjIndex(u) {
  await store.cmd(productOf(u) === 'dj' ? 'SADD' : 'SREM', 'djs', u.id);
}

export async function activity(uid, item) {
  if (!uid) return;
  const k = `u:${uid}:activity`;
  await store.pipe([['LPUSH', k, JSON.stringify({ ...item, at: now() })], ['LTRIM', k, 0, 199]]);
}
