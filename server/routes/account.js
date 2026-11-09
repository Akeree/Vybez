// The signed-in account: profile, password, export, deletion, notifications.
import { store } from '../store.js';
import { route, fail, str, int, bool, now, EMAIL_RE, rateLimit } from '../lib/http.js';
import { hashPassword, checkPassword, makeSession, randomId, randomCode } from '../auth.js';
import { DEFAULT_PREFS, RESERVED, slug, selfUser, saveUser, needUser, readProduct, productOf, syncDjIndex, ACTIVITY_TYPES } from '../domain/users.js';
import { listSets, listCrates, VIS, EMOJI } from '../domain/music.js';
import { getNight, nightGuests } from '../domain/nights.js';
import { liveState } from '../domain/live.js';

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
  if ('product' in b || 'role' in b) {
    // Switching keeps all data; each side only shows its own.
    u.product = readProduct(b.product ?? b.role);
    delete u.role;
    await syncDjIndex(u);
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

// Notifications
async function unreadCount(u) {
  const [items, readAt] = await store.pipe([['LRANGE', `u:${u.id}:activity`, 0, 49], ['GET', `u:${u.id}:readAt`]]);
  const types = ACTIVITY_TYPES[productOf(u)];
  return (items || []).map((x) => JSON.parse(x)).filter((x) => x.at > Number(readAt || 0) && types.includes(x.type)).length;
}
route('GET', 'notifications', async (ctx) => {
  const u = await needUser(ctx);
  const [items, readAt] = await store.pipe([['LRANGE', `u:${u.id}:activity`, 0, 99], ['GET', `u:${u.id}:readAt`]]);
  const types = ACTIVITY_TYPES[productOf(u)];
  return { items: (items || []).map((x) => JSON.parse(x)).filter((x) => types.includes(x.type)), readAt: Number(readAt || 0) };
});
route('POST', 'notifications/read', async (ctx) => {
  const u = await needUser(ctx);
  await store.cmd('SET', `u:${u.id}:readAt`, String(now()));
  return { ok: true };
});
