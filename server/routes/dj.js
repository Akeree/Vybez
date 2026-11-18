// Vybez DJ: sets, crates, profiles, explore, live rooms and insights.
import { store } from '../store.js';
import { route, fail, str, int, bool, now, EMAIL_RE, rateLimit } from '../lib/http.js';
import { hashPassword, checkPassword, makeSession, randomId, randomCode } from '../auth.js';
import { publicUser, getUser, userByHandle, needProduct, productOf, activity } from '../domain/users.js';
import { cleanTracks, VIS, getSet, canView, setSummary, listSets, readSetInput, EMOJI, listCrates } from '../domain/music.js';
import { liveState, liveView } from '../domain/live.js';

route('GET', 'me/saved', async (ctx) => {
  const u = await needProduct(ctx, 'dj');
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

// Sets
route('GET', 'sets', async (ctx) => {
  const u = await needProduct(ctx, 'dj');
  const sets = await listSets(u.id);
  return { sets: await Promise.all(sets.map(setSummary)) };
});

route('POST', 'sets', async (ctx) => {
  const u = await needProduct(ctx, 'dj');
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
  const u = await needProduct(ctx, 'dj');
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
  const u = await needProduct(ctx, 'dj');
  const set = await getSet(id);
  if (!set || set.owner !== u.id) fail(404, 'Set not found.');
  await store.pipe([['DEL', `set:${id}`, `set:${id}:c`, `set:${id}:savedby`, ...EMOJI.map((e) => `set:${id}:r:${e}`)], ['SREM', `u:${u.id}:sets`, id]]);
  return { ok: true };
});

route('POST', 'sets/:id/save', async (ctx, { id }) => {
  const u = await needProduct(ctx, 'dj');
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
route('GET', 'crates', async (ctx) => ({ crates: await listCrates((await needProduct(ctx, 'dj')).id) }));
route('POST', 'crates', async (ctx) => {
  const u = await needProduct(ctx, 'dj');
  if ((await store.cmd('SCARD', `u:${u.id}:crates`)) >= 100) fail(400, 'You’ve reached 100 crates.');
  const crate = { id: randomId(7), owner: u.id, name: str(ctx.body.name, { max: 50, name: 'Crate name', required: true }), tracks: cleanTracks(ctx.body.tracks || []), createdAt: now() };
  await store.setJSON(`crate:${crate.id}`, crate);
  await store.cmd('SADD', `u:${u.id}:crates`, crate.id);
  return { crate };
});
route('PATCH', 'crates/:id', async (ctx, { id }) => {
  const u = await needProduct(ctx, 'dj');
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
  const u = await needProduct(ctx, 'dj');
  const crate = await store.getJSON(`crate:${id}`);
  if (!crate || crate.owner !== u.id) fail(404, 'Crate not found.');
  await store.pipe([['DEL', `crate:${id}`], ['SREM', `u:${u.id}:crates`, id]]);
  return { ok: true };
});

// Profiles and explore
route('GET', 'users/:handle', async (ctx, { handle }) => {
  const u = await userByHandle(handle);
  // Vybez Social accounts have no public page: their nights are private.
  if (!u || productOf(u) !== 'dj') fail(404, 'No DJ with that handle.');
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
  const me = await needProduct(ctx, 'dj');
  const u = await userByHandle(handle);
  if (!u || productOf(u) !== 'dj') fail(404, 'No DJ with that handle.');
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
  const djs = (await store.mgetJSON(djIds.slice(0, 200).map((i) => `u:${i}`))).filter((d) => d && d.onboarded && productOf(d) === 'dj');
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
  const u = await needProduct(ctx, 'dj');
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
  const note = JSON.stringify({ type: 'live', text: `${u.name} is live: ${title}`, link: `/live/${u.handle}`, at: now() });
  // One round trip for every follower instead of one per follower.
  if (followers.length) await store.pipe(followers.slice(0, 500).flatMap((f) => [['LPUSH', `u:${f}:activity`, note], ['LTRIM', `u:${f}:activity`, 0, 199]]));
  return { live };
});

route('POST', 'live/now', async (ctx) => {
  const u = await needProduct(ctx, 'dj');
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
  const u = await needProduct(ctx, 'dj');
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
  if (!owner || productOf(owner) !== 'dj') fail(404, 'No DJ with that handle.');
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

// Insights: honest numbers from Vybez data only.
route('GET', 'insights', async (ctx) => {
  const u = await needProduct(ctx, 'dj');
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
