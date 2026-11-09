// Vybez DJ data: tracks, sets, reactions and crates.
import { store } from '../store.js';
import { fail, str, int } from '../lib/http.js';

export function cleanTracks(list) {
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
export const VIS = ['public', 'followers', 'unlisted', 'private'];
export async function getSet(id) { return store.getJSON(`set:${id}`); }

export async function canView(set, viewer) {
  if (!set) return false;
  if (viewer && viewer.id === set.owner) return true;
  if (set.status !== 'published' || set.visibility === 'private') return false;
  if (set.visibility === 'followers') return !!viewer && !!(await store.cmd('SISMEMBER', `u:${set.owner}:followers`, viewer.id));
  return true;
}

export async function setSummary(set) {
  const [saves, comments, ...reacts] = await store.pipe([
    ['SCARD', `set:${set.id}:savedby`], ['LLEN', `set:${set.id}:c`], ...EMOJI.map((e) => ['GET', `set:${set.id}:r:${e}`]),
  ]);
  return { ...set, saves, comments, reactions: Object.fromEntries(EMOJI.map((e, i) => [e, Number(reacts[i] || 0)])) };
}

export async function listSets(uid) {
  const ids = await store.cmd('SMEMBERS', `u:${uid}:sets`);
  const sets = (await store.mgetJSON(ids.map((i) => `set:${i}`))).filter(Boolean);
  return sets.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
}

export function readSetInput(b, existing = {}) {
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
export const EMOJI = ['🔥', '🙌', '💃', '❤️', '🤯'];

export async function listCrates(uid) {
  const ids = await store.cmd('SMEMBERS', `u:${uid}:crates`);
  return (await store.mgetJSON(ids.map((i) => `crate:${i}`))).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
}
