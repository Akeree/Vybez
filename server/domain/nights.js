// Vybez Social data: nights, guests and invite views.
import { store } from '../store.js';
import { fail, str, int, bool } from '../lib/http.js';

export async function getNight(id) { return store.getJSON(`night:${id}`); }
export async function nightGuests(id) {
  const ids = await store.cmd('SMEMBERS', `night:${id}:g`);
  return (await store.mgetJSON(ids.map((g) => `guest:${g}`))).filter(Boolean).sort((a, b) => a.at - b.at);
}
export const headcount = (guests) => guests.filter((g) => g.status === 'going').reduce((n, g) => n + 1 + (g.plus ? 1 : 0), 0);

// The host's own cover photo: a 1200x630 JPEG made on their phone, kept in the store under
// photo:<nightId>. night.photo is a version that changes on every upload, so the URL can be
// cached forever.
export const COVERS = ['rings', 'rooftop', 'dinner', 'living', 'beach', 'owambe', 'crowd'];
export const PHOTO_MAX_BYTES = 600 * 1024;
export const photoUrl = (night) => (night?.photo ? `/photo/${night.id}/${night.photo}.jpg` : '');
export const coverOf = (night) => (night?.cover === 'photo' ? (night.photo ? 'photo' : 'rings') : COVERS.includes(night?.cover) ? night.cover : 'rings');

// Checks a data URL from the browser and returns the JPEG bytes.
export function readPhoto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) fail(400, 'That photo didn’t come through. Try choosing it again.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > PHOTO_MAX_BYTES) fail(413, 'That photo is too big. Try a different one.');
  if (buf.length < 500 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) fail(400, 'That doesn’t look like a photo. Try a JPEG or a photo from your camera.');
  return buf;
}

// One-line fields (title, area, address, until) lose line breaks so they can't break the
// calendar file or link previews built from them.
const oneLine = (v) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ') : v);

export function readNightInput(input, existing = {}) {
  const b = { ...input };
  for (const k of ['title', 'until', 'place', 'area', 'music']) if (k in b) b[k] = oneLine(b[k]);
  const n = { ...existing };
  if ('title' in b || !existing.id) n.title = str(b.title, { max: 60, name: 'Name', required: true });
  if ('when' in b || !existing.id) {
    n.when = str(b.when, { max: 16, name: 'Date and time', required: true });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(n.when)) fail(400, 'Pick a date and time.');
    // Times are typed in Lagos time (UTC+1). A new or moved night can't start in the past
    // (a few hours' grace for a night that's already under way).
    if (n.when !== existing.when && Date.parse(`${n.when}:00+01:00`) < Date.now() - 6 * 3600 * 1000) fail(400, 'That date has passed. Pick a date that’s still to come.');
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
  // 'photo' only sticks once a photo has been uploaded (PUT nights/:id/photo sets it too).
  if ('cover' in b) n.cover = COVERS.includes(b.cover) || (b.cover === 'photo' && existing.photo) ? b.cover : 'rings';
  if ('status' in b) n.status = b.status === 'cancelled' ? 'cancelled' : 'on';
  return n;
}

export function inviteView(night, host, guests, guest) {
  const going = guests.filter((g) => g.status === 'going');
  const count = headcount(guests);
  const view = {
    code: night.code, title: night.title, when: night.when, until: night.until || '', area: night.area, note: night.note || '',
    music: night.music || '', cover: coverOf(night), photo: coverOf(night) === 'photo' ? photoUrl(night) : '', cap: night.cap, spotsLeft: Math.max(0, night.cap - count),
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

export async function guestFor(night, token) {
  if (!token) return null;
  const gid = await store.cmd('GET', `gtok:${token}`);
  if (!gid) return null;
  const g = await store.getJSON(`guest:${gid}`);
  return g && g.night === night.id ? g : null;
}
