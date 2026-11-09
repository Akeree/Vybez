// Vybez Social: nights for hosts, invites for guests (no account needed).
import { store } from '../store.js';
import { route, fail, str, int, bool, now, EMAIL_RE, rateLimit } from '../lib/http.js';
import { hashPassword, checkPassword, makeSession, randomId, randomCode } from '../auth.js';
import { getUser, needProduct, activity, slug } from '../domain/users.js';
import { cleanTracks } from '../domain/music.js';
import { getNight, nightGuests, headcount, readNightInput, inviteView, guestFor } from '../domain/nights.js';

// Nights (host)
route('GET', 'nights', async (ctx) => {
  const u = await needProduct(ctx, 'social');
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
  const u = await needProduct(ctx, 'social');
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
  const u = await needProduct(ctx, 'social');
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
  const host = await getUser(n.host);
  if (host?.prefs?.notify?.rsvp !== false) await activity(n.host, { type: 'rsvp', text: `${name} can’t make ${n.title}`, link: `/social/${n.id}` });
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
