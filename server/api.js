// Vybez API. One Web-standard handler (Request -> Response) used by the Vercel function
// (api/index.js) and the local dev server (scripts/dev.mjs).
import { store } from './store.js';
import {
  hashPassword, checkPassword, makeSession, readSession, sessionCookie, getCookie, COOKIE, randomId, randomCode,
} from './auth.js';

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function str(v, { max = 200, min = 0, name = 'This field', required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') fail(400, `${name} should be text.`);
  v = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (required && !v) fail(400, `${name} is required.`);
  if (v && v.length < min) fail(400, `${name} should be at least ${min} characters.`);
  if (v.length > max) fail(400, `${name} should be ${max} characters or fewer.`);
  return v;
}
const bool = (v, d = false) => (v === undefined ? d : !!v);
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const now = () => Date.now();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RESERVED = new Set(['api', 'dj', 'social', 'i', 's', 'u', 'live', 'me', 'signin', 'signup', 'login', 'logout', 'admin', 'explore', 'pricing', 'help', 'guides', 'privacy', 'terms', 'settings', 'vybez', 'support', 'forgot', 'reset', 'notifications', 'upgrade', 'onboarding', 'new', 'www']);
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

async function rateLimit(key, limit, windowSec) {
  const k = `rl:${key}:${Math.floor(now() / (windowSec * 1000))}`;
  const [n] = await store.pipe([['INCR', k], ['EXPIRE', k, windowSec + 5]]);
  if (n > limit) fail(429, 'Too many tries. Wait a few minutes and try again.');
}

// ---------- users ----------
const DEFAULT_PREFS = {
  visibility: 'public', liveTracklist: true, comments: true, exploreLive: true,
  notify: { rsvp: true, follow: true, comments: true, product: false },
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, handle: u.handle, role: u.role, bio: u.bio || '', city: u.city || '',
    genres: u.genres || [], links: u.links || {}, software: u.software || '', createdAt: u.createdAt,
  };
}
function selfUser(u) {
  return { ...publicUser(u), email: u.email, prefs: { ...DEFAULT_PREFS, ...(u.prefs || {}) }, onboarded: !!u.onboarded, plan: u.plan || 'free' };
}

async function getUser(id) { return id ? store.getJSON(`u:${id}`) : null; }
async function saveUser(u) { u.updatedAt = now(); await store.setJSON(`u:${u.id}`, u); return u; }
async function userByHandle(h) {
  const id = await store.cmd('GET', `handle:${String(h).toLowerCase()}`);
  return id ? getUser(id) : null;
}

async function claimHandle(base, uid) {
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

async function currentUser(req) {
  const s = readSession(getCookie(req, COOKIE));
  if (!s) return null;
  const u = await getUser(s.u);
  if (!u || (u.sv || 1) !== s.v) return null;
  return u;
}

async function needUser(ctx) {
  if (!ctx.user) fail(401, 'Sign in to do that.');
  return ctx.user;
}

async function activity(uid, item) {
  if (!uid) return;
  const k = `u:${uid}:activity`;
  await store.pipe([['LPUSH', k, JSON.stringify({ ...item, at: now() })], ['LTRIM', k, 0, 199]]);
}

// ---------- tracks ----------
function cleanTracks(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 400).map((t) => ({
    a: str(t?.a ?? t?.artist, { max: 160, name: 'Artist' }),
    t: str(t?.t ?? t?.title, { max: 200, name: 'Track title' }),
    bpm: t?.bpm ? int(t.bpm, 40, 250, undefined) : undefined,
    key: t?.key ? str(t.key, { max: 8 }) : undefined,
    at: t?.at ? str(t.at, { max: 12 }) : undefined,
  })).filter((t) => t.a || t.t);
}

// ---------- sets ----------
const VIS = ['public', 'followers', 'unlisted', 'private'];
async function getSet(id) { return store.getJSON(`set:${id}`); }

async function canView(set, viewer) {
  if (!set) return false;
  if (viewer && viewer.id === set.owner) return true;
  if (set.status !== 'published' || set.visibility === 'private') return false;
  if (set.visibility === 'followers') return !!viewer && !!(await store.cmd('SISMEMBER', `u:${set.owner}:followers`, viewer.id));
  return true;
}

async function setSummary(set) {
  const [saves, comments, ...reacts] = await store.pipe([
    ['SCARD', `set:${set.id}:savedby`], ['LLEN', `set:${set.id}:c`], ...EMOJI.map((e) => ['GET', `set:${set.id}:r:${e}`]),
  ]);
  return { ...set, saves, comments, reactions: Object.fromEntries(EMOJI.map((e, i) => [e, Number(reacts[i] || 0)])) };
}

async function listSets(uid) {
  const ids = await store.cmd('SMEMBERS', `u:${uid}:sets`);
  const sets = (await store.mgetJSON(ids.map((i) => `set:${i}`))).filter(Boolean);
  return sets.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
}

function readSetInput(b, existing = {}) {
  const out = { ...existing };
  if ('title' in b || !existing.id) out.title = str(b.title, { max: 90, name: 'Set name', required: true });
  if ('date' in b) out.date = str(b.date, { max: 10 }).replace(/[^0-9-]/g, '');
  if ('venue' in b) out.venue = str(b.venue, { max: 80, name: 'Venue' });
  if ('source' in b) out.source = str(b.source, { max: 40 });
  if ('notes' in b) out.notes = str(b.notes, { max: 1000, name: 'Notes' });
  if ('link' in b) {
    const link = str(b.link, { max: 300, name: 'Link' });
    if (link && !/^https:\/\/(www\.)?(mixcloud\.com|soundcloud\.com|on\.soundcloud\.com|youtube\.com|youtu\.be|music\.apple\.com|open\.spotify\.com)\//.test(link)) fail(400, 'Links can point to Mixcloud, SoundCloud, YouTube, Apple Music or Spotify.');
    out.link = link;
  }
  if ('visibility' in b) out.visibility = VIS.includes(b.visibility) ? b.visibility : 'public';
  if ('status' in b) out.status = b.status === 'published' ? 'published' : 'draft';
  if ('tracks' in b) out.tracks = cleanTracks(b.tracks);
  return out;
}

// ---------- reactions ----------
const EMOJI = ['🔥', '🙌', '💃', '❤️', '🤯'];

// ---------- live ----------
async function liveState(uid) { return store.getJSON(`live:${uid}`); }
const BUCKET = 15000;

async function liveView(owner, live, since, viewerKey) {
  const run = live?.startedAt || 0;
  const cmds = EMOJI.map((e) => ['GET', `live:${owner.id}:${run}:r:${e}`]);
  cmds.push(['LRANGE', `live:${owner.id}:feed`, 0, 49]);
  const b = Math.floor(now() / BUCKET);
  cmds.push(['GET', `live:${owner.id}:pv:${b}`], ['GET', `live:${owner.id}:pv:${b - 1}`]);
  const out = await store.pipe(cmds);
  const reactions = Object.fromEntries(EMOJI.map((e, i) => [e, Number(out[i] || 0)]));
  const feed = (out[EMOJI.length] || []).map((x) => JSON.parse(x)).filter((x) => x.at > since && x.run === run).reverse();
  const watching = Math.max(Number(out[EMOJI.length + 1] || 0), Number(out[EMOJI.length + 2] || 0));
  if (viewerKey && live?.on) {
    const seen = await store.cmd('SET', `live:${owner.id}:seen:${viewerKey}:${b}`, '1', 'NX', 'EX', 40);
    if (seen) await store.pipe([['INCR', `live:${owner.id}:pv:${b}`], ['EXPIRE', `live:${owner.id}:pv:${b}`, 60]]);
  }
  return {
    dj: publicUser(owner),
    live: live ? { on: !!live.on, title: live.title, setId: live.setId, startedAt: live.startedAt, endedAt: live.endedAt, now: live.now, played: live.played || [], queue: live.on ? (live.queue || []) : [], comments: live.comments !== false } : { on: false },
    reactions, feed, watching, serverTime: now(),
  };
}

// ---------- nights ----------
async function getNight(id) { return store.getJSON(`night:${id}`); }
async function nightGuests(id) {
  const ids = await store.cmd('SMEMBERS', `night:${id}:g`);
  return (await store.mgetJSON(ids.map((g) => `guest:${g}`))).filter(Boolean).sort((a, b) => a.at - b.at);
}
const headcount = (guests) => guests.filter((g) => g.status === 'going').reduce((n, g) => n + 1 + (g.plus ? 1 : 0), 0);

function readNightInput(b, existing = {}) {
  const n = { ...existing };
  if ('title' in b || !existing.id) n.title = str(b.title, { max: 60, name: 'Name', required: true });
  if ('when' in b || !existing.id) {
    n.when = str(b.when, { max: 16, name: 'Date and time', required: true });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(n.when)) fail(400, 'Pick a date and time.');
  }
  if ('until' in b) n.until = str(b.until, { max: 40, name: 'Until' });
  if ('place' in b || !existing.id) n.place = str(b.place, { max: 160, name: 'Address', required: true });
  if ('area' in b || !existing.id) n.area = str(b.area, { max: 60, name: 'Area', required: true });
  if ('note' in b) n.note = str(b.note, { max: 600, name: 'Note' });
  if ('music' in b) n.music = str(b.music, { max: 60, name: 'Music' });
  if ('cap' in b || !existing.id) n.cap = int(b.cap, 2, 50, 24);
  if ('approve' in b || !existing.id) n.approve = bool(b.approve, true);
  if ('plusOnes' in b || !existing.id) n.plusOnes = bool(b.plusOnes, false);
  if ('songs' in b || !existing.id) n.songs = bool(b.songs, true);
  if ('cover' in b) n.cover = ['rings', 'rooftop', 'dinner', 'living', 'beach', 'owambe', 'crowd'].includes(b.cover) ? b.cover : 'rings';
  if ('status' in b) n.status = b.status === 'cancelled' ? 'cancelled' : 'on';
  return n;
}

function inviteView(night, host, guests, guest) {
  const going = guests.filter((g) => g.status === 'going');
  const count = headcount(guests);
  const view = {
    code: night.code, title: night.title, when: night.when, until: night.until || '', area: night.area, note: night.note || '',
    music: night.music || '', cover: night.cover || 'rings', cap: night.cap, spotsLeft: Math.max(0, night.cap - count),
    approve: night.approve, plusOnes: night.plusOnes, songs: night.songs, status: night.status || 'on',
    host: { name: host?.name || 'Your host', handle: host?.handle },
    going: going.length + going.filter((g) => g.plus).length,
    goingNames: going.slice(0, 3).map((g) => g.name.split(' ')[0]),
  };
  if (guest) {
    view.guest = { name: guest.name, status: guest.status, plus: !!guest.plus, pass: guest.status === 'going' ? guest.pass : null, songs: guest.songs || [], checkedIn: guest.checkedIn || null };
    if (guest.status === 'going') view.place = night.place;
  }
  return view;
}

async function guestFor(night, token) {
  if (!token) return null;
  const gid = await store.cmd('GET', `gtok:${token}`);
  if (!gid) return null;
  const g = await store.getJSON(`guest:${gid}`);
  return g && g.night === night.id ? g : null;
}

// ---------- crates ----------
async function listCrates(uid) {
  const ids = await store.cmd('SMEMBERS', `u:${uid}:crates`);
  return (await store.mgetJSON(ids.map((i) => `crate:${i}`))).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- email (optional) ----------
async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  });
  return res.ok;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, fn });
};

route('GET', 'health', async () => ({
  ok: true,
  storage: store.kind,
  persistent: store.kind !== 'memory',
  email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  sessionSecret: !!process.env.SESSION_SECRET,
}));

// Auth
route('POST', 'auth/signup', async (ctx) => {
  const b = ctx.body;
  const email = str(b.email, { max: 120, name: 'Email', required: true }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
  if (password.length > 200) fail(400, 'That password is too long.');
  const name = str(b.name, { max: 50, name: 'Name', required: true });
  const role = b.role === 'listener' ? 'listener' : 'dj';
  await rateLimit(`signup:${ctx.ip}`, 10, 3600);
  const id = randomId();
  const taken = !(await store.cmd('SET', `email:${email}`, id, 'NX'));
  if (taken) fail(409, 'There’s already an account with that email. Sign in instead.');
  const handle = await claimHandle(b.handle || name, id);
  const user = {
    id, email, name, handle, role, bio: '', city: '', genres: [], links: {}, software: '',
    prefs: DEFAULT_PREFS, onboarded: false, createdAt: now(), sv: 1, pw: hashPassword(password),
  };
  await saveUser(user);
  if (role === 'dj') await store.cmd('SADD', 'djs', id);
  ctx.setCookie(makeSession(user));
  return { user: selfUser(user) };
});

route('POST', 'auth/signin', async (ctx) => {
  const email = str(ctx.body.email, { max: 120, name: 'Email', required: true }).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  await rateLimit(`signin:${ctx.ip}:${email}`, 10, 900);
  const id = await store.cmd('GET', `email:${email}`);
  const user = id && await getUser(id);
  if (!user || !checkPassword(password, user.pw)) fail(401, 'That email and password don’t match.');
  ctx.setCookie(makeSession(user));
  return { user: selfUser(user) };
});

route('POST', 'auth/signout', async (ctx) => { ctx.setCookie(''); return { ok: true }; });

route('POST', 'auth/forgot', async (ctx) => {
  const email = str(ctx.body.email, { max: 120, name: 'Email', required: true }).toLowerCase();
  await rateLimit(`forgot:${ctx.ip}`, 5, 900);
  const id = await store.cmd('GET', `email:${email}`);
  const out = { ok: true, emailSent: false };
  if (id) {
    const token = randomId(24);
    await store.cmd('SET', `reset:${token}`, id, 'EX', 3600);
    const link = `${ctx.origin}/reset?token=${token}`;
    out.emailSent = await sendEmail(email, 'Reset your Vybez password', `Someone asked to reset the password for your Vybez account.\n\nReset it here (the link works for 1 hour):\n${link}\n\nIf this wasn’t you, ignore this email.`);
    // Local development only: there is no email service, so hand the link back.
    if (store.kind === 'file') out.devLink = link;
  }
  out.emailConfigured = !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  return out;
});

route('POST', 'auth/reset', async (ctx) => {
  const token = str(ctx.body.token, { max: 64, required: true, name: 'Reset link' });
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
  const id = await store.cmd('GET', `reset:${token}`);
  const user = id && await getUser(id);
  if (!user) fail(400, 'This reset link has expired. Ask for a new one.');
  user.pw = hashPassword(password);
  user.sv = (user.sv || 1) + 1;
  await saveUser(user);
  await store.cmd('DEL', `reset:${token}`);
  ctx.setCookie(makeSession(user));
  return { user: selfUser(user) };
});

// Me
route('GET', 'me', async (ctx) => {
  if (!ctx.user) return { user: null, storage: store.kind };
  const unread = await unreadCount(ctx.user);
  const live = await liveState(ctx.user.id);
  return { user: selfUser(ctx.user), unread, live: !!live?.on, storage: store.kind };
});

route('PATCH', 'me', async (ctx) => {
  const u = await needUser(ctx);
  const b = ctx.body;
  if ('name' in b) u.name = str(b.name, { max: 50, name: 'Name', required: true });
  if ('bio' in b) u.bio = str(b.bio, { max: 280, name: 'Bio' });
  if ('city' in b) u.city = str(b.city, { max: 60, name: 'City' });
  if ('software' in b) u.software = str(b.software, { max: 30 });
  if ('genres' in b) u.genres = (Array.isArray(b.genres) ? b.genres : []).slice(0, 6).map((g) => str(g, { max: 24 })).filter(Boolean);
  if ('links' in b && b.links && typeof b.links === 'object') {
    const links = {};
    for (const k of ['mixcloud', 'soundcloud', 'instagram', 'youtube']) {
      const v = str(b.links[k], { max: 200, name: `${k} link` });
      if (v && !/^https:\/\//.test(v)) fail(400, 'Links should start with https://');
      if (v) links[k] = v;
    }
    u.links = links;
  }
  if ('onboarded' in b) u.onboarded = !!b.onboarded;
  if ('role' in b) {
    u.role = b.role === 'listener' ? 'listener' : 'dj';
    await store.cmd(u.role === 'dj' ? 'SADD' : 'SREM', 'djs', u.id);
  }
  if ('prefs' in b && b.prefs && typeof b.prefs === 'object') {
    const p = { ...DEFAULT_PREFS, ...(u.prefs || {}) };
    if (VIS.includes(b.prefs.visibility)) p.visibility = b.prefs.visibility;
    for (const k of ['liveTracklist', 'comments', 'exploreLive']) if (k in b.prefs) p[k] = !!b.prefs[k];
    if (b.prefs.notify && typeof b.prefs.notify === 'object') {
      p.notify = { ...p.notify };
      for (const k of ['rsvp', 'follow', 'comments', 'product']) if (k in b.prefs.notify) p.notify[k] = !!b.prefs.notify[k];
    }
    u.prefs = p;
  }
  if ('handle' in b) {
    const h = slug(b.handle);
    if (h !== u.handle) {
      if (h.length < 3) fail(400, 'Handles need at least 3 letters or numbers.');
      if (RESERVED.has(h)) fail(400, 'That handle is reserved. Try another.');
      const ok = await store.cmd('SET', `handle:${h}`, u.id, 'NX');
      if (!ok) fail(409, 'That handle is taken. Try another.');
      await store.cmd('DEL', `handle:${u.handle}`);
      u.handle = h;
    }
  }
  await saveUser(u);
  return { user: selfUser(u) };
});

route('POST', 'me/password', async (ctx) => {
  const u = await needUser(ctx);
  if (!checkPassword(String(ctx.body.current || ''), u.pw)) fail(400, 'Your current password isn’t right.');
  const next = String(ctx.body.next || '');
  if (next.length < 8) fail(400, 'Use at least 8 characters for your new password.');
  u.pw = hashPassword(next);
  u.sv = (u.sv || 1) + 1; // signs out other devices
  await saveUser(u);
  ctx.setCookie(makeSession(u));
  return { ok: true };
});

route('GET', 'me/export', async (ctx) => {
  const u = await needUser(ctx);
  const [sets, crates, nightIds, following, saved] = await Promise.all([
    listSets(u.id), listCrates(u.id), store.cmd('SMEMBERS', `u:${u.id}:nights`), store.cmd('SMEMBERS', `u:${u.id}:following`), store.cmd('SMEMBERS', `u:${u.id}:saved`),
  ]);
  const nights = [];
  for (const id of nightIds) { const n = await getNight(id); if (n) nights.push({ ...n, guests: (await nightGuests(id)).map(({ token, ...g }) => g) }); }
  const followingUsers = (await store.mgetJSON(following.map((i) => `u:${i}`))).filter(Boolean).map((x) => x.handle);
  return { exportedAt: new Date().toISOString(), user: selfUser(u), sets, crates, nights, following: followingUsers, savedSets: saved };
});

route('DELETE', 'me', async (ctx) => {
  const u = await needUser(ctx);
  if (!checkPassword(String(ctx.body.password || ''), u.pw)) fail(400, 'Type your password to confirm.');
  const [setIds, crateIds, nightIds, following, followers] = await Promise.all([
    store.cmd('SMEMBERS', `u:${u.id}:sets`), store.cmd('SMEMBERS', `u:${u.id}:crates`), store.cmd('SMEMBERS', `u:${u.id}:nights`),
    store.cmd('SMEMBERS', `u:${u.id}:following`), store.cmd('SMEMBERS', `u:${u.id}:followers`),
  ]);
  const cmds = [];
  for (const id of setIds) cmds.push(['DEL', `set:${id}`, `set:${id}:c`, `set:${id}:savedby`]);
  for (const id of crateIds) cmds.push(['DEL', `crate:${id}`]);
  for (const id of nightIds) {
    const n = await getNight(id);
    const guests = await nightGuests(id);
    for (const g of guests) cmds.push(['DEL', `guest:${g.id}`, `gtok:${g.token}`, `pass:${id}:${g.pass}`]);
    cmds.push(['DEL', `night:${id}`, `night:${id}:g`]);
    if (n) cmds.push(['DEL', `code:${n.code}`]);
  }
  for (const f of following) cmds.push(['SREM', `u:${f}:followers`, u.id]);
  for (const f of followers) cmds.push(['SREM', `u:${f}:following`, u.id]);
  cmds.push(['SREM', 'djs', u.id], ['SREM', 'live:on', u.id]);
  cmds.push(['DEL', `u:${u.id}`, `email:${u.email}`, `handle:${u.handle}`, `u:${u.id}:sets`, `u:${u.id}:crates`, `u:${u.id}:nights`, `u:${u.id}:following`, `u:${u.id}:followers`, `u:${u.id}:saved`, `u:${u.id}:activity`, `u:${u.id}:readAt`, `live:${u.id}`, `live:${u.id}:feed`]);
  await store.pipe(cmds);
  ctx.setCookie('');
  return { ok: true };
});

route('GET', 'me/saved', async (ctx) => {
  const u = await needUser(ctx);
  const ids = await store.cmd('SMEMBERS', `u:${u.id}:saved`);
  const sets = (await store.mgetJSON(ids.map((i) => `set:${i}`))).filter(Boolean);
  const visible = [];
  for (const s of sets) if (await canView(s, u)) visible.push(s);
  const owners = await store.mgetJSON([...new Set(visible.map((s) => s.owner))].map((i) => `u:${i}`));
  const byId = Object.fromEntries(owners.filter(Boolean).map((o) => [o.id, publicUser(o)]));
  const followIds = await store.cmd('SMEMBERS', `u:${u.id}:following`);
  const following = (await store.mgetJSON(followIds.map((i) => `u:${i}`))).filter(Boolean).map(publicUser);
  const liveIds = new Set(await store.cmd('SMEMBERS', 'live:on'));
  return {
    sets: visible.map((s) => ({ id: s.id, title: s.title, date: s.date, venue: s.venue, tracks: s.tracks.length, dj: byId[s.owner] })),
    following: following.map((f) => ({ ...f, live: liveIds.has(f.id) })),
  };
});

// Notifications
async function unreadCount(u) {
  const [items, readAt] = await store.pipe([['LRANGE', `u:${u.id}:activity`, 0, 49], ['GET', `u:${u.id}:readAt`]]);
  return (items || []).map((x) => JSON.parse(x)).filter((x) => x.at > Number(readAt || 0)).length;
}
route('GET', 'notifications', async (ctx) => {
  const u = await needUser(ctx);
  const [items, readAt] = await store.pipe([['LRANGE', `u:${u.id}:activity`, 0, 99], ['GET', `u:${u.id}:readAt`]]);
  return { items: (items || []).map((x) => JSON.parse(x)), readAt: Number(readAt || 0) };
});
route('POST', 'notifications/read', async (ctx) => {
  const u = await needUser(ctx);
  await store.cmd('SET', `u:${u.id}:readAt`, String(now()));
  return { ok: true };
});

// Sets
route('GET', 'sets', async (ctx) => {
  const u = await needUser(ctx);
  const sets = await listSets(u.id);
  return { sets: await Promise.all(sets.map(setSummary)) };
});

route('POST', 'sets', async (ctx) => {
  const u = await needUser(ctx);
  const count = await store.cmd('SCARD', `u:${u.id}:sets`);
  if (count >= 500) fail(400, 'You’ve reached 500 sets. Delete a few to add more.');
  const set = readSetInput({ visibility: u.prefs?.visibility || 'public', status: 'draft', tracks: [], ...ctx.body });
  set.id = randomId(7); set.owner = u.id; set.createdAt = now(); set.updatedAt = now();
  if (!set.date) set.date = new Date().toISOString().slice(0, 10);
  await store.setJSON(`set:${set.id}`, set);
  await store.cmd('SADD', `u:${u.id}:sets`, set.id);
  if (set.status === 'published') await store.pipe([['LPUSH', 'sets:recent', set.id], ['LTRIM', 'sets:recent', 0, 199]]);
  return { set };
});

route('GET', 'sets/:id', async (ctx, { id }) => {
  const set = await getSet(id);
  if (!set || !(await canView(set, ctx.user))) fail(404, 'This set doesn’t exist or is private.');
  const owner = await getUser(set.owner);
  const summary = await setSummary(set);
  const saved = ctx.user ? !!(await store.cmd('SISMEMBER', `set:${id}:savedby`, ctx.user.id)) : false;
  const following = ctx.user ? !!(await store.cmd('SISMEMBER', `u:${ctx.user.id}:following`, set.owner)) : false;
  const followers = await store.cmd('SCARD', `u:${set.owner}:followers`);
  return { set: summary, dj: { ...publicUser(owner), followers }, saved, following, mine: ctx.user?.id === set.owner };
});

route('PATCH', 'sets/:id', async (ctx, { id }) => {
  const u = await needUser(ctx);
  const set = await getSet(id);
  if (!set || set.owner !== u.id) fail(404, 'Set not found.');
  const wasPublished = set.status === 'published';
  const next = readSetInput(ctx.body, set);
  next.updatedAt = now();
  if (!wasPublished && next.status === 'published') {
    if (!next.tracks.length) fail(400, 'Add at least one track before publishing.');
    next.publishedAt = now();
    await store.pipe([['LPUSH', 'sets:recent', id], ['LTRIM', 'sets:recent', 0, 199]]);
  }
  await store.setJSON(`set:${id}`, next);
  return { set: next };
});

route('DELETE', 'sets/:id', async (ctx, { id }) => {
  const u = await needUser(ctx);
  const set = await getSet(id);
  if (!set || set.owner !== u.id) fail(404, 'Set not found.');
  await store.pipe([['DEL', `set:${id}`, `set:${id}:c`, `set:${id}:savedby`, ...EMOJI.map((e) => `set:${id}:r:${e}`)], ['SREM', `u:${u.id}:sets`, id]]);
  return { ok: true };
});

route('POST', 'sets/:id/save', async (ctx, { id }) => {
  const u = await needUser(ctx);
  const set = await getSet(id);
  if (!(await canView(set, u))) fail(404, 'Set not found.');
  const on = !(await store.cmd('SISMEMBER', `u:${u.id}:saved`, id));
  await store.pipe(on
    ? [['SADD', `u:${u.id}:saved`, id], ['SADD', `set:${id}:savedby`, u.id]]
    : [['SREM', `u:${u.id}:saved`, id], ['SREM', `set:${id}:savedby`, u.id]]);
  if (on && set.owner !== u.id) await activity(set.owner, { type: 'save', text: `${u.name} saved “${set.title}”`, link: `/s/${id}` });
  return { saved: on, saves: await store.cmd('SCARD', `set:${id}:savedby`) };
});

route('POST', 'sets/:id/react', async (ctx, { id }) => {
  const set = await getSet(id);
  if (!(await canView(set, ctx.user))) fail(404, 'Set not found.');
  const e = EMOJI.includes(ctx.body.emoji) ? ctx.body.emoji : fail(400, 'Unknown reaction.');
  await rateLimit(`react:${ctx.ip}:${id}`, 30, 60);
  const n = await store.cmd('INCR', `set:${id}:r:${e}`);
  return { emoji: e, count: n };
});

route('GET', 'sets/:id/comments', async (ctx, { id }) => {
  const set = await getSet(id);
  if (!(await canView(set, ctx.user))) fail(404, 'Set not found.');
  const items = (await store.cmd('LRANGE', `set:${id}:c`, 0, 99)).map((x) => JSON.parse(x));
  return { comments: items };
});

route('POST', 'sets/:id/comments', async (ctx, { id }) => {
  const set = await getSet(id);
  if (!(await canView(set, ctx.user))) fail(404, 'Set not found.');
  const owner = await getUser(set.owner);
  if (owner?.prefs?.comments === false) fail(403, 'Comments are off for this DJ.');
  const text = str(ctx.body.text, { max: 280, name: 'Comment', required: true });
  const name = ctx.user ? ctx.user.name : str(ctx.body.name, { max: 30, name: 'Your name', required: true });
  await rateLimit(`comment:${ctx.ip}`, 10, 60);
  const c = { id: randomId(6), name, text, at: now(), uid: ctx.user?.id || null };
  await store.pipe([['LPUSH', `set:${id}:c`, JSON.stringify(c)], ['LTRIM', `set:${id}:c`, 0, 499]]);
  if (set.owner !== ctx.user?.id && owner?.prefs?.notify?.comments !== false) await activity(set.owner, { type: 'comment', text: `${name} commented on “${set.title}”: ${text.slice(0, 80)}`, link: `/s/${id}` });
  return { comment: c };
});

// Crates
route('GET', 'crates', async (ctx) => ({ crates: await listCrates((await needUser(ctx)).id) }));
route('POST', 'crates', async (ctx) => {
  const u = await needUser(ctx);
  if ((await store.cmd('SCARD', `u:${u.id}:crates`)) >= 100) fail(400, 'You’ve reached 100 crates.');
  const crate = { id: randomId(7), owner: u.id, name: str(ctx.body.name, { max: 50, name: 'Crate name', required: true }), tracks: cleanTracks(ctx.body.tracks || []), createdAt: now() };
  await store.setJSON(`crate:${crate.id}`, crate);
  await store.cmd('SADD', `u:${u.id}:crates`, crate.id);
  return { crate };
});
route('PATCH', 'crates/:id', async (ctx, { id }) => {
  const u = await needUser(ctx);
  const crate = await store.getJSON(`crate:${id}`);
  if (!crate || crate.owner !== u.id) fail(404, 'Crate not found.');
  if ('name' in ctx.body) crate.name = str(ctx.body.name, { max: 50, name: 'Crate name', required: true });
  if ('tracks' in ctx.body) crate.tracks = cleanTracks(ctx.body.tracks);
  if (ctx.body.add) {
    const [t] = cleanTracks([ctx.body.add]);
    if (t && !crate.tracks.some((x) => x.a === t.a && x.t === t.t)) crate.tracks.push(t);
  }
  await store.setJSON(`crate:${id}`, crate);
  return { crate };
});
route('DELETE', 'crates/:id', async (ctx, { id }) => {
  const u = await needUser(ctx);
  const crate = await store.getJSON(`crate:${id}`);
  if (!crate || crate.owner !== u.id) fail(404, 'Crate not found.');
  await store.pipe([['DEL', `crate:${id}`], ['SREM', `u:${u.id}:crates`, id]]);
  return { ok: true };
});

// Profiles and explore
route('GET', 'users/:handle', async (ctx, { handle }) => {
  const u = await userByHandle(handle);
  if (!u) fail(404, 'No DJ with that handle.');
  const sets = [];
  for (const s of await listSets(u.id)) if (s.owner === ctx.user?.id ? s.status === 'published' : (await canView(s, ctx.user)) && s.visibility !== 'unlisted') sets.push(s);
  const [followers, following, live] = await Promise.all([
    store.cmd('SCARD', `u:${u.id}:followers`),
    ctx.user ? store.cmd('SISMEMBER', `u:${ctx.user.id}:following`, u.id) : 0,
    liveState(u.id),
  ]);
  return {
    user: publicUser(u), followers, following: !!following, mine: ctx.user?.id === u.id,
    live: live?.on ? { title: live.title, startedAt: live.startedAt, now: live.now } : null,
    sets: sets.map((s) => ({ id: s.id, title: s.title, date: s.date, venue: s.venue, source: s.source, tracks: s.tracks.length })),
  };
});

route('POST', 'users/:handle/follow', async (ctx, { handle }) => {
  const me = await needUser(ctx);
  const u = await userByHandle(handle);
  if (!u) fail(404, 'No DJ with that handle.');
  if (u.id === me.id) fail(400, 'You can’t follow yourself.');
  const on = !(await store.cmd('SISMEMBER', `u:${me.id}:following`, u.id));
  await store.pipe(on
    ? [['SADD', `u:${me.id}:following`, u.id], ['SADD', `u:${u.id}:followers`, me.id]]
    : [['SREM', `u:${me.id}:following`, u.id], ['SREM', `u:${u.id}:followers`, me.id]]);
  if (on && u.prefs?.notify?.follow !== false) await activity(u.id, { type: 'follow', text: `${me.name} started following you`, link: `/u/${me.handle}` });
  return { following: on, followers: await store.cmd('SCARD', `u:${u.id}:followers`) };
});

route('GET', 'explore', async (ctx) => {
  const [liveIds, djIds, recent] = await store.pipe([['SMEMBERS', 'live:on'], ['SMEMBERS', 'djs'], ['LRANGE', 'sets:recent', 0, 59]]);
  const lives = await store.mgetJSON(liveIds.map((i) => `live:${i}`));
  const liveOwners = await store.mgetJSON(liveIds.map((i) => `u:${i}`));
  const live = liveIds.map((id, i) => (lives[i]?.on && liveOwners[i] && liveOwners[i].prefs?.exploreLive !== false ? { dj: publicUser(liveOwners[i]), title: lives[i].title, now: lives[i].now, startedAt: lives[i].startedAt } : null)).filter(Boolean);
  const djs = (await store.mgetJSON(djIds.slice(0, 200).map((i) => `u:${i}`))).filter((d) => d && d.onboarded);
  const followerCounts = await store.pipe(djs.map((d) => ['SCARD', `u:${d.id}:followers`]));
  const following = ctx.user ? new Set(await store.cmd('SMEMBERS', `u:${ctx.user.id}:following`)) : new Set();
  const djList = djs.map((d, i) => ({ ...publicUser(d), followers: followerCounts[i], following: following.has(d.id) }))
    .sort((a, b) => b.followers - a.followers).slice(0, 12);
  const sets = [];
  const seen = new Set();
  for (const s of (await store.mgetJSON([...new Set(recent)].map((i) => `set:${i}`)))) {
    if (!s || seen.has(s.id) || s.status !== 'published' || s.visibility !== 'public') continue;
    seen.add(s.id); sets.push(s);
    if (sets.length >= 8) break;
  }
  const owners = Object.fromEntries((await store.mgetJSON([...new Set(sets.map((s) => s.owner))].map((i) => `u:${i}`))).filter(Boolean).map((o) => [o.id, publicUser(o)]));
  return { live, djs: djList, sets: sets.map((s) => ({ id: s.id, title: s.title, date: s.date, tracks: s.tracks.length, dj: owners[s.owner] })) };
});

// Live
route('POST', 'live/start', async (ctx) => {
  const u = await needUser(ctx);
  const title = str(ctx.body.title, { max: 80, name: 'Room name', required: true });
  let queue = [];
  let setId = null;
  if (ctx.body.setId) {
    const set = await getSet(String(ctx.body.setId));
    if (!set || set.owner !== u.id) fail(404, 'Set not found.');
    queue = set.tracks.map(({ a, t }) => ({ a, t }));
    setId = set.id;
  }
  const live = { on: true, title, setId, queue, played: [], now: null, startedAt: now(), comments: u.prefs?.comments !== false };
  await store.setJSON(`live:${u.id}`, live);
  await store.pipe([['SADD', 'live:on', u.id], ['DEL', `live:${u.id}:feed`]]);
  const followers = await store.cmd('SMEMBERS', `u:${u.id}:followers`);
  for (const f of followers.slice(0, 500)) await activity(f, { type: 'live', text: `${u.name} is live: ${title}`, link: `/live/${u.handle}` });
  return { live };
});

route('POST', 'live/now', async (ctx) => {
  const u = await needUser(ctx);
  const live = await liveState(u.id);
  if (!live?.on) fail(400, 'You’re not live.');
  let track;
  if (Number.isInteger(ctx.body.queueIndex)) {
    track = live.queue[ctx.body.queueIndex];
    if (!track) fail(400, 'That track isn’t in your queue.');
    live.queue.splice(ctx.body.queueIndex, 1);
  } else {
    [track] = cleanTracks([ctx.body.track]);
    if (!track) fail(400, 'Add the track name or artist.');
  }
  if (live.now) live.played.push(live.now);
  live.now = { a: track.a, t: track.t, at: now() };
  if (live.played.length > 300) live.played = live.played.slice(-300);
  await store.setJSON(`live:${u.id}`, live);
  return { live };
});

route('POST', 'live/end', async (ctx) => {
  const u = await needUser(ctx);
  const live = await liveState(u.id);
  if (!live?.on) return { ok: true };
  if (live.now) live.played.push(live.now);
  live.now = null; live.on = false; live.endedAt = now();
  await store.setJSON(`live:${u.id}`, live);
  await store.cmd('SREM', 'live:on', u.id);
  let set = null;
  if (ctx.body.saveAsSet && live.played.length) {
    const start = live.startedAt;
    const fmt = (ms) => { const m = Math.floor((ms - start) / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
    set = {
      id: randomId(7), owner: u.id, title: live.title, date: new Date(start + 3600000).toISOString().slice(0, 10), venue: '', source: 'Vybez live',
      visibility: u.prefs?.visibility || 'public', status: 'draft', tracks: live.played.map((p) => ({ a: p.a, t: p.t, at: fmt(p.at) })), createdAt: now(), updatedAt: now(),
    };
    await store.setJSON(`set:${set.id}`, set);
    await store.cmd('SADD', `u:${u.id}:sets`, set.id);
  }
  return { ok: true, set };
});

route('GET', 'live/:handle', async (ctx, { handle }) => {
  const owner = await userByHandle(handle);
  if (!owner) fail(404, 'No DJ with that handle.');
  const live = await liveState(owner.id);
  const viewer = ctx.user ? `u${ctx.user.id}` : `ip${ctx.ip}`.slice(0, 60);
  const view = await liveView(owner, live, Number(ctx.query.get('since') || 0), viewer);
  if (live && live.on && !owner.prefs?.liveTracklist && ctx.user?.id !== owner.id) { view.live.played = []; view.live.hiddenTracklist = true; }
  if (ctx.user?.id !== owner.id) view.live.queue = [];
  view.mine = ctx.user?.id === owner.id;
  return view;
});

route('POST', 'live/:handle/react', async (ctx, { handle }) => {
  const owner = await userByHandle(handle);
  const live = owner && await liveState(owner.id);
  if (!live?.on) fail(400, 'This room isn’t live.');
  const e = EMOJI.includes(ctx.body.emoji) ? ctx.body.emoji : fail(400, 'Unknown reaction.');
  await rateLimit(`lreact:${ctx.ip}`, 60, 60);
  const n = await store.cmd('INCR', `live:${owner.id}:${live.startedAt}:r:${e}`);
  return { emoji: e, count: n };
});

route('POST', 'live/:handle/comment', async (ctx, { handle }) => {
  const owner = await userByHandle(handle);
  const live = owner && await liveState(owner.id);
  if (!live?.on) fail(400, 'This room isn’t live.');
  if (live.comments === false) fail(403, 'Comments are off in this room.');
  const text = str(ctx.body.text, { max: 200, name: 'Comment', required: true });
  const name = ctx.user ? ctx.user.name : str(ctx.body.name, { max: 30, name: 'Your name', required: true });
  await rateLimit(`lcomment:${ctx.ip}`, 12, 60);
  const c = { id: randomId(6), kind: ctx.body.request ? 'request' : 'comment', name, text, at: now(), run: live.startedAt, dj: ctx.user?.id === owner.id };
  await store.pipe([['LPUSH', `live:${owner.id}:feed`, JSON.stringify(c)], ['LTRIM', `live:${owner.id}:feed`, 0, 199]]);
  return { comment: c };
});

// Nights (host)
route('GET', 'nights', async (ctx) => {
  const u = await needUser(ctx);
  const ids = await store.cmd('SMEMBERS', `u:${u.id}:nights`);
  const nights = (await store.mgetJSON(ids.map((i) => `night:${i}`))).filter(Boolean);
  const out = [];
  for (const n of nights) {
    const guests = await nightGuests(n.id);
    out.push({ ...n, going: headcount(guests), asking: guests.filter((g) => g.status === 'asking').length, faces: guests.filter((g) => g.status === 'going').slice(0, 3).map((g) => g.name) });
  }
  return { nights: out.sort((a, b) => a.when.localeCompare(b.when)) };
});

route('POST', 'nights', async (ctx) => {
  const u = await needUser(ctx);
  if ((await store.cmd('SCARD', `u:${u.id}:nights`)) >= 200) fail(400, 'You’ve reached 200 nights.');
  await rateLimit(`night:${u.id}`, 20, 3600);
  const n = readNightInput(ctx.body);
  n.id = randomId(7); n.host = u.id; n.createdAt = now(); n.status = 'on'; n.cover = n.cover || 'rings';
  const base = slug(`${u.name.split(' ')[0]}-${n.title}`).slice(0, 18).replace(/-+$/, '') || 'night';
  for (let i = 0; i < 6 && !n.code; i++) {
    const code = `${base}-${randomCode(4)}`;
    if (await store.cmd('SET', `code:${code}`, n.id, 'NX')) n.code = code;
  }
  if (!n.code) fail(500, 'Couldn’t make an invite link. Try again.');
  await store.setJSON(`night:${n.id}`, n);
  await store.cmd('SADD', `u:${u.id}:nights`, n.id);
  return { night: n };
});

async function hostNight(ctx, id) {
  const u = await needUser(ctx);
  const n = await getNight(id);
  if (!n || n.host !== u.id) fail(404, 'Night not found.');
  return n;
}

route('GET', 'nights/:id', async (ctx, { id }) => {
  const n = await hostNight(ctx, id);
  const guests = (await nightGuests(id)).map(({ token, ...g }) => g);
  return { night: n, guests, going: headcount(guests) };
});

route('PATCH', 'nights/:id', async (ctx, { id }) => {
  const n = await hostNight(ctx, id);
  const next = readNightInput(ctx.body, n);
  await store.setJSON(`night:${id}`, next);
  return { night: next };
});

route('DELETE', 'nights/:id', async (ctx, { id }) => {
  const n = await hostNight(ctx, id);
  const guests = await nightGuests(id);
  const cmds = guests.map((g) => ['DEL', `guest:${g.id}`, `gtok:${g.token}`, `pass:${id}:${g.pass}`]);
  cmds.push(['DEL', `night:${id}`, `night:${id}:g`, `code:${n.code}`], ['SREM', `u:${n.host}:nights`, id]);
  await store.pipe(cmds);
  return { ok: true };
});

route('PATCH', 'nights/:id/guests/:gid', async (ctx, { id, gid }) => {
  const n = await hostNight(ctx, id);
  const g = await store.getJSON(`guest:${gid}`);
  if (!g || g.night !== id) fail(404, 'Guest not found.');
  if ('status' in ctx.body) {
    const s = ctx.body.status;
    if (!['going', 'declined', 'asking'].includes(s)) fail(400, 'Unknown status.');
    if (s === 'going' && g.status !== 'going') {
      const count = headcount(await nightGuests(id));
      if (count + 1 + (g.plus ? 1 : 0) > n.cap) fail(409, `That would go over your cap of ${n.cap}. Raise the cap first.`);
    }
    g.status = s;
  }
  if ('checkedIn' in ctx.body) g.checkedIn = ctx.body.checkedIn ? now() : null;
  await store.setJSON(`guest:${gid}`, g);
  const { token, ...safe } = g;
  return { guest: safe };
});

route('POST', 'nights/:id/checkin', async (ctx, { id }) => {
  await hostNight(ctx, id);
  const pass = str(ctx.body.pass, { max: 12, required: true, name: 'Pass code' }).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const gid = await store.cmd('GET', `pass:${id}:${pass}`);
  const g = gid && await store.getJSON(`guest:${gid}`);
  if (!g) fail(404, 'No guest with that pass on this list.');
  if (g.status !== 'going') fail(409, `${g.name} isn’t approved for this night.`);
  const already = !!g.checkedIn;
  if (!already) { g.checkedIn = now(); await store.setJSON(`guest:${gid}`, g); }
  const { token, ...safe } = g;
  return { guest: safe, already };
});

// Invites (guests, no account)
async function nightByCode(code) {
  const id = await store.cmd('GET', `code:${String(code).toLowerCase()}`);
  const n = id && await getNight(id);
  if (!n) fail(404, 'This invite doesn’t exist or the host deleted it.');
  return n;
}

route('GET', 'invites/:code', async (ctx, { code }) => {
  const n = await nightByCode(code);
  const [host, guests, guest] = await Promise.all([getUser(n.host), nightGuests(n.id), guestFor(n, ctx.query.get('guest'))]);
  const view = inviteView(n, host, guests, guest);
  view.isHost = ctx.user?.id === n.host;
  if (view.isHost) view.nightId = n.id;
  return { invite: view };
});

route('POST', 'invites/:code/rsvp', async (ctx, { code }) => {
  const n = await nightByCode(code);
  if (n.status === 'cancelled') fail(409, 'The host cancelled this night.');
  await rateLimit(`rsvp:${ctx.ip}`, 20, 3600);
  const existing = await guestFor(n, ctx.body.guest);
  const name = str(ctx.body.name, { max: 40, name: 'Your name', required: true });
  const contact = str(ctx.body.contact, { max: 80, name: 'Phone or email' });
  const plus = n.plusOnes && !!ctx.body.plus;
  const guests = await nightGuests(n.id);
  let g = existing;
  if (!g) {
    g = { id: randomId(7), night: n.id, token: randomId(18), pass: randomCode(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), songs: [], at: now() };
  } else if (g.status === 'going') {
    // already in: only update details
  }
  g.name = name; g.contact = contact; g.plus = plus;
  if (!existing || existing.status !== 'going') {
    const count = headcount(guests.filter((x) => x.id !== g.id));
    const full = count + 1 + (plus ? 1 : 0) > n.cap;
    g.status = n.approve ? 'asking' : (full ? 'waitlist' : 'going');
    if (!n.approve && full) g.status = 'waitlist';
  }
  await store.setJSON(`guest:${g.id}`, g);
  if (!existing) {
    await store.pipe([['SADD', `night:${n.id}:g`, g.id], ['SET', `gtok:${g.token}`, g.id], ['SET', `pass:${n.id}:${g.pass}`, g.id]]);
    const host = await getUser(n.host);
    if (host?.prefs?.notify?.rsvp !== false) await activity(n.host, { type: 'rsvp', text: g.status === 'asking' ? `${name} asked to join ${n.title}` : `${name} is going to ${n.title}`, link: `/social/${n.id}` });
  }
  const host = await getUser(n.host);
  return { guest: g.token, invite: inviteView(n, host, await nightGuests(n.id), g) };
});

route('POST', 'invites/:code/cant', async (ctx, { code }) => {
  const n = await nightByCode(code);
  const existing = await guestFor(n, ctx.body.guest);
  const name = existing?.name || str(ctx.body.name, { max: 40, name: 'Your name', required: true });
  await rateLimit(`rsvp:${ctx.ip}`, 20, 3600);
  if (existing) { existing.status = 'cant'; await store.setJSON(`guest:${existing.id}`, existing); }
  await activity(n.host, { type: 'rsvp', text: `${name} can’t make ${n.title}`, link: `/social/${n.id}` });
  return { ok: true };
});

route('POST', 'invites/:code/song', async (ctx, { code }) => {
  const n = await nightByCode(code);
  if (!n.songs) fail(403, 'The host turned off song suggestions.');
  const g = await guestFor(n, ctx.body.guest);
  if (!g || g.status !== 'going') fail(403, 'Songs open once the host approves you.');
  g.songs = g.songs || [];
  if (ctx.body.remove !== undefined) { g.songs.splice(int(ctx.body.remove, 0, 1, 0), 1); } else {
    if (g.songs.length >= 2) fail(400, 'You’ve added your 2 songs.');
    const [t] = cleanTracks([ctx.body.track]);
    if (!t) fail(400, 'Add a song name.');
    g.songs.push({ a: t.a, t: t.t });
  }
  await store.setJSON(`guest:${g.id}`, g);
  return { songs: g.songs };
});

route('POST', 'invites/:code/leave', async (ctx, { code }) => {
  const n = await nightByCode(code);
  const g = await guestFor(n, ctx.body.guest);
  if (!g) fail(404, 'We couldn’t find your RSVP on this device.');
  g.status = 'left';
  await store.setJSON(`guest:${g.id}`, g);
  await activity(n.host, { type: 'rsvp', text: `${g.name} left the list for ${n.title}`, link: `/social/${n.id}` });
  return { ok: true };
});

// Insights: honest numbers from Vybez data only.
route('GET', 'insights', async (ctx) => {
  const u = await needUser(ctx);
  const sets = await Promise.all((await listSets(u.id)).map(setSummary));
  const followers = await store.cmd('SCARD', `u:${u.id}:followers`);
  const artists = {};
  for (const s of sets) for (const t of s.tracks) if (t.a) artists[t.a] = (artists[t.a] || 0) + 1;
  const topArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const bpms = sets.flatMap((s) => s.tracks.map((t) => t.bpm).filter(Boolean));
  const ranges = [[0, 100], [100, 110], [110, 115], [115, 120], [120, 125], [125, 130], [130, 300]].map(([lo, hi]) => ({ label: hi === 300 ? '130+' : lo === 0 ? '<100' : `${lo}–${hi - 1}`, count: bpms.filter((b) => b >= lo && b < hi).length }));
  return {
    followers,
    sets: sets.length,
    published: sets.filter((s) => s.status === 'published').length,
    tracks: sets.reduce((n, s) => n + s.tracks.length, 0),
    saves: sets.reduce((n, s) => n + s.saves, 0),
    comments: sets.reduce((n, s) => n + s.comments, 0),
    reactions: sets.reduce((n, s) => n + Object.values(s.reactions).reduce((a, b) => a + b, 0), 0),
    topSets: [...sets].sort((a, b) => (b.saves + b.comments) - (a.saves + a.comments)).slice(0, 5).map((s) => ({ id: s.id, title: s.title, saves: s.saves, comments: s.comments, reactions: Object.values(s.reactions).reduce((a, b) => a + b, 0) })),
    topArtists, bpm: ranges,
  };
});

// ---------- entry ----------
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
