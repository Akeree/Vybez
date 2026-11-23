// Vybez Social "the group": what approved guests and the host share for one night.
//  - Chat: one room for everyone on the list ('all') and one per ride.
//  - Rides (car hop): a guest who is driving, or wants to split a Bolt or Uber, posts a ride
//    from their area; others on the list join it and plan in the ride's own chat.
//  - Moments: photos from the night, seen only by the list.
// Nobody outside the list can read any of it. Guests see each other's first names only,
// never phone numbers or emails. The host can read every room and remove anything.
import { store } from '../store.js';
import { fail, str, int, now } from '../lib/http.js';
import { getUser } from './users.js';
import { guestFor } from './nights.js';

export const MAX_MESSAGES = 500; // kept per room; older ones drop off
export const MAX_RIDES = 30;
export const MAX_MOMENTS = 60;
export const MOMENT_MAX_BYTES = 400 * 1024;

export const chatKey = (nid, room) => `night:${nid}:chat:${room}`;
export const ridesKey = (nid) => `night:${nid}:rides`;
export const momentsKey = (nid) => `night:${nid}:moments`;
export const momentImgKey = (nid, mid) => `moment:${nid}:${mid}`;
export const momentUrl = (nid, mid) => `/moment/${nid}/${mid}.jpg`;

// "Adaeze Okafor" -> "Adaeze O." so guests know who's who without full names.
export const shortName = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return 'Guest';
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0].toUpperCase()}.` : w[0];
};

// Who is asking: the host (signed in) or an approved guest (token from this device).
export async function memberOf(ctx, night, token) {
  if (ctx.user && ctx.user.id === night.host) {
    return { id: 'host', name: shortName(ctx.user.name), host: true };
  }
  const g = await guestFor(night, token);
  if (!g) fail(403, 'The group is for guests on the list. RSVP first.');
  if (g.status !== 'going') fail(403, g.status === 'asking' ? 'The group opens once the host approves you.' : 'The group is for guests on the list.');
  return { id: g.id, name: shortName(g.name), host: false };
}

export function canPost(night) {
  if (night.status === 'cancelled') fail(409, 'The host cancelled this night, so the group is read-only.');
}

// ---------- chat ----------
export async function readRoom(nid, room, after = 0) {
  const raw = await store.cmd('LRANGE', chatKey(nid, room), 0, 99);
  const list = raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean).reverse();
  return after ? list.filter((m) => m.at > after) : list;
}

export async function postMessage(nid, room, me, text, kind = 'text') {
  const msg = { id: `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, by: me.id, name: me.name, host: !!me.host, text, kind, at: now() };
  await store.pipe([['LPUSH', chatKey(nid, room), JSON.stringify(msg)], ['LTRIM', chatKey(nid, room), 0, MAX_MESSAGES - 1]]);
  return msg;
}

export async function removeMessage(nid, room, me, mid) {
  const raw = await store.cmd('LRANGE', chatKey(nid, room), 0, MAX_MESSAGES - 1);
  const hit = raw.find((s) => { try { return JSON.parse(s).id === mid; } catch { return false; } });
  if (!hit) fail(404, 'That message is already gone.');
  const m = JSON.parse(hit);
  if (!me.host && m.by !== me.id) fail(403, 'You can only remove your own messages.');
  await store.cmd('LREM', chatKey(nid, room), 1, hit);
}

// Latest message and count for each room, in one round trip.
export async function roomStats(nid, rooms) {
  if (!rooms.length) return {};
  const res = await store.pipe(rooms.flatMap((r) => [['LRANGE', chatKey(nid, r), 0, 0], ['LLEN', chatKey(nid, r)]]));
  const out = {};
  rooms.forEach((r, i) => {
    let last = null;
    try { last = res[i * 2][0] ? JSON.parse(res[i * 2][0]) : null; } catch { /* ignore */ }
    out[r] = { count: res[i * 2 + 1] || 0, last: last ? { by: last.by, name: last.name, text: last.kind === 'text' ? last.text : '', kind: last.kind, at: last.at } : null };
  });
  return out;
}

// ---------- rides ----------
export async function getRide(nid, rid) {
  const r = await store.getJSON(`ride:${rid}`);
  if (!r || r.night !== nid) fail(404, 'That ride is gone. The person who posted it may have removed it.');
  return r;
}

export async function nightRides(nid) {
  const ids = await store.cmd('SMEMBERS', ridesKey(nid));
  return (await store.mgetJSON(ids.map((i) => `ride:${i}`))).filter(Boolean);
}

export function readRideInput(b) {
  const dir = b.dir === 'home' ? 'home' : 'there';
  const kind = b.kind === 'cab' ? 'cab' : 'driving';
  const from = str(b.from, { max: 60, name: dir === 'home' ? 'Where you’re heading' : 'Where you’re leaving from', required: true });
  const time = str(b.time, { max: 5, name: 'Time', required: true });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'Pick a time.');
  const seats = int(b.seats, 1, kind === 'cab' ? 3 : 6, kind === 'cab' ? 3 : 2);
  const note = str(b.note, { max: 140, name: 'Note' });
  return { dir, kind, from, time, seats, note };
}

// active: ids of people still on the list (approved guests plus 'host').
export function rideView(r, me, active) {
  const members = r.members.filter((m) => active.has(m.id));
  const riders = members.filter((m) => m.id !== r.by);
  return {
    id: r.id, dir: r.dir, kind: r.kind, from: r.from, time: r.time, note: r.note || '', seats: r.seats,
    by: { id: r.by, name: r.byName, me: r.by === me.id }, members: members.map((m) => ({ id: m.id, name: m.name, me: m.id === me.id })),
    left: Math.max(0, r.seats - riders.length), joined: members.some((m) => m.id === me.id), at: r.at,
  };
}

export function canReadRide(r, me) {
  return me.host || r.members.some((m) => m.id === me.id);
}

// ---------- moments ----------
export function readMoment(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) fail(400, 'That photo didn’t come through. Try choosing it again.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MOMENT_MAX_BYTES) fail(413, 'That photo is too big. Try a different one.');
  if (buf.length < 500 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) fail(400, 'That doesn’t look like a photo. Try a JPEG or a photo from your camera.');
  return m[1];
}

export async function nightMoments(nid) {
  const raw = await store.cmd('LRANGE', momentsKey(nid), 0, MAX_MOMENTS - 1);
  return raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// Serves a moment photo. The id in the URL is long and random and only shown to the list.
export async function momentResponse(nid, mid) {
  let b64 = null;
  try { b64 = await store.cmd('GET', momentImgKey(nid, mid)); } catch { /* treat as missing */ }
  if (!b64) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  const buf = Buffer.from(b64, 'base64');
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
  });
}

// Every key the group uses for a night, so deleting a night (or an account) leaves nothing behind.
export async function groupKeys(nid) {
  const [rideIds, moments] = await Promise.all([store.cmd('SMEMBERS', ridesKey(nid)), nightMoments(nid)]);
  return [
    chatKey(nid, 'all'), ridesKey(nid), momentsKey(nid),
    ...rideIds.flatMap((r) => [`ride:${r}`, chatKey(nid, r)]),
    ...moments.map((m) => momentImgKey(nid, m.id)),
  ];
}

export async function hostName(night) { return shortName((await getUser(night.host))?.name || 'Host'); }
