// Live rooms: the DJ marks tracks as they play, fans react and comment. No audio.
import { store } from '../store.js';
import { now } from '../lib/http.js';
import { publicUser } from './users.js';
import { EMOJI } from './music.js';

export async function liveState(uid) { return store.getJSON(`live:${uid}`); }
export const BUCKET = 15000;

export async function liveView(owner, live, since, viewerKey) {
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
