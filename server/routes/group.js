// Vybez Social "the group" for one night: chat, rides (car hop) and moments.
// Guests use the token their RSVP left on their device; the host uses their session.
import { store } from '../store.js';
import { route, fail, str, int, now, rateLimit } from '../lib/http.js';
import { randomId } from '../auth.js';
import { getNight, nightGuests } from '../domain/nights.js';
import { getUser, activity } from '../domain/users.js';
import {
  memberOf, canPost, readRoom, postMessage, removeMessage, roomStats, shortName, hostName,
  getRide, nightRides, readRideInput, rideView, canReadRide, ridesKey, chatKey, MAX_RIDES,
  readMoment, nightMoments, momentsKey, momentImgKey, momentUrl, MAX_MOMENTS,
  readCheckinInput, nightCheckins, saveCheckin, checkinView, NUDGE_GAP,
} from '../domain/group.js';

async function nightByCode(code) {
  const id = await store.cmd('GET', `code:${String(code).toLowerCase()}`);
  const n = id && await getNight(id);
  if (!n) fail(404, 'This invite doesn’t exist or the host deleted it.');
  return n;
}
// 19:30 -> 7:30 pm, as people say it.
const hm = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
// A moment in time as Lagos clock time: 1:40 am.
const at12 = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).replace(/\s+/g, ' ');
const tokenOf = (ctx) => ctx.body?.guest || ctx.query.get('guest') || '';
async function enter(ctx, code) {
  const n = await nightByCode(code);
  const me = await memberOf(ctx, n, tokenOf(ctx));
  return { n, me };
}
// Everyone still on the list, as { id, name }.
async function people(n) {
  const guests = (await nightGuests(n.id)).filter((g) => g.status === 'going');
  return [{ id: 'host', name: await hostName(n), host: true }, ...guests.map((g) => ({ id: g.id, name: shortName(g.name), plus: !!g.plus }))];
}
const roomOk = (room) => room === 'all' || /^[\w-]{4,20}$/.test(room);
async function openRoom(n, me, room) {
  if (!roomOk(room)) fail(404, 'Chat not found.');
  if (room === 'all') return null;
  const r = await getRide(n.id, room);
  if (!canReadRide(r, me)) fail(403, 'Join this ride to see its chat.');
  return r;
}

// Everything the group page needs in one call.
route('GET', 'invites/:code/group', async (ctx, { code }) => {
  const { n, me } = await enter(ctx, code);
  const list = await people(n);
  const active = new Set(list.map((p) => p.id));
  const rides = (await nightRides(n.id)).filter((r) => active.has(r.by)).sort((a, b) => (a.dir === b.dir ? a.time.localeCompare(b.time) : a.dir === 'there' ? -1 : 1));
  const views = rides.map((r) => rideView(r, me, active));
  const rooms = ['all', ...views.filter((r) => r.joined || me.host).map((r) => r.id)];
  const [stats, moments, checkins] = await Promise.all([roomStats(n.id, rooms), store.cmd('LLEN', momentsKey(n.id)), nightCheckins(n.id)]);
  return {
    now: now(),
    checkins: Object.entries(checkins).filter(([id]) => active.has(id)).map(([id, c]) => checkinView(id, c, me.id)),
    me, people: list.map((p) => ({ ...p, me: p.id === me.id })),
    night: { title: n.title, when: n.when, until: n.until || '', area: n.area, code: n.code, status: n.status || 'on', nightId: me.host ? n.id : undefined },
    rides: views, rooms: stats, moments,
  };
});

// ---------- chat ----------
route('GET', 'invites/:code/chat/:room', async (ctx, { code, room }) => {
  const { n, me } = await enter(ctx, code);
  await openRoom(n, me, room);
  return { messages: await readRoom(n.id, room, int(ctx.query.get('after'), 0, 9e15, 0)), me: me.id };
});

route('POST', 'invites/:code/chat/:room', async (ctx, { code, room }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  await openRoom(n, me, room);
  await rateLimit(`chat:${n.id}:${me.id}`, 20, 60);
  const text = str(ctx.body.text, { max: 600, name: 'Message', required: true });
  return { message: await postMessage(n.id, room, me, text) };
});

route('DELETE', 'invites/:code/chat/:room/:mid', async (ctx, { code, room, mid }) => {
  const { n, me } = await enter(ctx, code);
  await openRoom(n, me, room);
  await removeMessage(n.id, room, me, mid);
  return { ok: true };
});

// ---------- rides ----------
route('POST', 'invites/:code/rides', async (ctx, { code }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  await rateLimit(`ride:${n.id}:${me.id}`, 6, 3600);
  const rides = await nightRides(n.id);
  if (rides.length >= MAX_RIDES) fail(400, `This night has ${MAX_RIDES} rides already. Join one of them instead.`);
  const input = readRideInput(ctx.body);
  if (rides.some((r) => r.by === me.id && r.dir === input.dir)) fail(409, input.dir === 'home' ? 'You already posted a ride home. Edit or remove that one first.' : 'You already posted a ride there. Edit or remove that one first.');
  const r = { id: randomId(8), night: n.id, by: me.id, byName: me.name, ...input, members: [{ id: me.id, name: me.name }], at: now() };
  await store.setJSON(`ride:${r.id}`, r);
  await store.cmd('SADD', ridesKey(n.id), r.id);
  const what = r.kind === 'cab' ? `wants to split a ride ${r.dir === 'home' ? 'home to' : 'from'} ${r.from}` : `is driving ${r.dir === 'home' ? 'home to' : 'from'} ${r.from}`;
  await postMessage(n.id, 'all', me, `${me.name} ${what} at ${hm(r.time)}. ${r.seats} ${r.seats === 1 ? 'seat' : 'seats'} open in Rides.`, 'ride');
  return { ride: rideView(r, me, new Set(r.members.map((m) => m.id))) };
});

route('POST', 'invites/:code/rides/:rid/join', async (ctx, { code, rid }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  const r = await getRide(n.id, rid);
  if (r.members.some((m) => m.id === me.id)) return { ok: true };
  const active = new Set((await people(n)).map((p) => p.id));
  const riders = r.members.filter((m) => m.id !== r.by && active.has(m.id));
  if (riders.length >= r.seats) fail(409, 'That ride is full. Try another, or post your own.');
  r.members = [...r.members.filter((m) => active.has(m.id)), { id: me.id, name: me.name }];
  await store.setJSON(`ride:${r.id}`, r);
  await postMessage(n.id, r.id, me, `${me.name} joined the ride.`, 'event');
  return { ride: rideView(r, me, active) };
});

route('POST', 'invites/:code/rides/:rid/leave', async (ctx, { code, rid }) => {
  const { n, me } = await enter(ctx, code);
  const r = await getRide(n.id, rid);
  if (r.by === me.id) fail(400, 'You posted this ride. Remove it instead.');
  if (!r.members.some((m) => m.id === me.id)) return { ok: true };
  r.members = r.members.filter((m) => m.id !== me.id);
  await store.setJSON(`ride:${r.id}`, r);
  await postMessage(n.id, r.id, me, `${me.name} left the ride.`, 'event');
  return { ok: true };
});

route('PATCH', 'invites/:code/rides/:rid', async (ctx, { code, rid }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  const r = await getRide(n.id, rid);
  if (r.by !== me.id) fail(403, 'Only the person who posted this ride can change it.');
  const input = readRideInput({ ...r, ...ctx.body });
  const riders = r.members.filter((m) => m.id !== r.by).length;
  if (input.seats < riders) fail(409, `${riders} people have joined. Ask someone to leave before you cut seats.`);
  Object.assign(r, { time: input.time, seats: input.seats, note: input.note, from: input.from });
  await store.setJSON(`ride:${r.id}`, r);
  await postMessage(n.id, r.id, me, `${me.name} updated the ride: ${r.from} at ${hm(r.time)}, ${r.seats} ${r.seats === 1 ? 'seat' : 'seats'}.`, 'event');
  return { ride: rideView(r, me, new Set(r.members.map((m) => m.id))) };
});

route('DELETE', 'invites/:code/rides/:rid', async (ctx, { code, rid }) => {
  const { n, me } = await enter(ctx, code);
  const r = await getRide(n.id, rid);
  if (r.by !== me.id && !me.host) fail(403, 'Only the person who posted this ride, or the host, can remove it.');
  await store.pipe([['DEL', `ride:${r.id}`, chatKey(n.id, r.id)], ['SREM', ridesKey(n.id), r.id]]);
  return { ok: true };
});

// ---------- check-ins ----------
// "I'm here", "Heading home" (and by when) or "Home safe". It shows in the night chat, and the
// group's pages pop up a prompt to check on anyone who isn't home by the time they gave.
route('POST', 'invites/:code/checkin', async (ctx, { code }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  await rateLimit(`checkin:${n.id}:${me.id}`, 20, 3600);
  const input = readCheckinInput(ctx.body);
  const prev = (await nightCheckins(n.id))[me.id];
  const at = now();
  const c = { name: me.name, state: input.state, at, eta: input.state === 'leaving' ? at + input.mins * 60000 : null, nudges: [] };
  await saveCheckin(n.id, me.id, c);
  const text = {
    here: `${me.name} is here.`,
    leaving: prev?.state === 'leaving' ? `${me.name} needs a bit more time. Now expects to be home by ${at12(c.eta)}.` : `${me.name} is heading home and expects to be there by ${at12(c.eta)}.`,
    home: `${me.name} got home safe.`,
  }[c.state];
  await postMessage(n.id, 'all', me, text, 'checkin', { state: c.state, eta: c.eta });
  return { checkin: checkinView(me.id, c, me.id) };
});

// Check on someone who's heading home: they get a pop-up, and the chat shows you asked.
route('POST', 'invites/:code/checkin/:who/nudge', async (ctx, { code, who }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  if (who === me.id) fail(400, 'That’s you. Tap Home safe when you’re in.');
  const active = new Set((await people(n)).map((p) => p.id));
  const c = active.has(who) ? (await nightCheckins(n.id))[who] : null;
  if (!c) fail(404, 'They haven’t checked in tonight.');
  if (c.state !== 'leaving') fail(409, c.state === 'home' ? `${c.name} is already home safe.` : `${c.name} isn’t heading home yet.`);
  const t = now();
  c.nudges = c.nudges || [];
  if (c.nudges.some((x) => x.by === me.id && t - x.at < NUDGE_GAP)) fail(429, `You checked on ${c.name} a moment ago. Give them a few minutes.`);
  c.nudges = [...c.nudges, { by: me.id, name: me.name, at: t }].slice(-10);
  await saveCheckin(n.id, who, c);
  await postMessage(n.id, 'all', me, `${me.name} is checking on ${c.name}${c.name.endsWith('.') ? '' : '.'} Home yet?`, 'nudge', { to: who });
  return { checkin: checkinView(who, c, me.id) };
});

// ---------- moments ----------
route('GET', 'invites/:code/moments', async (ctx, { code }) => {
  const { n, me } = await enter(ctx, code);
  const list = await nightMoments(n.id);
  return { moments: list.map((m) => ({ id: m.id, name: m.name, caption: m.caption || '', at: m.at, w: m.w, h: m.h, url: momentUrl(n.id, m.id), mine: m.by === me.id, canRemove: me.host || m.by === me.id })), max: MAX_MOMENTS };
});

route('POST', 'invites/:code/moments', async (ctx, { code }) => {
  const { n, me } = await enter(ctx, code);
  canPost(n);
  await rateLimit(`moment:${n.id}:${me.id}`, 12, 3600);
  if ((await store.cmd('LLEN', momentsKey(n.id))) >= MAX_MOMENTS) fail(400, `This night has ${MAX_MOMENTS} moments, the most it can hold. The host can remove some to make room.`);
  const b64 = readMoment(ctx.body.image);
  const m = { id: randomId(16), by: me.id, name: me.name, caption: str(ctx.body.caption, { max: 140, name: 'Caption' }), w: int(ctx.body.w, 1, 4000, 1080), h: int(ctx.body.h, 1, 4000, 1080), at: now() };
  await store.pipe([['SET', momentImgKey(n.id, m.id), b64], ['LPUSH', momentsKey(n.id), JSON.stringify(m)]]);
  return { moment: { ...m, by: undefined, url: momentUrl(n.id, m.id), mine: true, canRemove: true } };
});

route('DELETE', 'invites/:code/moments/:mid', async (ctx, { code, mid }) => {
  const { n, me } = await enter(ctx, code);
  const raw = await store.cmd('LRANGE', momentsKey(n.id), 0, MAX_MOMENTS - 1);
  const hit = raw.find((s) => { try { return JSON.parse(s).id === mid; } catch { return false; } });
  if (!hit) fail(404, 'That moment is already gone.');
  if (!me.host && JSON.parse(hit).by !== me.id) fail(403, 'You can only remove your own moments.');
  await store.pipe([['LREM', momentsKey(n.id), 1, hit], ['DEL', momentImgKey(n.id, mid)]]);
  return { ok: true };
});

// ---------- reports ----------
// A guest flags a photo or message to the host, who can remove it from the group.
route('POST', 'invites/:code/report', async (ctx, { code }) => {
  const { n, me } = await enter(ctx, code);
  if (me.host) fail(400, 'You’re the host: remove it instead.');
  await rateLimit(`report:${n.id}:${me.id}`, 10, 3600);
  const what = ctx.body.what === 'message' ? 'message' : 'moment';
  const id = str(ctx.body.id, { max: 40, name: 'Item', required: true });
  let by = null;
  if (what === 'moment') {
    const m = (await nightMoments(n.id)).find((x) => x.id === id);
    if (!m) fail(404, 'That photo is already gone.');
    by = m.by;
  } else {
    const room = str(ctx.body.room, { max: 20, name: 'Chat', required: true });
    await openRoom(n, me, room);
    const m = (await readRoom(n.id, room)).find((x) => x.id === id);
    if (!m) fail(404, 'That message is already gone.');
    by = m.by;
  }
  if (by === me.id) fail(400, 'That’s yours. Remove it instead.');
  const host = await getUser(n.host);
  if (host) await activity(n.host, { type: 'rsvp', text: `${me.name} reported a ${what === 'moment' ? 'photo' : 'message'} in the group for ${n.title}. Have a look and remove it if needed.`, link: `/i/${n.code}/group${what === 'moment' ? '#moments' : ''}` });
  return { ok: true };
});
