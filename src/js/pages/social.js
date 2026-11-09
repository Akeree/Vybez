// Vybez Social host pages (signed-in Social accounts).
import { $, $$, I, ago, copy, esc, fmtWhen, initials, lagos, params, plural, seg, store, toast, trackLine } from '../core/util.js';
import { api, onSubmit } from '../core/api.js';
import { S, mePromise, requireUser } from '../core/session.js';
import { emptyState, nightRow } from '../core/ui.js';
const pages = {};

pages.nights = async () => {
  await requireUser();
  const { nights } = await api('GET', 'nights');
  let k = 'upcoming';
  const render = () => {
    const now = Date.now() - 6 * 3600000;
    const list = nights.filter((n) => (k === 'upcoming' ? lagos(n.when) >= now : lagos(n.when) < now));
    if (k === 'past') list.reverse();
    $('[data-nights]').innerHTML = list.length ? list.map(nightRow).join('') : `<div class="card">${emptyState('calendar-plus', k === 'upcoming' ? 'No nights planned' : 'No past nights', k === 'upcoming' ? 'Plan one in two minutes. Guests RSVP from a link, no app or account.' : 'Nights move here the morning after.', k === 'upcoming' ? '<a class="btn btn-primary btn-sm" href="/social/new">Plan a night</a>' : '')}</div>`;
  };
  $$('[data-night-filter] [data-k]').forEach((b) => b.addEventListener('click', () => { k = b.dataset.k; $$('[data-night-filter] [data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }));
  render();
};

pages.plan = async () => {
  const form = $('[data-plan-form]');
  let cover = 'rings';
  const editId = params.get('edit');
  const fields = { approve: true, plusOnes: false, songs: true };
  $$('[data-field]').forEach((sw) => sw.addEventListener('click', () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on)); fields[sw.dataset.field] = on;
  }));
  const previewCover = $('[data-preview-cover]');
  const setCover = (c) => {
    cover = c;
    $$('[data-cover]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cover === c)));
    const img = $(`[data-cover="${c}"] img`);
    previewCover.className = c === 'rings' ? 'cover rings' : 'cover photo-cover';
    previewCover.innerHTML = img ? img.outerHTML : '';
  };
  $$('[data-cover]').forEach((b) => b.addEventListener('click', () => setCover(b.dataset.cover)));
  const when = form.when;
  const updWhen = () => { $('[data-ev-when]').textContent = when.value ? fmtWhen(when.value) : 'Pick a date'; };
  when.addEventListener('input', updWhen);
  $('[data-mirror-cap]').addEventListener('input', (e) => { $('[data-ev-cap]').textContent = e.target.value || '24'; });
  if (!when.value) {
    const d = new Date(Date.now() + 7 * 86400000);
    const local = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
    local.setDate(local.getDate() + ((6 - local.getDay() + 7) % 7));
    when.value = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}T19:00`;
    updWhen();
  }
  await mePromise;
  if (!S.me) { $('[data-signin-note]').hidden = false; $('[data-submit]').textContent = 'Sign in to create the invite'; }
  // Restore a draft typed before signing in.
  const draft = store.get('vybez-night-draft');
  if (draft && !editId) {
    try {
      const d = JSON.parse(draft);
      for (const k of ['title', 'when', 'until', 'area', 'place', 'note', 'music', 'cap']) if (d[k] !== undefined && form[k]) { form[k].value = d[k]; form[k].dispatchEvent(new Event('input', { bubbles: true })); }
      Object.assign(fields, d.fields || {}); $$('[data-field]').forEach((sw) => sw.setAttribute('aria-checked', String(!!fields[sw.dataset.field])));
      if (d.cover) setCover(d.cover);
    } catch { /* ignore */ }
  }
  if (editId && S.me) {
    try {
      const { night } = await api('GET', `nights/${editId}`);
      $('[data-mode-label]').textContent = 'Edit night'; $('[data-mode-title]').textContent = night.title;
      for (const k of ['title', 'when', 'until', 'area', 'place', 'note', 'music', 'cap']) if (form[k]) { form[k].value = night[k] ?? ''; form[k].dispatchEvent(new Event('input', { bubbles: true })); }
      for (const k of Object.keys(fields)) fields[k] = !!night[k];
      $$('[data-field]').forEach((sw) => sw.setAttribute('aria-checked', String(fields[sw.dataset.field])));
      setCover(night.cover || 'rings');
      $('[data-submit]').textContent = 'Save changes';
    } catch (err) { toast(err.message); }
  }
  onSubmit(form, async (d) => {
    const body = { ...d, cap: Number(d.cap), cover, ...fields };
    if (!S.me) {
      store.set('vybez-night-draft', JSON.stringify({ ...d, cover, fields }));
      location.href = `/signup?product=social&next=${encodeURIComponent('/social/new')}`;
      return;
    }
    if (editId) {
      await api('PATCH', `nights/${editId}`, body);
      store.set('vybez-flash', 'Night updated.');
      location.href = `/social/${editId}`;
      return;
    }
    const { night } = await api('POST', 'nights', body);
    store.del('vybez-night-draft');
    location.href = `/social/${night.id}?created=1`;
  });
};

pages.night = async () => {
  await requireUser();
  const id = seg(1);
  let d;
  let filter = 'asking';
  const load = async () => { d = await api('GET', `nights/${id}`); };
  try { await load(); } catch { $('[data-loading]').hidden = true; $('[data-missing]').hidden = false; return; }
  $('[data-loading]').hidden = true; $('[data-content]').hidden = false;
  if (params.get('created')) { $('[data-created]').hidden = false; history.replaceState(null, '', location.pathname); }
  const link = `${location.origin}/i/${d.night.code}`;
  const render = () => {
    const n = d.night;
    document.title = `${n.title} · Vybez`;
    $('[data-crumb]').textContent = n.title;
    $('[data-title]').textContent = n.title;
    $('[data-when]').textContent = `${fmtWhen(n.when)}${n.until ? ` until ${n.until}` : ''} · ${n.area}`;
    const past = lagos(n.when) < Date.now() - 6 * 3600000;
    $('[data-chips]').innerHTML = (n.status === 'cancelled' ? '<span class="chip danger">Cancelled</span>' : past ? '<span class="chip">Past</span>' : '<span class="chip dot success">Invites open</span>') + `<span class="chip">${I('lock', 12)}Invite only</span>`;
    $('[data-edit]').href = `/social/new?edit=${n.id}`;
    $('[data-preview]').href = `/i/${n.code}`;
    $('[data-door]').href = `/social/${n.id}/door`;
    const g = d.guests;
    const going = g.filter((x) => x.status === 'going');
    $('[data-n="going"]').textContent = d.going;
    $('[data-n="cap"]').textContent = n.cap;
    $('[data-meter]').style.width = `${Math.min(100, (d.going / n.cap) * 100)}%`;
    $('[data-n="asking"]').textContent = g.filter((x) => x.status === 'asking' || x.status === 'waitlist').length;
    $('[data-n="in"]').textContent = going.filter((x) => x.checkedIn).length;
    $('[data-n="out"]').textContent = g.filter((x) => ['cant', 'left', 'declined'].includes(x.status)).length;
    const groups = { asking: ['asking', 'waitlist'], going: ['going'], out: ['cant', 'left', 'declined'] };
    $$('[data-guest-filter] [data-k]').forEach((b) => { b.textContent = `${{ asking: 'Asking', going: 'Going', out: 'Not coming' }[b.dataset.k]} ${g.filter((x) => groups[b.dataset.k].includes(x.status)).length}`; });
    const list = g.filter((x) => groups[filter].includes(x.status));
    const statusText = { cant: 'Can’t make it', left: 'Left the list', declined: 'You declined', waitlist: 'Waitlist (night was full)' };
    $('[data-guests]').innerHTML = list.length ? list.map((x) => `<div class="guest-row"><span class="avatar">${esc(initials(x.name))}</span><span class="stack grow gap-2"><span class="label">${esc(x.name)}${x.plus ? ' <span class="chip">+1</span>' : ''}</span><span class="caption t3">${esc([x.contact, statusText[x.status], `RSVP ${ago(x.at)}`].filter(Boolean).join(' · '))}</span></span><span class="row gap-8">${x.status === 'asking' || x.status === 'waitlist' || x.status === 'declined' ? `<button class="btn btn-primary btn-sm" type="button" data-set="${x.id}" data-status="going">${I('check', 14)}Approve</button>` : ''}${x.status === 'asking' || x.status === 'waitlist' ? `<button class="btn btn-outline btn-sm" type="button" data-set="${x.id}" data-status="declined">Decline</button>` : ''}${x.status === 'going' ? `${x.checkedIn ? `<span class="chip success">${I('check', 12)}In ${ago(x.checkedIn)}</span>` : `<button class="btn btn-outline btn-sm" type="button" data-checkin="${x.id}">${I('user-check', 14)}Check in</button>`}<button class="icon-btn ghost" type="button" data-set="${x.id}" data-status="declined" aria-label="Remove ${esc(x.name)} from the list">${I('x', 16)}</button>` : ''}</span></div>`).join('') : `<p class="small t2" style="padding:8px 0">${{ asking: n.approve ? 'No one waiting. New RSVPs land here for you to approve.' : 'Approvals are off: guests go straight to Going.', going: 'No one yet. Share the link to start the list.', out: 'No one has dropped out.' }[filter]}</p>`;
    $('[data-link]').textContent = link.replace(/^https?:\/\//, '');
    const msg = `You’re invited to ${n.title} · ${fmtWhen(n.when)}. RSVP here: ${link}`;
    $('[data-wa]').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    $('[data-sms]').href = `sms:?&body=${encodeURIComponent(msg)}`;
    $('[data-mail]').href = `mailto:?subject=${encodeURIComponent(`You’re invited: ${n.title}`)}&body=${encodeURIComponent(msg)}`;
    const songs = going.flatMap((x) => (x.songs || []).map((s) => ({ ...s, by: x.name })));
    $('[data-song-count]').textContent = n.songs ? plural(songs.length, 'song') : 'Off';
    $('[data-songs]').innerHTML = songs.length ? songs.map((s) => `<li class="row gap-16"><span class="art g1" style="width:32px;height:32px"></span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(s.t)}</span><span class="caption t3 ellipsis">${esc(s.a)} · from ${esc(s.by)}</span></span></li>`).join('') : `<li class="small t2">${n.songs ? 'Approved guests can add up to 2 songs each.' : 'Song suggestions are off for this night.'}</li>`;
    $('[data-copy-songs]').hidden = !songs.length;
    $('[data-rules]').innerHTML = `<p class="overline muted">Rules</p><p class="small t2 row gap-8">${I('users', 14)}<span>Cap ${n.cap} · ${n.approve ? 'You approve each RSVP' : 'RSVPs go straight in'} · Plus-ones ${n.plusOnes ? 'on' : 'off'} · Songs ${n.songs ? 'on' : 'off'}</span></p><p class="small t2 row gap-8">${I('map-pin', 14)}<span>${esc(n.place)}</span></p>`;
    $('[data-cancel]').textContent = n.status === 'cancelled' ? 'Reopen night' : 'Cancel night';
  };
  $$('[data-guest-filter] [data-k]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.k; $$('[data-guest-filter] [data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }));
  $('[data-guests]').addEventListener('click', async (e) => {
    const s = e.target.closest('[data-set]'); const c = e.target.closest('[data-checkin]');
    try {
      if (s) { await api('PATCH', `nights/${id}/guests/${s.dataset.set}`, { status: s.dataset.status }); toast(s.dataset.status === 'going' ? 'Approved. They can see the address now.' : 'Removed from the list.'); }
      if (c) { await api('PATCH', `nights/${id}/guests/${c.dataset.checkin}`, { checkedIn: true }); toast('Checked in.'); }
      if (s || c) { await load(); render(); }
    } catch (err) { toast(err.message); }
  });
  $('[data-refresh]').addEventListener('click', async () => { await load(); render(); toast('Up to date.'); });
  $('[data-copy-link]').addEventListener('click', () => copy(link, 'Invite link copied.'));
  $('[data-copy-songs]').addEventListener('click', () => copy(d.guests.flatMap((x) => (x.status === 'going' ? (x.songs || []) : [])).map((s, i) => `${i + 1}. ${trackLine(s)}`).join('\n'), 'Song list copied.'));
  $('[data-cancel]').addEventListener('click', async () => {
    const cancelling = d.night.status !== 'cancelled';
    if (cancelling && !window.confirm('Cancel this night? Guests will see it on the invite page.')) return;
    try { ({ night: d.night } = await api('PATCH', `nights/${id}`, { status: cancelling ? 'cancelled' : 'on' })); render(); toast(cancelling ? 'Night cancelled.' : 'Night reopened.'); } catch (err) { toast(err.message); }
  });
  $('[data-delete]').addEventListener('click', async () => {
    if (!window.confirm('Delete this night and every RSVP? This can’t be undone.')) return;
    try { await api('DELETE', `nights/${id}`); store.set('vybez-flash', 'Night deleted.'); location.href = '/social'; } catch (err) { toast(err.message); }
  });
  if (!d.guests.some((x) => x.status === 'asking' || x.status === 'waitlist')) { filter = 'going'; $$('[data-guest-filter] [data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === 'going'))); }
  render();
  setInterval(async () => { if (document.hidden) return; try { await load(); render(); } catch { /* ignore */ } }, 20000);
};

pages.door = async () => {
  await requireUser();
  const id = seg(1);
  let d;
  const load = async () => { d = await api('GET', `nights/${id}`); };
  try { await load(); } catch (err) { $('[data-title]').textContent = 'Night not found'; return; }
  $('[data-back]').href = `/social/${id}`;
  const render = () => {
    const going = d.guests.filter((g) => g.status === 'going');
    const inCount = going.filter((g) => g.checkedIn).length;
    $('[data-title]').textContent = d.night.title;
    $('[data-when]').textContent = fmtWhen(d.night.when);
    $('[data-count]').textContent = `${inCount} of ${going.length} in`;
    const q = ($('[data-find]').value || '').toLowerCase();
    const list = going.filter((g) => !q || g.name.toLowerCase().includes(q));
    $('[data-list]').innerHTML = list.length ? list.map((g) => `<div class="list-row"><span class="avatar">${esc(initials(g.name))}</span><span class="stack grow gap-2"><span class="label">${esc(g.name)}${g.plus ? ' <span class="chip">+1</span>' : ''}</span><span class="caption t3">${g.checkedIn ? `In at ${new Date(g.checkedIn).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}` : 'Not in yet'}</span></span><button class="btn ${g.checkedIn ? 'btn-outline' : 'btn-primary'} btn-sm" type="button" data-toggle="${g.id}" data-in="${g.checkedIn ? 1 : 0}">${g.checkedIn ? 'Undo' : 'Check in'}</button></div>`).join('') : '<p class="p-16 small t2">No approved guests match.</p>';
  };
  $('[data-find]').addEventListener('input', render);
  $('[data-list]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-toggle]'); if (!b) return;
    try { await api('PATCH', `nights/${id}/guests/${b.dataset.toggle}`, { checkedIn: b.dataset.in !== '1' }); await load(); render(); } catch (err) { toast(err.message); }
  });
  const pf = $('[data-pass-form]');
  const result = $('[data-result]');
  pf.pass.addEventListener('input', () => { pf.pass.value = pf.pass.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = pf.pass.value.trim(); if (!pass) { pf.pass.focus(); return; }
    try {
      const r = await api('POST', `nights/${id}/checkin`, { pass });
      result.className = `door-result ${r.already ? 'warn' : 'ok'}`;
      result.innerHTML = `${I(r.already ? 'triangle-alert' : 'circle-check', 28)}<span class="stack gap-2"><span class="label">${esc(r.guest.name)}${r.guest.plus ? ' +1' : ''}</span><span class="small">${r.already ? 'Already checked in. Same pass used twice?' : 'Welcome in.'}</span></span>`;
      pf.pass.value = '';
      await load(); render();
    } catch (err) {
      result.className = 'door-result bad';
      result.innerHTML = `${I('circle-x', 28)}<span class="stack gap-2"><span class="label">Not on the list</span><span class="small">${esc(err.message)}</span></span>`;
    }
    result.hidden = false; result.focus();
    pf.pass.focus();
  });
  render();
  setInterval(async () => { if (document.hidden) return; try { await load(); render(); } catch { /* ignore */ } }, 15000);
};


export default pages;
