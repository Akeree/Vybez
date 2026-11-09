// Public pages anyone can open: live rooms, set pages, profiles, Explore, invites.
import { $, BRAND, I, ago, apple, copy, download, esc, fmtDate, fmtWhen, initials, isId, lagos, listenLinks, num, plural, seg, spotify, store, toast, trackLine } from '../core/util.js';
import { api, onSubmit, toSignin } from '../core/api.js';
import { S, mePromise } from '../core/session.js';
import { EMOJI, EMOJI_LABEL, emptyState, feedItem, statusChip, tracklistItems, visLabel } from '../core/ui.js';
const pages = {};

pages.live = async () => {
  const handle = seg(1);
  await mePromise;
  let since = 0; let feed = []; let following = false;
  const nameKey = 'vybez-guest-name';
  const cf = $('[data-comment-form]');
  if (S.me) $('[data-name-field]').hidden = true; else cf.name.value = store.get(nameKey) || '';
  let first = true;
  const render = (d) => {
    const L = d.live;
    $('[data-dj-name]').textContent = d.dj.name;
    $('[data-dj-avatar]').textContent = initials(d.dj.name);
    $('[data-dj-meta]').textContent = [d.dj.city, (d.dj.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · ');
    $('[data-dj-link]').href = `/u/${d.dj.handle}`;
    document.title = `${L.on ? 'Live: ' : ''}${d.dj.name} · Vybez`;
    $('[data-state-chips]').innerHTML = L.on ? `<span class="live-badge">Live</span><span class="chip">${I('users', 12)}${num(d.watching)} watching</span>` : `<span class="chip">${L.endedAt ? `Ended ${ago(L.endedAt)}` : 'Not live'}</span>`;
    $('[data-room-title]').textContent = L.on ? L.title : L.title ? `${L.title} has ended` : `${d.dj.name} isn’t live right now`;
    $('[data-now-label]').textContent = L.on ? 'Now playing' : L.title ? 'Last played' : '';
    const nowT = L.on ? L.now : (L.played || []).slice(-1)[0];
    $('[data-now-title]').textContent = nowT ? nowT.t : L.on ? 'Starting soon' : 'Follow to get a notification next time.';
    $('[data-now-artist]').textContent = nowT ? nowT.a : '';
    $('[data-now-links]').innerHTML = nowT && !isId(nowT) ? `<a class="btn btn-outline btn-sm" href="${spotify(nowT)}" target="_blank" rel="noopener nofollow">${BRAND.spotify}Spotify</a><a class="btn btn-outline btn-sm" href="${apple(nowT)}" target="_blank" rel="noopener nofollow">${BRAND.apple}Apple Music</a>` : '';
    $('[data-reacts]').hidden = !L.on;
    $('[data-reacts]').innerHTML = EMOJI.map((e) => `<button class="react-btn" type="button" data-emoji="${e}" aria-label="${EMOJI_LABEL[e]}, ${d.reactions[e] || 0}">${e} <span class="n">${num(d.reactions[e] || 0)}</span></button>`).join('');
    const played = L.played || [];
    $('[data-pl-count]').textContent = L.hiddenTracklist ? 'Shown after the night' : played.length ? plural(played.length, 'track') : '';
    $('[data-played]').dataset.empty = L.hiddenTracklist ? 'The DJ shares the full tracklist after the night.' : 'Tracks appear here as they’re played.';
    $('[data-played]').innerHTML = [...played].reverse().map((t, i) => `<li><span class="num mono t3">${played.length - i}</span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(t.t)}</span><span class="caption t3 ellipsis">${esc(t.a)}</span></span>${listenLinks(t)}</li>`).join('');
    $('[data-watching]').textContent = L.on ? `${num(d.watching)} watching` : '';
    cf.hidden = !L.on || L.comments === false;
    $('[data-feed]').dataset.empty = L.on ? (L.comments === false ? 'Comments are off in this room.' : 'Be the first to say something.') : 'Comments open when the DJ goes live.';
    $('[data-feed]').innerHTML = [...feed].reverse().slice(0, 100).map(feedItem).join('');
    if (d.mine) { $('[data-follow]').hidden = true; }
  };
  const fetchRoom = async () => {
    const d = await api('GET', `live/${handle}?since=${since}`);
    if (first) { feed = d.feed; } else if (d.feed.length) feed = feed.concat(d.feed).slice(-300);
    if (feed.length) since = feed[feed.length - 1].at;
    first = false;
    return d;
  };
  let d;
  try { d = await fetchRoom(); } catch (err) {
    $('[data-loading]').hidden = true; $('[data-missing]').hidden = false; return;
  }
  $('[data-loading]').hidden = true; $('[data-room]').hidden = false;
  render(d);
  try { const p = await api('GET', `users/${handle}`); following = p.following; } catch { /* ignore */ }
  const fb = $('[data-follow]');
  const setFollow = () => { fb.setAttribute('aria-pressed', String(following)); fb.textContent = following ? 'Following' : 'Follow'; fb.className = `btn ${following ? 'btn-outline' : 'btn-primary'} btn-sm`; };
  setFollow();
  fb.addEventListener('click', async () => {
    if (!S.me) { toSignin(); return; }
    try { const r = await api('POST', `users/${handle}/follow`); following = r.following; setFollow(); toast(following ? `Following ${d.dj.name}. We’ll tell you when they go live.` : 'Unfollowed.'); } catch (err) { toast(err.message); }
  });
  $('[data-share]').addEventListener('click', () => {
    const url = location.href;
    if (navigator.share) navigator.share({ title: `${d.dj.name} on Vybez`, url }).catch(() => {}); else copy(url, 'Room link copied.');
  });
  $('[data-reacts]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-emoji]'); if (!b) return;
    const n = $('.n', b); n.textContent = num(Number(n.textContent.replace(/\D/g, '')) + 1);
    try { await api('POST', `live/${handle}/react`, { emoji: b.dataset.emoji }); } catch (err) { toast(err.message); }
  });
  onSubmit(cf, async (data) => {
    if (!data.text) return;
    if (!S.me) store.set(nameKey, data.name || '');
    await api('POST', `live/${handle}/comment`, { name: data.name, text: data.text, request: !!data.request });
    cf.text.value = ''; cf.request.checked = false;
    d = await fetchRoom(); render(d);
  });
  setInterval(async () => { if (document.hidden) return; try { d = await fetchRoom(); render(d); } catch { /* retry */ } }, 4000);
};

// Public set page
pages.set = async () => {
  const id = seg(1);
  await mePromise;
  let d;
  try { d = await api('GET', `sets/${id}`); } catch { $('[data-loading]').hidden = true; $('[data-missing]').hidden = false; return; }
  const s = d.set;
  $('[data-loading]').hidden = true; $('[data-content]').hidden = false;
  document.title = `${s.title} by ${d.dj.name} · Vybez`;
  $('[data-dj-crumb]').textContent = d.dj.name; $('[data-dj-crumb]').href = `/u/${d.dj.handle}`;
  $('[data-title-crumb]').textContent = s.title;
  $('[data-meta]').textContent = ['Set', fmtDate(s.date), s.venue].filter(Boolean).join(' · ');
  $('[data-title]').textContent = s.title;
  $('[data-dj-row]').href = `/u/${d.dj.handle}`;
  $('[data-dj-avatar]').textContent = initials(d.dj.name);
  $('[data-dj-name]').textContent = d.dj.name;
  $('[data-dj-followers]').textContent = `· ${plural(d.dj.followers, 'follower')}`;
  $('[data-chips]').innerHTML = `<span class="chip">${plural(s.tracks.length, 'track')}</span>${s.source ? `<span class="chip info">${esc(s.source)}</span>` : ''}${d.mine ? statusChip(s) + `<span class="chip">${visLabel[s.visibility]}</span>` : ''}`;
  $('[data-tracklist]').innerHTML = tracklistItems(s.tracks) || '<li class="p-16 small t2">No tracks yet.</li>';
  if (d.mine) { const ed = $('[data-edit]'); ed.hidden = false; ed.href = `/dj/sets/${s.id}`; }
  if (s.link) { $('[data-rec]').hidden = false; $('[data-rec-link]').href = s.link; }
  const sb = $('[data-save]');
  let saved = d.saved;
  const setSave = () => { sb.setAttribute('aria-pressed', String(saved)); sb.textContent = saved ? 'Saved' : 'Save tracklist'; sb.className = `btn ${saved ? 'btn-outline' : 'btn-primary'}`; };
  setSave();
  sb.addEventListener('click', async () => {
    if (!S.me) { toSignin(); return; }
    try { const r = await api('POST', `sets/${s.id}/save`); saved = r.saved; setSave(); toast(saved ? 'Saved to Your Vybez.' : 'Removed from saved.'); } catch (err) { toast(err.message); }
  });
  $('[data-copy-list]').addEventListener('click', () => copy(`${s.title} · ${d.dj.name}\n${s.tracks.map((t, i) => `${i + 1}. ${trackLine(t)}`).join('\n')}`, 'Tracklist copied as text.'));
  $('[data-reacts]').innerHTML = EMOJI.map((e) => `<button class="emoji-react" type="button" data-emoji="${e}" aria-label="${EMOJI_LABEL[e]}">${e} <span>${num(s.reactions[e] || 0)}</span></button>`).join('');
  $('[data-reacts]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-emoji]'); if (!b) return;
    try { const r = await api('POST', `sets/${s.id}/react`, { emoji: b.dataset.emoji }); $('span', b).textContent = num(r.count); b.setAttribute('aria-pressed', 'true'); } catch (err) { toast(err.message); }
  });
  const cf = $('[data-comment-form]');
  if (S.me) $('[data-name-field]').hidden = true; else cf.name.value = store.get('vybez-guest-name') || '';
  const loadComments = async () => {
    const { comments } = await api('GET', `sets/${s.id}/comments`);
    $('[data-comments]').dataset.empty = 'No comments yet.';
    $('[data-comments]').innerHTML = comments.map(feedItem).join('');
  };
  onSubmit(cf, async (data) => {
    if (!data.text) return;
    if (!S.me) store.set('vybez-guest-name', data.name || '');
    await api('POST', `sets/${s.id}/comments`, { name: data.name, text: data.text });
    cf.text.value = ''; await loadComments();
  });
  loadComments().catch(() => {});
};

// Public profile
pages.profile = async () => {
  const handle = seg(1);
  await mePromise;
  let d;
  try { d = await api('GET', `users/${handle}`); } catch { $('[data-loading]').hidden = true; $('[data-missing]').hidden = false; return; }
  const u = d.user;
  $('[data-loading]').hidden = true; $('[data-content]').hidden = false;
  document.title = `${u.name} · Vybez`;
  $('[data-avatar]').textContent = initials(u.name);
  $('[data-name]').textContent = u.name;
  $('[data-bio]').textContent = u.bio || (u.role === 'dj' ? 'DJ on Vybez.' : 'On Vybez.');
  $('[data-chips]').innerHTML = (u.genres || []).map((g) => `<span class="chip">${esc(g)}</span>`).join('') + (u.city ? `<span class="chip">${I('globe', 12)}${esc(u.city)}</span>` : '');
  $('[data-badges]').innerHTML = d.live ? `<a class="live-badge" href="/live/${u.handle}">Live now</a>` : '';
  $('[data-followers]').textContent = num(d.followers);
  $('[data-set-count]').textContent = num(d.sets.length);
  $('[data-since]').textContent = new Date(u.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  $('[data-sets]').innerHTML = d.sets.length ? `<div class="row between"><h2 class="h3">Sets</h2><span class="caption t3">Newest first</span></div>${d.sets.map((s, i) => `<a class="card set-row" href="/s/${s.id}"><span class="art g${(i % 6) + 1}" style="width:72px;height:72px;border-radius:16px"></span><span class="stack grow gap-4" style="min-width:180px"><span class="h4">${esc(s.title)}</span><span class="caption t3">${[fmtDate(s.date), s.venue, plural(s.tracks, 'track')].filter(Boolean).map(esc).join(' · ')}</span>${s.source ? `<span class="chip info" style="align-self:flex-start">${esc(s.source)}</span>` : ''}</span><span class="row gap-8 set-actions"><span class="btn btn-outline btn-sm">${I('list-music', 16)}Tracklist</span></span></a>`).join('')}` : emptyState('list-music', 'No public sets yet', d.mine ? 'Publish a set and it shows up here.' : 'Follow to hear when the first one lands.', d.mine ? '<a class="btn btn-outline btn-sm" href="/dj/sets">Your sets</a>' : '');
  $('[data-about]').innerHTML = `<h2 class="h4">About</h2><p class="t2">${esc(u.bio || 'No bio yet.')}</p>${u.software ? `<p class="small t2">Plays on ${esc(u.software)}</p>` : ''}`;
  if (d.live) { const l = $('[data-live]'); l.hidden = false; l.innerHTML = `<div class="row gap-8"><span class="live-badge">Live</span><span class="caption t3">Started ${ago(d.live.startedAt)}</span></div><p class="h4">${esc(d.live.title)}</p>${d.live.now ? `<p class="small t2">Now playing: ${esc(trackLine(d.live.now))}</p>` : ''}<a class="btn btn-primary btn-sm" href="/live/${u.handle}" style="align-self:flex-start">${I('radio', 16)}Join the room</a>`; }
  const links = Object.entries(u.links || {});
  if (links.length) { $('[data-links]').hidden = false; $('[data-link-list]').innerHTML = links.map(([k, v]) => `<a class="link" href="${esc(v)}" target="_blank" rel="noopener nofollow me">${(window.VZ_BRANDS || {})[k] || I('external-link', 14)} ${esc({ mixcloud: 'Mixcloud', soundcloud: 'SoundCloud', instagram: 'Instagram', youtube: 'YouTube' }[k] || k)}</a>`).join(''); }
  const fb = $('[data-follow]');
  let following = d.following;
  if (d.mine) { fb.hidden = true; $('[data-edit]').hidden = false; }
  const setFollow = () => { fb.setAttribute('aria-pressed', String(following)); fb.textContent = following ? 'Following' : 'Follow'; fb.className = `btn ${following ? 'btn-outline' : 'btn-primary'}`; };
  setFollow();
  fb.addEventListener('click', async () => {
    if (!S.me) { toSignin(); return; }
    try { const r = await api('POST', `users/${handle}/follow`); following = r.following; setFollow(); $('[data-followers]').textContent = num(r.followers); } catch (err) { toast(err.message); }
  });
  $('[data-share]').addEventListener('click', () => { if (navigator.share) navigator.share({ title: `${u.name} on Vybez`, url: location.href }).catch(() => {}); else copy(location.href, 'Profile link copied.'); });
};


pages.explore = async () => {
  let d;
  try { d = await api('GET', 'explore'); } catch { return; }
  await mePromise;
  if (d.live.length) {
    $('[data-real-live]').hidden = false;
    $('[data-live-list]').innerHTML = d.live.map((r, i) => `<article class="live-card stack gap-16"><a class="cover rings photo" href="/live/${r.dj.handle}" style="border-radius:16px;aspect-ratio:413/250;display:block" aria-label="Join ${esc(r.dj.name)}"><div class="over" style="left:16px;top:16px"><span class="live-badge">Live</span></div></a><div class="row gap-16"><div class="stack grow gap-2" style="min-width:0"><h3 class="h4 ellipsis">${esc(r.title)}</h3><p class="caption t3 ellipsis">${esc(r.dj.name)}${r.now ? ` · Now playing: ${esc(r.now.t)}, ${esc(r.now.a)}` : ''}</p></div><a class="btn btn-primary btn-sm" href="/live/${r.dj.handle}">Join</a></div></article>`).join('');
  }
  const djs = d.djs.filter((x) => x.id !== S.me?.id);
  if (djs.length) {
    $('[data-real-djs]').hidden = false;
    $('[data-dj-list]').innerHTML = djs.map((x) => `<div class="card follow-card"><span class="avatar md">${esc(initials(x.name))}</span><a class="stack grow" href="/u/${x.handle}" style="min-width:0"><span class="label ellipsis">${esc(x.name)}</span><span class="caption t3 ellipsis">${esc([(x.genres || [])[0], x.city, `${num(x.followers)} followers`].filter(Boolean).join(' · '))}</span></a><button class="btn ${x.following ? 'btn-outline' : 'btn-primary'} btn-sm" type="button" data-follow-handle="${esc(x.handle)}" aria-pressed="${x.following}">${x.following ? 'Following' : 'Follow'}</button></div>`).join('');
    $('[data-dj-list]').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-follow-handle]'); if (!b) return;
      if (!S.me) { toSignin(); return; }
      try { const r = await api('POST', `users/${b.dataset.followHandle}/follow`); b.setAttribute('aria-pressed', String(r.following)); b.textContent = r.following ? 'Following' : 'Follow'; b.className = `btn ${r.following ? 'btn-outline' : 'btn-primary'} btn-sm`; } catch (err) { toast(err.message); }
    });
  }
  if (d.sets.length) {
    $('[data-real-sets]').hidden = false;
    $('[data-set-list]').innerHTML = d.sets.map((s, i) => `<a class="card set-row" href="/s/${s.id}"><span class="art g${(i % 6) + 1}"></span><span class="stack grow gap-2"><span class="label">${esc(s.title)}</span><span class="caption t3">${esc(s.dj?.name || '')} · ${fmtDate(s.date)} · ${plural(s.tracks, 'track')}</span></span>${I('chevron-right', 18)}</a>`).join('');
  }
};

// Vybez Social: host pages

pages.invite = async () => {
  const code = seg(1);
  const key = `vybez-guest-${code}`;
  let token = store.get(key);
  let inv;
  const load = async () => { inv = (await api('GET', `invites/${code}${token ? `?guest=${encodeURIComponent(token)}` : ''}`)).invite; };
  try { await load(); } catch { $('[data-loading]').hidden = true; $('[data-missing]').hidden = false; return; }
  $('[data-loading]').hidden = true; $('[data-content]').hidden = false;
  const coverEl = $('[data-cover]');
  if (inv.cover && inv.cover !== 'rings') {
    coverEl.className = 'cover photo-cover';
    coverEl.insertAdjacentHTML('afterbegin', `<img src="/img/${esc(inv.cover)}.webp" alt="" width="1264" height="848">`);
  }
  const rf = $('[data-rsvp]');
  const render = () => {
    document.title = `${inv.title} · Vybez`;
    const g = inv.guest;
    const cancelled = inv.status === 'cancelled';
    $('[data-chips]').innerHTML = `<span class="chip accent">${I('lock', 12)}Invite only${inv.spotsLeft <= 10 ? ` · ${plural(inv.spotsLeft, 'spot')} left` : ''}</span>${g?.status === 'going' ? '<span class="chip success">You’re going</span>' : ''}`;
    $('[data-title]').textContent = inv.title;
    $('[data-host]').textContent = `Hosted by ${inv.host.name}`;
    $('[data-cancelled]').hidden = !cancelled;
    $('[data-when]').textContent = fmtWhen(inv.when, { year: undefined });
    $('[data-until]').textContent = `${inv.until ? `Until ${inv.until}` : 'Until late'} · Lagos time`;
    $('[data-place]').textContent = inv.place || inv.area;
    $('[data-place-note]').textContent = inv.place ? inv.area : (inv.approve ? 'Exact address after the host approves you' : 'Exact address after you RSVP');
    $('[data-place-icon]').innerHTML = I(inv.place ? 'map-pin' : 'lock', 18);
    $('[data-music-row]').hidden = !inv.music && !inv.songs;
    $('[data-music]').textContent = inv.music ? `Music by ${inv.music}` : 'Music by the host';
    $('[data-music-note]').textContent = inv.songs ? 'Bring a song. You can add 2.' : '';
    $('[data-note]').hidden = !inv.note; $('[data-note]').textContent = inv.note;
    $('[data-going]').textContent = inv.going ? `${inv.goingNames.join(', ')}${inv.going > inv.goingNames.length ? ` and ${inv.going - inv.goingNames.length} ${inv.going - inv.goingNames.length === 1 ? 'other' : 'others'}` : ''} ${inv.going === 1 ? 'is' : 'are'} going` : 'Be the first to say yes.';
    $('[data-host-chip]').hidden = !inv.isHost;
    if (inv.isHost) { const m = $('[data-manage]'); m.hidden = false; m.href = `/social/${inv.nightId}`; }
    const showForm = !cancelled && (!g || ['cant', 'left'].includes(g.status));
    rf.hidden = !showForm;
    $('[data-plus-row]').hidden = !inv.plusOnes;
    if (g && showForm) rf.name.value = g.name;
    const st = $('[data-status]');
    const msgs = {
      asking: ['hourglass', `Thanks, ${g?.name.split(' ')[0]}. ${inv.host.name} will approve you soon.`, 'Keep this page: the address and your pass appear here once you’re approved. It works on this device without an account.'],
      waitlist: ['hourglass', 'You’re on the waitlist.', 'The night is full right now. If a spot opens, the host can let you in.'],
      declined: ['circle-x', 'The host couldn’t fit you in this time.', 'Thanks for asking. Maybe next time.'],
      going: ['circle-check', `You’re on the list, ${g?.name.split(' ')[0]}.`, inv.place ? 'Here’s everything you need.' : ''],
    };
    const m = g && msgs[g.status];
    st.hidden = !m || cancelled;
    if (m) st.innerHTML = `<div class="row gap-16"><span class="tile" style="${g.status === 'going' ? 'background:var(--success-subtle);color:var(--success)' : ''}">${I(m[0], 24)}</span><span class="stack gap-2"><span class="h4">${esc(m[1])}</span><span class="small t2">${esc(m[2])}</span></span></div>`;
    const going = g?.status === 'going' && !cancelled;
    $('[data-pass]').hidden = !going || !g.pass;
    if (going && g.pass) $('[data-pass-code]').textContent = g.checkedIn ? `${g.pass} ✓` : g.pass;
    $('[data-address]').hidden = !going || !inv.place;
    if (going && inv.place) {
      $('[data-address-text]').textContent = inv.place;
      $('[data-maps]').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${inv.place}, ${inv.area}`)}`;
    }
    $('[data-songs]').hidden = !going || !inv.songs;
    if (going && inv.songs) {
      const songs = g.songs || [];
      $('[data-songs-left]').textContent = `${2 - songs.length} of 2 left`;
      $('[data-song-list]').innerHTML = songs.map((s, i) => `<li class="row gap-16"><span class="art g1"></span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(s.t)}</span><span class="caption t3 ellipsis">${esc(s.a)}${inv.music ? ` · sent to ${esc(inv.music)}` : ''}</span></span><button class="icon-btn ghost" type="button" data-rm-song="${i}" aria-label="Remove ${esc(s.t)}">${I('x', 16)}</button></li>`).join('');
      $('[data-song-form]').hidden = songs.length >= 2;
    }
    $('[data-leave]').hidden = !g || !['going', 'asking', 'waitlist'].includes(g.status) || cancelled;
  };
  onSubmit(rf, async (d) => {
    const r = await api('POST', `invites/${code}/rsvp`, { name: d.name, contact: d.contact, plus: !!d.plus, guest: token || undefined });
    token = r.guest; store.set(key, token); inv = { ...r.invite, isHost: inv.isHost, nightId: inv.nightId }; render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('[data-cant]').addEventListener('click', async () => {
    const name = rf.name.value.trim();
    if (!name && !token) { rf.name.focus(); rf.reportValidity(); return; }
    try { await api('POST', `invites/${code}/cant`, { name, guest: token || undefined }); toast(`Thanks for letting ${inv.host.name} know.`); await load(); render(); } catch (err) { toast(err.message); }
  });
  const sf = $('[data-song-form]');
  sf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = sf.a.value.trim(); const t = sf.t.value.trim(); if (!t && !a) { sf.t.focus(); return; }
    try { const r = await api('POST', `invites/${code}/song`, { guest: token, track: { a, t } }); inv.guest.songs = r.songs; sf.reset(); render(); } catch (err) { toast(err.message); }
  });
  $('[data-song-list]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm-song]'); if (!b) return;
    try { const r = await api('POST', `invites/${code}/song`, { guest: token, remove: +b.dataset.rmSong }); inv.guest.songs = r.songs; render(); } catch (err) { toast(err.message); }
  });
  $('[data-leave]').addEventListener('click', async () => {
    if (!window.confirm('Leave the list? The host will be told.')) return;
    try { await api('POST', `invites/${code}/leave`, { guest: token }); await load(); render(); toast('You’ve left the list.'); } catch (err) { toast(err.message); }
  });
  $('[data-ics]').addEventListener('click', () => {
    const start = lagos(inv.when);
    const end = new Date(start.getTime() + 5 * 3600000);
    const f = (dt) => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const escI = (s) => String(s || '').replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    download(`${inv.title.replace(/[^\w -]+/g, '') || 'invite'}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vybez//Social//EN', 'BEGIN:VEVENT', `UID:${code}@vybez`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${escI(inv.title)}`, `LOCATION:${escI(`${inv.place || ''}, ${inv.area}`)}`, `DESCRIPTION:${escI(`Hosted by ${inv.host.name}. ${location.href}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'), 'text/calendar');
  });
  render();
  // Waiting for approval: check again every 30 seconds.
  setInterval(async () => { if (document.hidden || !token || !['asking', 'waitlist'].includes(inv.guest?.status)) return; try { await load(); render(); } catch { /* ignore */ } }, 30000);
};


pages.upgrade = async () => {
  await mePromise;
  if (!S.me) { const n = document.createElement('p'); n.className = 'notice'; n.innerHTML = `${I('info', 18)}<span>You’ll need a free account first. <a class="link" href="/signup?next=/upgrade">Create one</a> or <a class="link" href="/signin?next=/upgrade">sign in</a>.</span>`; $('[data-pay]').prepend(n); }
};


export default pages;
