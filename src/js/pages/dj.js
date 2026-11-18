// Vybez DJ pages (signed-in DJ accounts).
import { $, $$, I, ago, copy, download, esc, fmtDate, fmtWhen, initials, lagos, num, params, plural, seg, store, toast, trackLine } from '../core/util.js';
import { api, clearError, onSubmit, showError } from '../core/api.js';
import { S, mePromise, requireUser } from '../core/session.js';
import { readPlaylistFile, splitArtistTitle } from '../core/playlist.js';
import { EMOJI, activityRow, bindImport, createSetFromFile, emptyState, feedItem, nightRow, statusChip, visLabel } from '../core/ui.js';
const pages = {};

pages.dashboard = async () => {
  await mePromise;
  if (!S.me) return; // demo stays
  $('[data-demo]').hidden = true;
  const real = $('[data-real]'); real.hidden = false;
  const hour = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }));
  $('[data-greeting]').textContent = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${S.me.name.split(' ').slice(-1)[0] === S.me.name ? S.me.name : S.me.name.replace(/^DJ\s+/i, '')}`;
  const profileUrl = `${location.origin}/u/${S.me.handle}`;
  $('[data-profile-url]').textContent = profileUrl.replace(/^https?:\/\//, '');
  $('[data-profile-link]').href = `/u/${S.me.handle}`;
  $('[data-copy-profile]').addEventListener('click', () => copy(profileUrl, 'Profile link copied.'));
  const [{ sets }, ins, notifs] = await Promise.all([api('GET', 'sets'), api('GET', 'insights'), api('GET', 'notifications')]);
  const drafts = sets.filter((s) => s.status !== 'published').length;
  $('[data-summary]').textContent = sets.length
    ? `${plural(sets.length, 'set')}${drafts ? `, ${drafts} still in draft` : ''}.`
    : 'Let’s get your first set in.';
  const gs = [
    { done: !!(S.me.bio && S.me.city), text: 'Add a bio and city', href: '/dj/settings#profile' },
    { done: sets.length > 0, text: 'Import your first set', href: '/dj/sets?import=1' },
    { done: sets.some((s) => s.status === 'published'), text: 'Publish a tracklist', href: '/dj/sets' },
    { done: ins.followers > 0, text: 'Share your page for a first follower', href: `/u/${S.me.handle}` },
  ];
  if (gs.some((g) => !g.done)) {
    $('[data-getting-started]').hidden = false;
    $('[data-gs-count]').textContent = `${gs.filter((g) => g.done).length} of ${gs.length} done`;
    $('[data-gs-list]').innerHTML = gs.map((g) => `<li>${g.done ? `<span class="done">${I('circle-check', 18)}${esc(g.text)}</span>` : `<a href="${g.href}">${I('chevron-right', 18)}${esc(g.text)}</a>`}</li>`).join('');
  }
  const kpi = (label, n, chip = '<span class="chip success">Verified</span>') => `<div class="card kpi"><div class="row between"><span class="caption t2">${label}</span>${chip}</div><span class="kpi-num">${num(n)}</span></div>`;
  $('[data-kpis]').innerHTML = kpi('Followers', ins.followers) + kpi('Tracklist saves', ins.saves) + kpi('Reactions', ins.reactions) + kpi('Published sets', ins.published, `<a class="link" href="/dj/insights" style="padding:0">Insights</a>`);
  $('[data-recent-sets]').innerHTML = sets.length
    ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Set</th><th scope="col" class="hide-sm">Tracks</th><th scope="col">Status</th><th scope="col" style="text-align:right">Saves</th></tr></thead><tbody>${sets.slice(0, 6).map((s, i) => `<tr><td><a class="row gap-16" href="/dj/sets/${s.id}"><span class="art g${(i % 6) + 1}"></span><span class="stack"><span class="label">${esc(s.title)}</span><span class="caption t3">${fmtDate(s.date)}${s.venue ? ` · ${esc(s.venue)}` : ''}</span></span></a></td><td class="mono hide-sm">${s.tracks.length}</td><td>${statusChip(s)}</td><td class="mono" style="text-align:right">${s.saves || '—'}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><p class="small t2">No sets yet. Import an export from your DJ software, or type a tracklist in.</p><a class="btn btn-primary btn-sm" href="/dj/sets?import=1">${I('upload', 16)}Import a set</a></div>`;
  const acts = notifs.items.slice(0, 6);
  $('[data-activity]').innerHTML = acts.length ? acts.map(activityRow).join('') : '<p class="small t2">When people follow you, save a tracklist or RSVP, it shows up here.</p>';
};


pages.sets = async () => {
  await mePromise;
  if (!S.me) return;
  $('[data-demo]').hidden = true;
  $('[data-real]').hidden = false;
  bindImport($('[data-import]'), $('#import-file'), createSetFromFile);
  if (params.get('import')) setTimeout(() => $('[data-import]').scrollIntoView({ block: 'center' }), 50);
  $('[data-new-set]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const { set } = await api('POST', 'sets', { title: `New set · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, source: 'Added by hand' });
      location.href = `/dj/sets/${set.id}`;
    } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  });
  let sets = [];
  let filter = 'all';
  const render = () => {
    const q = ($('[data-set-search]').value || '').toLowerCase();
    const list = sets.filter((s) => (filter === 'all' || (filter === 'published' ? s.status === 'published' : s.status !== 'published')) && (!q || `${s.title} ${s.venue || ''}`.toLowerCase().includes(q)));
    const counts = { all: sets.length, published: sets.filter((s) => s.status === 'published').length, draft: sets.filter((s) => s.status !== 'published').length };
    $$('[data-set-filter] [data-f]').forEach((b) => { b.textContent = `${{ all: 'All', published: 'Published', draft: 'Drafts' }[b.dataset.f]} ${counts[b.dataset.f]}`; });
    $('[data-set-list]').innerHTML = !sets.length
      ? emptyState('list-music', 'No sets yet', 'Drop an export above, or add tracks by hand. Drafts stay private until you publish.')
      : !list.length ? '<p class="small t2" style="padding:16px 0">No sets match.</p>'
        : `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Set</th><th scope="col" class="hide-sm">Source</th><th scope="col" class="hide-sm">Tracks</th><th scope="col">Status</th><th scope="col" class="hide-sm">Who sees it</th><th scope="col" style="text-align:right">Saves</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map((s, i) => `<tr><td><a class="row gap-16" href="/dj/sets/${s.id}"><span class="art g${(i % 6) + 1}"></span><span class="stack"><span class="label">${esc(s.title)}</span><span class="caption t3">${fmtDate(s.date)}${s.venue ? ` · ${esc(s.venue)}` : ''}</span></span></a></td><td class="small t2 hide-sm">${esc(s.source || 'Added by hand')}</td><td class="mono hide-sm">${s.tracks.length}</td><td>${statusChip(s)}</td><td class="small t2 hide-sm">${visLabel[s.visibility] || ''}</td><td class="mono" style="text-align:right">${s.saves || '—'}</td><td><a class="icon-btn ghost" href="/dj/sets/${s.id}" aria-label="Edit ${esc(s.title)}">${I('pencil', 18)}</a></td></tr>`).join('')}</tbody></table></div>`;
  };
  $$('[data-set-filter] [data-f]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    $$('[data-set-filter] [data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
  $('[data-set-search]').addEventListener('input', render);
  try { sets = (await api('GET', 'sets')).sets; render(); } catch (err) { $('[data-set-list]').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
};

pages['set-edit'] = async () => {
  await requireUser();
  const id = seg(2);
  let set;
  try { ({ set } = await api('GET', `sets/${id}`)); } catch (err) {
    $('[data-crumb]').textContent = 'Not found';
    $('[data-loading] .skeleton').outerHTML = emptyState('list-music', 'Set not found', 'It may have been deleted.', '<a class="btn btn-outline btn-sm" href="/dj/sets">Back to sets</a>');
    return;
  }
  if (set.owner !== S.me.id) { location.replace(`/s/${id}`); return; }
  $('[data-loading]').hidden = true;
  $('[data-editor]').hidden = false;
  let tracks = set.tracks.map((t) => ({ ...t }));
  let dirty = false;
  const form = $('[data-details]');
  form.title.value = set.title; form.date.value = set.date || ''; form.venue.value = set.venue || ''; form.link.value = set.link || ''; form.visibility.value = set.visibility || 'public'; form.notes.value = set.notes || '';
  const mark = (d = true) => { dirty = d; $('[data-saved-at]').textContent = d ? 'Unsaved changes' : `Saved ${ago(Date.now())}`; };
  const head = () => {
    $('[data-title-out]').textContent = form.title.value || 'Untitled set';
    $('[data-crumb]').textContent = form.title.value || 'Untitled set';
    document.title = `${form.title.value || 'Edit set'} · Vybez`;
    const pub = set.status === 'published';
    $('[data-status-chip]').className = `chip dot ${pub ? 'success' : 'warning'}`;
    $('[data-status-chip]').textContent = pub ? `Published · ${visLabel[set.visibility]}` : 'Draft · only you can see it';
    $('[data-publish]').textContent = pub ? 'Unpublish' : 'Publish';
    $('[data-publish]').className = `btn ${pub ? 'btn-outline' : 'btn-primary'} btn-pad-sm`;
    $('[data-view-public]').href = `/s/${set.id}`;
    $('[data-live-with]').href = `/dj/live?set=${set.id}`;
  };
  const renderTracks = () => {
    $('[data-track-count]').textContent = plural(tracks.length, 'track');
    $('[data-tracks]').innerHTML = tracks.length ? tracks.map((t, i) => `<li class="edit-track" data-i="${i}">
      <span class="mono t3">${i + 1}</span>
      <input class="input" aria-label="Artist, track ${i + 1}" data-k="a" value="${esc(t.a)}" maxlength="160">
      <input class="input" aria-label="Title, track ${i + 1}" data-k="t" value="${esc(t.t)}" maxlength="200">
      <input class="input hide-sm" aria-label="BPM, track ${i + 1}" data-k="bpm" value="${esc(t.bpm || '')}" inputmode="numeric" maxlength="3">
      <input class="input hide-sm" aria-label="Key, track ${i + 1}" data-k="key" value="${esc(t.key || '')}" maxlength="8">
      <input class="input hide-sm" aria-label="Time played, track ${i + 1}" data-k="at" value="${esc(t.at || '')}" maxlength="12" placeholder="0:00">
      <span class="row-actions"><button class="icon-btn ghost" type="button" data-move="-1" aria-label="Move track ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${I('arrow-up', 16)}</button><button class="icon-btn ghost" type="button" data-move="1" aria-label="Move track ${i + 1} down" ${i === tracks.length - 1 ? 'disabled' : ''}>${I('arrow-down', 16)}</button><button class="icon-btn ghost" type="button" data-remove aria-label="Remove track ${i + 1}">${I('trash-2', 16)}</button></span>
    </li>`).join('') : '<li class="p-16 small t2">No tracks yet. Add them below, paste a list, or add from a file.</li>';
  };
  $('[data-tracks]').addEventListener('input', (e) => {
    const li = e.target.closest('[data-i]'); if (!li) return;
    const t = tracks[+li.dataset.i]; const k = e.target.dataset.k;
    t[k] = k === 'bpm' ? (parseInt(e.target.value, 10) || undefined) : e.target.value;
    mark();
  });
  $('[data-tracks]').addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]'); if (!li) return;
    const i = +li.dataset.i;
    const mv = e.target.closest('[data-move]');
    if (mv) { const j = i + Number(mv.dataset.move); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; renderTracks(); mark(); $(`[data-i="${j}"] [data-move="${mv.dataset.move}"]`)?.focus(); }
    if (e.target.closest('[data-remove]')) { tracks.splice(i, 1); renderTracks(); mark(); }
  });
  const addForm = $('[data-add-track]');
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = addForm.a.value.trim(); const t = addForm.t.value.trim();
    if (!a && !t) { addForm.a.focus(); return; }
    tracks.push({ a, t }); renderTracks(); mark(); addForm.reset(); addForm.a.focus();
  });
  form.addEventListener('input', () => { mark(); head(); });
  const dlg = $('[data-paste-dialog]');
  $('[data-paste-open]').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const box = $('#paste-box');
    const added = box.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitArtistTitle);
    tracks.push(...added); box.value = ''; renderTracks(); mark();
    toast(`Added ${plural(added.length, 'track')}.`);
  });
  $('#ed-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const r = await readPlaylistFile(f); tracks.push(...r.tracks); renderTracks(); mark(); toast(`Added ${plural(r.tracks.length, 'track')} from ${f.name}.`); } catch (err) { toast(err.message); }
  });
  const save = async (extra = {}) => {
    clearError(form);
    if (!form.reportValidity()) throw new Error('Give the set a name.');
    const body = { title: form.title.value, date: form.date.value, venue: form.venue.value, link: form.link.value, visibility: form.visibility.value, notes: form.notes.value, tracks: tracks.filter((t) => (t.a || '').trim() || (t.t || '').trim()), ...extra };
    try { ({ set } = await api('PATCH', `sets/${id}`, body)); } catch (err) { showError(form, err); throw err; }
    tracks = set.tracks.map((t) => ({ ...t }));
    renderTracks(); mark(false); head();
  };
  $('[data-save]').addEventListener('click', async () => { try { await save(); toast('Saved.'); } catch { /* shown */ } });
  $('[data-publish]').addEventListener('click', async () => {
    const pub = set.status === 'published';
    try { await save({ status: pub ? 'draft' : 'published' }); toast(pub ? 'Unpublished. Only you can see it now.' : 'Published. Your crowd can see the tracklist.'); } catch { /* shown */ }
  });
  $('[data-download]').addEventListener('click', () => download(`${(form.title.value || 'set').replace(/[^\w -]+/g, '')}.txt`, `${form.title.value}\n${form.date.value}${form.venue.value ? ` · ${form.venue.value}` : ''}\n\n${tracks.map((t, i) => `${i + 1}. ${trackLine(t)}`).join('\n')}\n`));
  $('[data-delete]').addEventListener('click', async () => {
    if (!window.confirm(`Delete “${set.title}”? This can’t be undone.`)) return;
    try { await api('DELETE', `sets/${id}`); store.set('vybez-flash', 'Set deleted.'); location.href = '/dj/sets'; } catch (err) { toast(err.message); }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  head(); renderTracks(); mark(false);
  $('[data-saved-at]').textContent = `Last saved ${ago(set.updatedAt)}`;
};

pages.library = async () => {
  await requireUser();
  const [{ sets }, cratesRes] = await Promise.all([api('GET', 'sets'), api('GET', 'crates')]);
  let crates = cratesRes.crates;
  const map = new Map();
  for (const s of sets) for (const t of s.tracks) {
    const k = `${(t.a || '').toLowerCase()}|${(t.t || '').toLowerCase()}`;
    const e = map.get(k) || { a: t.a, t: t.t, bpm: t.bpm, key: t.key, sets: [], last: '' };
    e.sets.push(s); if (!e.bpm && t.bpm) e.bpm = t.bpm; if (!e.key && t.key) e.key = t.key;
    if ((s.date || '') > e.last) e.last = s.date || '';
    map.set(k, e);
  }
  const all = [...map.values()];
  $('[data-n="tracks"]').textContent = num(all.length);
  $('[data-n="artists"]').textContent = num(new Set(all.map((t) => t.a.toLowerCase())).size);
  $('[data-n="sets"]').textContent = num(sets.length);
  let sort = 'most';
  const render = () => {
    const q = ($('[data-lib-search]').value || '').toLowerCase();
    const list = all.filter((t) => !q || `${t.a} ${t.t}`.toLowerCase().includes(q));
    list.sort({
      most: (a, b) => b.sets.length - a.sets.length || a.a.localeCompare(b.a),
      recent: (a, b) => b.last.localeCompare(a.last),
      artist: (a, b) => a.a.localeCompare(b.a) || a.t.localeCompare(b.t),
      bpm: (a, b) => (a.bpm || 999) - (b.bpm || 999),
    }[sort]);
    $('[data-lib-list]').innerHTML = !all.length
      ? emptyState('library', 'Your library is empty', 'Tracks appear here as soon as you import or build a set.', '<a class="btn btn-primary btn-sm" href="/dj/sets?import=1">Import a set</a>')
      : `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Track</th><th scope="col" class="hide-sm">BPM</th><th scope="col" class="hide-sm">Key</th><th scope="col">Sets</th><th scope="col" class="hide-sm">Last played</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.slice(0, 500).map((t) => `<tr><td><span class="stack"><span class="label">${esc(t.t || 'Untitled')}</span><span class="caption t3">${esc(t.a)}</span></span></td><td class="mono hide-sm">${t.bpm || '—'}</td><td class="mono hide-sm">${esc(t.key || '—')}</td><td><span class="chip" title="${esc(t.sets.map((s) => s.title).join(', '))}">${t.sets.length}</span></td><td class="small t2 hide-sm">${fmtDate(t.last)}</td><td><button class="icon-btn ghost" type="button" data-to-crate="${esc(JSON.stringify({ a: t.a, t: t.t, bpm: t.bpm, key: t.key }))}" aria-label="Add ${esc(t.t)} to a crate">${I('folder-plus', 18)}</button></td></tr>`).join('')}</tbody></table></div>${list.length > 500 ? '<p class="caption t3">Showing 500. Search to narrow it down.</p>' : ''}`;
  };
  $$('[data-lib-sort] [data-s]').forEach((b) => b.addEventListener('click', () => { sort = b.dataset.s; $$('[data-lib-sort] [data-s]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }));
  $('[data-lib-search]').addEventListener('input', render);
  const dlg = $('[data-crate-dialog]');
  let pick = null;
  const renderOpts = () => {
    $('[data-crate-options]').innerHTML = crates.length ? crates.map((c) => `<button class="crate-item" type="button" data-crate="${c.id}">${I('folder', 18)}<span class="grow">${esc(c.name)}</span><span class="caption t3">${c.tracks.length}</span></button>`).join('') : '<p class="small t2">No crates yet. Name one below.</p>';
  };
  $('[data-lib-list]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-to-crate]'); if (!b) return;
    pick = JSON.parse(b.dataset.toCrate);
    $('[data-crate-track]').textContent = trackLine(pick);
    renderOpts(); dlg.showModal();
  });
  $('[data-crate-options]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-crate]'); if (!b) return;
    try { const { crate } = await api('PATCH', `crates/${b.dataset.crate}`, { add: pick }); crates = crates.map((c) => (c.id === crate.id ? crate : c)); dlg.close(); toast(`Added to ${crate.name}.`); } catch (err) { toast(err.message); }
  });
  $('[data-crate-create]').addEventListener('click', async () => {
    const name = $('#new-crate').value.trim(); if (!name) { $('#new-crate').focus(); return; }
    try { const { crate } = await api('POST', 'crates', { name, tracks: [pick] }); crates.push(crate); $('#new-crate').value = ''; dlg.close(); toast(`Created ${crate.name} with this track.`); } catch (err) { toast(err.message); }
  });
  render();
};

pages.crates = async () => {
  await requireUser();
  let { crates } = await api('GET', 'crates');
  let current = params.get('id') || crates[0]?.id;
  const renderList = () => {
    $('[data-crate-list]').innerHTML = crates.length ? crates.map((c) => `<button class="crate-item" type="button" data-crate="${c.id}" aria-current="${c.id === current}">${I('folder', 18)}<span class="grow ellipsis">${esc(c.name)}</span><span class="caption t3">${c.tracks.length}</span></button>`).join('') : '<p class="small t2">No crates yet.</p>';
  };
  const renderDetail = () => {
    const c = crates.find((x) => x.id === current);
    const box = $('[data-crate-detail]');
    if (!c) { box.innerHTML = emptyState('layers', crates.length ? 'Pick a crate' : 'Make your first crate', 'Name it above, then add tracks from your <a class="link" href="/dj/library">Library</a>.'); return; }
    box.innerHTML = `<div class="p-16 row between wrap-row gap-8" style="border-bottom:1px solid var(--border-subtle)"><form class="row gap-8 grow" data-rename style="min-width:220px"><label class="sr-only" for="cr-name">Crate name</label><input class="input" id="cr-name" value="${esc(c.name)}" maxlength="50" style="height:40px"><button class="btn btn-outline btn-sm" type="submit">Rename</button></form><div class="row gap-8"><button class="btn btn-primary btn-sm" type="button" data-to-set ${c.tracks.length ? '' : 'disabled'}>${I('list-plus', 16)}Make a set</button><button class="icon-btn ghost" type="button" data-del aria-label="Delete crate">${I('trash-2', 18)}</button></div></div>
      <ol>${c.tracks.length ? c.tracks.map((t, i) => `<li class="list-row"><span class="mono t3" style="width:24px">${i + 1}</span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(t.t)}</span><span class="caption t3 ellipsis">${esc(t.a)}${t.bpm ? ` · ${t.bpm} BPM` : ''}</span></span><button class="icon-btn ghost" type="button" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>${I('arrow-up', 16)}</button><button class="icon-btn ghost" type="button" data-rm="${i}" aria-label="Remove ${esc(t.t)}">${I('x', 16)}</button></li>`).join('') : `<li class="p-16 small t2">Empty. Add tracks from your <a class="link" href="/dj/library">Library</a> with the ${I('folder-plus', 14)} button.</li>`}</ol>`;
  };
  const update = async (body) => { const { crate } = await api('PATCH', `crates/${current}`, body); crates = crates.map((c) => (c.id === crate.id ? crate : c)); renderList(); renderDetail(); };
  $('[data-crate-list]').addEventListener('click', (e) => { const b = e.target.closest('[data-crate]'); if (!b) return; current = b.dataset.crate; history.replaceState(null, '', `?id=${current}`); renderList(); renderDetail(); });
  $('[data-crate-detail]').addEventListener('submit', async (e) => { e.preventDefault(); try { await update({ name: $('#cr-name').value }); toast('Renamed.'); } catch (err) { toast(err.message); } });
  $('[data-crate-detail]').addEventListener('click', async (e) => {
    const c = crates.find((x) => x.id === current); if (!c) return;
    try {
      const up = e.target.closest('[data-up]'); const rm = e.target.closest('[data-rm]');
      if (up) { const t = [...c.tracks]; const i = +up.dataset.up; [t[i - 1], t[i]] = [t[i], t[i - 1]]; await update({ tracks: t }); }
      if (rm) { const t = [...c.tracks]; t.splice(+rm.dataset.rm, 1); await update({ tracks: t }); }
      if (e.target.closest('[data-del]')) {
        if (!window.confirm(`Delete the crate “${c.name}”? Tracks stay in your library.`)) return;
        await api('DELETE', `crates/${c.id}`); crates = crates.filter((x) => x.id !== c.id); current = crates[0]?.id; renderList(); renderDetail(); toast('Crate deleted.');
      }
      if (e.target.closest('[data-to-set]')) {
        const { set } = await api('POST', 'sets', { title: c.name, source: 'From a crate', tracks: c.tracks });
        location.href = `/dj/sets/${set.id}`;
      }
    } catch (err) { toast(err.message); }
  });
  onSubmit($('[data-new-crate]'), async (d, f) => { const { crate } = await api('POST', 'crates', { name: d.name }); crates.push(crate); current = crate.id; f.reset(); renderList(); renderDetail(); toast(`Created ${crate.name}.`); });
  renderList(); renderDetail();
};

pages.insights = async () => {
  await requireUser();
  const d = await api('GET', 'insights');
  for (const k of ['followers', 'saves', 'reactions', 'comments', 'published', 'tracks']) $(`[data-n="${k}"]`).textContent = num(d[k]);
  $('[data-top-sets]').innerHTML = d.topSets.length
    ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Set</th><th scope="col" style="text-align:right">Saves</th><th scope="col" style="text-align:right">Comments</th><th scope="col" style="text-align:right" class="hide-sm">Reactions</th></tr></thead><tbody>${d.topSets.map((s) => `<tr><td><a class="label" href="/dj/sets/${s.id}">${esc(s.title)}</a></td><td class="mono" style="text-align:right">${s.saves}</td><td class="mono" style="text-align:right">${s.comments}</td><td class="mono hide-sm" style="text-align:right">${s.reactions}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="small t2">Publish a set to start counting.</p>';
  const max = Math.max(1, ...d.topArtists.map((a) => a.count));
  $('[data-top-artists]').innerHTML = d.topArtists.length ? d.topArtists.map((a) => `<div class="hbar"><span class="ellipsis">${esc(a.name)}</span><span class="track-bg"><span class="fill" style="width:${(a.count / max) * 100}%"></span></span><span class="mono t2">${a.count}</span></div>`).join('') : '<p class="small t2">Artists appear once your sets have tracks.</p>';
  const bmax = Math.max(1, ...d.bpm.map((b) => b.count));
  $('[data-bpm]').innerHTML = d.bpm.some((b) => b.count) ? `<div class="vbars" role="img" aria-label="${esc(d.bpm.map((b) => `${b.label} BPM: ${b.count}`).join(', '))}">${d.bpm.map((b) => `<div class="col"><span>${b.count || ''}</span><span class="b" style="height:${(b.count / bmax) * 100}%"></span><span>${b.label}</span></div>`).join('')}</div>` : '<p class="small t2">No tempo data yet. rekordbox, Serato and TRAKTOR exports include BPM.</p>';
};

// Live control room (DJ)
pages.golive = async () => {
  const u = await requireUser();
  let since = 0; let feed = []; let feedFilter = 'all'; let timer = null; let state = null;
  $$('[data-pref]').forEach((sw) => {
    sw.setAttribute('aria-checked', String(u.prefs[sw.dataset.pref] !== false));
    sw.addEventListener('click', async () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      try { const r = await api('PATCH', 'me', { prefs: { [sw.dataset.pref]: on } }); S.me = r.user; } catch (err) { toast(err.message); }
    });
  });
  const roomUrl = `${location.origin}/live/${u.handle}`;
  $('[data-copy-room]').addEventListener('click', () => copy(roomUrl, 'Room link copied. Share it anywhere.'));
  $('[data-open-room]').href = `/live/${u.handle}`;
  const elapsed = () => { if (!state?.live?.startedAt) return; const m = Math.floor((Date.now() - state.live.startedAt) / 60000); $('[data-elapsed]').textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const renderOn = () => {
    const L = state.live;
    $('[data-room-title]').textContent = L.title;
    $('[data-watching]').textContent = num(state.watching);
    elapsed();
    $('[data-now-title]').textContent = L.now ? L.now.t || 'Untitled' : 'Nothing yet';
    $('[data-now-artist]').textContent = L.now ? L.now.a : 'Tap a track from your queue, or add one below.';
    $('[data-q-count]').textContent = L.queue.length ? plural(L.queue.length, 'track') : '';
    $('[data-queue]').dataset.empty = L.setId ? 'Your set is all played.' : 'No set picked. Add tracks as you play them.';
    $('[data-queue]').innerHTML = L.queue.map((t, i) => `<li><span class="num mono t3">${i + 1}</span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(t.t)}</span><span class="caption t3 ellipsis">${esc(t.a)}</span></span><button class="btn btn-outline btn-sm" type="button" data-play="${i}">${I('play', 14)}Playing</button></li>`).join('');
    $('[data-pl-count]').textContent = L.played.length ? plural(L.played.length, 'track') : '';
    $('[data-played]').dataset.empty = 'Tracks you mark as playing move here.';
    $('[data-played]').innerHTML = [...L.played].reverse().map((t, i) => `<li><span class="num mono t3">${L.played.length - i}</span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(t.t)}</span><span class="caption t3 ellipsis">${esc(t.a)}</span></span><span class="caption t3">${ago(t.at)}</span></li>`).join('');
    $('[data-react-counts]').innerHTML = EMOJI.map((e) => `<span class="emoji-react">${e} <span>${num(state.reactions[e] || 0)}</span></span>`).join('');
    renderFeed();
  };
  const renderFeed = () => {
    const list = feedFilter === 'all' ? feed : feed.filter((c) => c.kind === 'request');
    $('[data-feed]').dataset.empty = feedFilter === 'all' ? 'Comments and requests show up here.' : 'No requests yet.';
    $('[data-feed]').innerHTML = [...list].reverse().slice(0, 100).map(feedItem).join('');
  };
  $$('[data-feed-filter] [data-k]').forEach((b) => b.addEventListener('click', () => { feedFilter = b.dataset.k; $$('[data-feed-filter] [data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderFeed(); }));
  const poll = async () => {
    try {
      const d = await api('GET', `live/${u.handle}?since=${since}`);
      if (d.feed.length) { feed = feed.concat(d.feed).slice(-300); since = d.feed[d.feed.length - 1].at; }
      state = d;
      if (d.live.on) renderOn();
    } catch { /* keep polling */ }
  };
  const show = async () => {
    const d = await api('GET', `live/${u.handle}?since=0`);
    state = d; feed = d.feed; since = feed.length ? feed[feed.length - 1].at : 0;
    $('[data-loading]').hidden = true;
    $('[data-on]').hidden = !d.live.on; $('[data-off]').hidden = d.live.on;
    clearInterval(timer);
    if (d.live.on) { renderOn(); timer = setInterval(poll, 4000); }
    else {
      const { sets } = await api('GET', 'sets');
      const sel = $('#gl-set');
      sel.innerHTML = '<option value="">No set: I’ll add tracks as I go</option>' + sets.filter((s) => s.tracks.length).map((s) => `<option value="${s.id}">${esc(s.title)} · ${s.tracks.length} tracks</option>`).join('');
      if (params.get('set')) { sel.value = params.get('set'); const s = sets.find((x) => x.id === params.get('set')); if (s) $('#gl-title').value = s.title; }
    }
  };
  onSubmit($('[data-start]'), async (d) => { await api('POST', 'live/start', { title: d.title, setId: d.setId || null }); toast('You’re live. Followers got a notification.'); await show(); });
  $('[data-queue]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-play]'); if (!b) return;
    b.disabled = true;
    try { const r = await api('POST', 'live/now', { queueIndex: +b.dataset.play }); state.live = { ...state.live, ...r.live }; renderOn(); } catch (err) { toast(err.message); b.disabled = false; }
  });
  const nf = $('[data-now-form]');
  nf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = nf.a.value.trim(); const t = nf.t.value.trim();
    if (!a && !t) { nf.a.focus(); return; }
    try { const r = await api('POST', 'live/now', { track: { a, t } }); state.live = { ...state.live, ...r.live }; nf.reset(); renderOn(); nf.a.focus(); } catch (err) { toast(err.message); }
  });
  const say = $('[data-dj-say]');
  say.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = say.text.value.trim(); if (!text) return;
    try { await api('POST', `live/${u.handle}/comment`, { text }); say.reset(); poll(); } catch (err) { toast(err.message); }
  });
  const dlg = $('[data-end-dialog]');
  $('[data-end-open]').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'end') return;
    try {
      const r = await api('POST', 'live/end', { saveAsSet: $('[data-save-set]').checked });
      clearInterval(timer);
      if (r.set) { store.set('vybez-flash', 'Room ended. Your tracklist is saved as a draft set.'); location.href = `/dj/sets/${r.set.id}`; return; }
      toast('Room ended.'); await show();
    } catch (err) { toast(err.message); }
  });
  setInterval(elapsed, 30000);
  await show();
};

// Public live room

pages.following = async () => {
  await requireUser();
  const saved = await api('GET', 'me/saved');
  $('[data-following]').innerHTML = saved.following.length ? saved.following.map((f) => `<a class="card follow-card" href="${f.live ? `/live/${f.handle}` : `/u/${f.handle}`}"><span class="avatar md">${esc(initials(f.name))}</span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(f.name)}</span><span class="caption t3 ellipsis">${esc([f.city, ...(f.genres || []).slice(0, 1)].filter(Boolean).join(' · ') || `@${f.handle}`)}</span></span>${f.live ? '<span class="live-badge">Live</span>' : I('chevron-right', 18)}</a>`).join('') : `<div class="card" style="grid-column:1/-1">${emptyState('headphones', 'You’re not following anyone yet', 'Find DJs on Explore and follow them to hear when they go live.', '<a class="btn btn-primary btn-sm" href="/explore">Explore</a>')}</div>`;
  $('[data-saved]').innerHTML = saved.sets.length ? saved.sets.map((s, i) => `<a class="card set-row" href="/s/${s.id}"><span class="art g${(i % 6) + 1}"></span><span class="stack grow gap-2"><span class="label">${esc(s.title)}</span><span class="caption t3">${esc(s.dj?.name || '')} · ${fmtDate(s.date)} · ${plural(s.tracks, 'track')}</span></span>${I('chevron-right', 18)}</a>`).join('') : '<div class="card">' + emptyState('bookmark', 'No saved tracklists', 'Tap “Save tracklist” on any set to keep it here.') + '</div>';
};



pages.connections = async () => {
  await mePromise;
  if (!S.me) return;
  const map = { 'Serato DJ Pro': 'Serato', rekordbox: 'rekordbox', VirtualDJ: 'VirtualDJ', TRAKTOR: 'TRAKTOR' };
  $$('.sw-card[data-press]').forEach((b) => {
    const name = map[$('.label', b)?.textContent];
    if (!name) return;
    b.setAttribute('aria-pressed', String(S.me.software === name));
    b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true') return; api('PATCH', 'me', { software: name }).then(() => toast(`Saved: you play on ${name}.`)).catch((err) => toast(err.message)); });
  });
};


export default pages;
