// Vybez Social "the group" (/i/:code/group): chat, rides (car hop) and moments for one night.
// Guests use the token their RSVP left on this device; the host is recognised by their session.
import { $, $$, I, esc, initials, plural, seg, store, toast, fmtWhen, lagos } from '../core/util.js';
import { api, onSubmit, showError, clearError } from '../core/api.js';
import { loadImage, encodeFit } from '../core/photo.js';

const pages = {};

const clock = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm || '';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const timeOf = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });
const dayOf = (ts) => {
  const d = new Date(ts).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
  const yest = new Date(Date.now() - 86400000).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
  if (d === today) return 'Today';
  if (d === yest) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
};

pages.group = async () => {
  const code = seg(1);
  const token = store.get(`vybez-guest-${code}`) || '';
  const q = token ? `guest=${encodeURIComponent(token)}` : '';
  const withQ = (path, extra = '') => `${path}?${[q, extra].filter(Boolean).join('&')}`;
  const body = (b = {}) => (token ? { ...b, guest: token } : b);
  const seenKey = (room) => `vybez-seen-${code}-${room}`;
  $('[data-back]').href = `/i/${code}`;
  $('[data-locked-link]').href = `/i/${code}`;

  let g; // group summary
  let tab = 'chat';
  let room = 'all';
  let dir = 'there';
  let messages = [];
  let editing = null; // ride being edited

  let skew = 0; // server clock minus this device's clock, so "overdue" doesn't depend on a wrong phone clock
  const loadGroup = async () => { g = await api('GET', withQ(`invites/${code}/group`)); g.checkins = g.checkins || []; if (g.now) skew = g.now - Date.now(); };
  try { await loadGroup(); } catch (err) {
    $('[data-loading]').hidden = true;
    const box = $('[data-locked]'); box.hidden = false;
    if (err.status === 404) { $('[data-locked-title]').textContent = 'This invite doesn’t exist'; $('[data-locked-text]').textContent = 'Ask your host for a fresh link.'; $('[data-locked-link]').hidden = true; }
    else if (err.status === 403 && /approves/.test(err.message)) { $('[data-locked-title]').textContent = 'Almost there'; $('[data-locked-text]').textContent = 'The group opens once the host approves you. Keep the invite open on this device and check back.'; }
    else if (err.status !== 403) { $('[data-locked-title]').textContent = 'We couldn’t open the group'; $('[data-locked-text]').textContent = err.message; }
    return;
  }
  $('[data-loading]').hidden = true; $('[data-content]').hidden = false;
  const readOnly = () => g.night.status === 'cancelled';

  // ---------- header and tabs ----------
  const renderHead = () => {
    document.title = `${g.night.title} · The group · Vybez`;
    $('[data-night-title]').textContent = g.night.title;
    $('[data-night-when]').textContent = `${fmtWhen(g.night.when)} · ${g.night.area}`;
    const pc = $('[data-people-count]'); pc.hidden = false; pc.innerHTML = `${I('users', 12)}${g.people.length}`;
    pc.setAttribute('aria-label', `${plural(g.people.length, 'person', 'people')} in the group`);
    $('[data-ride-count]').textContent = g.rides.length ? String(g.rides.length) : '';
    $('[data-moment-count]').textContent = g.moments ? String(g.moments) : '';
    const unread = Object.entries(g.rooms).some(([r, s]) => s.last && s.last.by !== g.me.id && s.last.at > Number(store.get(seenKey(r)) || 0) && !(tab === 'chat' && r === room));
    $('[data-unread-chat]').hidden = !unread;
    if (g.me.host && g.night.nightId) $('[data-back]').href = `/social/${g.night.nightId}`;
    renderCheckinButton();
    showPop();
  };
  const setTab = (t, focus = false) => {
    tab = t;
    $$('[data-tab]').forEach((b) => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t; });
    if (t === 'moments') loadMoments();
    if (t === 'rides') renderRides();
    if (t === 'chat') { renderRooms(); scrollLog(true); }
    renderHead();
    history.replaceState(null, '', `${location.pathname}${t === 'chat' ? '' : `#${t}`}`);
  };
  $$('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const tabs = $$('[data-tab]'); const i = tabs.indexOf(b);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j !== undefined) { e.preventDefault(); setTab(tabs[(j + tabs.length) % tabs.length].dataset.tab, true); }
    });
  });

  // ---------- chat ----------
  const myRides = () => g.rides.filter((r) => r.joined || g.me.host);
  const rideName = (r) => `${r.dir === 'home' ? 'Home' : 'There'} · ${r.from} ${clock(r.time)}`;
  const renderRooms = () => {
    const rides = myRides();
    if (room !== 'all' && !rides.some((r) => r.id === room)) room = 'all';
    const pill = (id, label, icon) => {
      const s = g.rooms[id]; const fresh = s?.last && s.last.by !== g.me.id && s.last.at > Number(store.get(seenKey(id)) || 0) && id !== room;
      return `<button class="pill" type="button" aria-pressed="${id === room}" data-room="${esc(id)}">${I(icon, 14)}<span class="ellipsis">${esc(label)}</span>${fresh ? '<span class="unread-dot"><span class="sr-only">, new</span></span>' : ''}</button>`;
    };
    $('[data-rooms]').innerHTML = pill('all', 'Everyone', 'messages-square') + rides.map((r) => pill(r.id, rideName(r), 'car')).join('');
    $('[data-rooms]').hidden = !rides.length;
    const head = $('[data-room-head]');
    const r = g.rides.find((x) => x.id === room);
    head.hidden = !r;
    if (r) head.innerHTML = `<div class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(r.kind === 'cab' ? 'Splitting a cab' : `${r.by.name} is driving`)}</span><span class="caption t3 ellipsis">${esc(route(r))} · ${clock(r.time)} · ${esc(r.members.map((m) => m.name).join(', '))}</span></div><button class="btn btn-outline btn-sm" type="button" data-see-ride="${esc(r.id)}">Ride details</button>`;
    const input = $('[data-composer] textarea');
    input.placeholder = r ? 'Message the ride' : 'Message everyone';
    $('[data-composer-note]').textContent = readOnly() ? 'The host cancelled this night, so the group is read-only.' : (r ? `Only people in this ride${g.me.host ? '' : ' and the host'} can see this chat.` : `${plural(g.people.length, 'person', 'people')} on the list can see this chat. Guests see first names only.`);
    $('[data-composer]').hidden = readOnly();
  };
  const scrollLog = (force) => {
    const log = $('[data-log]');
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    if (force || near) log.scrollTop = log.scrollHeight;
  };
  const bubble = (m, prev) => {
    const mine = m.by === g.me.id;
    const canRemove = (mine || g.me.host) && m.kind === 'text';
    const day = !prev || dayOf(prev.at) !== dayOf(m.at) ? `<li class="chat-day"><span>${esc(dayOf(m.at))}</span></li>` : '';
    if (m.kind === 'event') return `${day}<li class="chat-event caption t3">${esc(m.text)} · ${timeOf(m.at)}</li>`;
    if (m.kind === 'nudge') return `${day}<li class="chat-nudge caption t3">${I('bell', 14)}<span>${esc(m.to === g.me.id ? `${m.name} is checking on you. Home yet?` : m.text)} · ${timeOf(m.at)}</span></li>`;
    if (m.kind === 'checkin' && m.state === 'here') return `${day}<li class="chat-nudge caption t3"><span class="ci-here-icon">${I('map-pin', 14)}</span><span>${esc(m.by === g.me.id ? 'You checked in. The group knows you’re here.' : m.text)} · ${timeOf(m.at)}</span></li>`;
    if (m.kind === 'checkin') {
      const st = CI[m.state] || CI.here;
      const c = ciOf(m.by);
      const late = c && !c.me && c.state === 'leaving' && c.at <= m.at && overdue(c);
      return `${day}<li class="chat-checkin"><span class="tile ${late ? 'warn' : st.tone}">${I(late ? 'triangle-alert' : st.icon, 18)}</span><span class="stack grow gap-2"><span class="small">${esc(m.by === g.me.id ? ({ here: 'You checked in. The group knows you’re here.', leaving: `You’re heading home and expect to be there by ${timeOf(m.eta)}.`, home: 'You got home safe.' }[m.state] || m.text) : m.text)}</span><span class="caption t3">${late ? `Not home yet · was due ${timeOf(c.eta)}` : timeOf(m.at)}</span></span>${late && !readOnly() ? `<button class="btn btn-outline btn-sm" type="button" data-nudge="${esc(m.by)}">Check on ${esc(first(c.name))}</button>` : ''}</li>`;
    }
    if (m.kind === 'ride') return `${day}<li class="chat-ride"><span class="tile">${I('car', 18)}</span><span class="stack grow gap-2"><span class="small">${esc(m.text)}</span><span class="caption t3">${timeOf(m.at)}</span></span><button class="btn btn-outline btn-sm" type="button" data-go-rides>See rides</button></li>`;
    const grouped = prev && prev.kind === 'text' && prev.by === m.by && m.at - prev.at < 5 * 60000 && dayOf(prev.at) === dayOf(m.at);
    return `${day}<li class="msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}" data-mid="${esc(m.id)}">
      ${mine ? '' : `<span class="avatar xs${m.host ? ' host' : ''}" aria-hidden="true">${grouped ? '' : esc(initials(m.name))}</span>`}
      <div class="msg-body">
        ${grouped ? '' : `<span class="msg-meta caption"><span class="label">${mine ? 'You' : esc(m.name)}</span>${m.host ? '<span class="chip accent">Host</span>' : ''}<span class="t3">${timeOf(m.at)}</span></span>`}
        <span class="msg-text">${esc(m.text)}</span>
      </div>
      ${canRemove ? `<button class="icon-btn ghost msg-remove" type="button" data-remove-msg="${esc(m.id)}" aria-label="Remove message">${I('trash-2', 14)}</button>` : m.kind === 'text' && !m.host ? `<button class="icon-btn ghost msg-remove" type="button" data-report-msg="${esc(m.id)}" aria-label="Report message to the host" title="Report">${I('flag', 14)}</button>` : ''}
    </li>`;
  };
  const renderLog = (force) => {
    const log = $('[data-log]');
    if (!messages.length) {
      const r = g.rides.find((x) => x.id === room);
      log.innerHTML = `<li class="chat-empty"><span class="tile">${I(r ? 'car' : 'messages-square')}</span><span class="label">${r ? 'Plan the ride here' : 'Say hello to the list'}</span><span class="small t2">${r ? 'Agree the pickup spot and time, and who’s chipping in for fuel or the fare.' : 'Ask who’s coming from your side of town, share the dress code, or just say you’re excited.'}</span></li>`;
      return;
    }
    log.innerHTML = messages.map((m, i) => bubble(m, messages[i - 1])).join('');
    scrollLog(force);
  };
  const markSeen = () => { const last = messages[messages.length - 1]; if (last) store.set(seenKey(room), String(last.at)); };
  let loadingRoom = null;
  const openRoom = async (id) => {
    room = id; messages = [];
    $('[data-log]').innerHTML = '<li class="chat-empty"><span class="small t3">Loading…</span></li>';
    renderRooms();
    const want = id; loadingRoom = id;
    try {
      const r = await api('GET', withQ(`invites/${code}/chat/${encodeURIComponent(id)}`));
      if (loadingRoom !== want) return;
      messages = r.messages; renderLog(true); markSeen(); renderRooms(); renderHead();
    } catch (err) { toast(err.message); if (id !== 'all') openRoom('all'); }
  };
  const poll = async () => {
    if (document.hidden || tab !== 'chat') return;
    const after = messages[messages.length - 1]?.at || 0;
    const id = room;
    try {
      const r = await api('GET', withQ(`invites/${code}/chat/${encodeURIComponent(id)}`, `after=${after}`));
      if (id !== room || !r.messages.length) return;
      const known = new Set(messages.map((m) => m.id));
      const fresh = r.messages.filter((m) => !known.has(m.id));
      messages.push(...fresh);
      renderLog(); markSeen();
      if (fresh.some((m) => m.kind === 'checkin' || m.kind === 'nudge')) refresh().catch(() => {});
    } catch { /* try again on the next tick */ }
  };
  $('[data-rooms]').addEventListener('click', (e) => { const b = e.target.closest('[data-room]'); if (b && b.dataset.room !== room) openRoom(b.dataset.room); });
  const composer = $('[data-composer]');
  const input = $('textarea', composer);
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); } });
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    const btn = $('button[type="submit"]', composer); btn.disabled = true;
    try {
      const r = await api('POST', `invites/${code}/chat/${encodeURIComponent(room)}`, body({ text }));
      input.value = ''; grow();
      if (!messages.some((m) => m.id === r.message.id)) messages.push(r.message);
      renderLog(true); markSeen();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; input.focus(); }
  });
  $('[data-log]').addEventListener('click', async (e) => {
    if (e.target.closest('[data-go-rides]')) { setTab('rides'); return; }
    const nb = e.target.closest('[data-nudge]');
    if (nb) { nudge(nb.dataset.nudge, nb); return; }
    const rp = e.target.closest('[data-report-msg]');
    if (rp) { report('message', rp.dataset.reportMsg); return; }
    const b = e.target.closest('[data-remove-msg]'); if (!b) return;
    if (!window.confirm('Remove this message for everyone?')) return;
    try { await api('DELETE', `invites/${code}/chat/${encodeURIComponent(room)}/${b.dataset.removeMsg}`, body()); messages = messages.filter((m) => m.id !== b.dataset.removeMsg); renderLog(); toast('Message removed.'); } catch (err) { toast(err.message); }
  });
  $('[data-room-head]').addEventListener('click', (e) => { const b = e.target.closest('[data-see-ride]'); if (b) { dir = g.rides.find((r) => r.id === b.dataset.seeRide)?.dir || dir; setTab('rides'); } });

  // ---------- rides ----------
  const route = (r) => (r.dir === 'home' ? `${g.night.area} → ${r.from}` : `${r.from} → ${g.night.area}`);
  const faces = (r) => `<span class="ride-faces" aria-hidden="true">${r.members.slice(0, 4).map((m) => `<span class="avatar xs">${esc(initials(m.name))}</span>`).join('')}</span>`;
  const rideCard = (r) => {
    const full = r.left === 0;
    const mine = r.by.me;
    const seats = r.kind === 'cab' ? (full ? 'Group full' : `${plural(r.left, 'space')} left`) : (full ? 'Car full' : `${plural(r.left, 'seat')} left`);
    let action;
    if (mine) action = `<button class="btn btn-outline btn-sm" type="button" data-edit-ride="${esc(r.id)}">${I('pencil', 14)}Edit</button><button class="btn btn-primary btn-sm" type="button" data-open-ride="${esc(r.id)}">${I('message-circle', 14)}Chat</button>`;
    else if (r.joined) action = `<button class="btn btn-outline btn-sm" type="button" data-leave-ride="${esc(r.id)}">Leave</button><button class="btn btn-primary btn-sm" type="button" data-open-ride="${esc(r.id)}">${I('message-circle', 14)}Chat</button>`;
    else if (g.me.host) action = `<button class="btn btn-outline btn-sm" type="button" data-remove-ride="${esc(r.id)}" aria-label="Remove ride from ${esc(r.from)}">${I('trash-2', 14)}Remove</button><button class="btn btn-outline btn-sm" type="button" data-open-ride="${esc(r.id)}">${I('message-circle', 14)}Read chat</button>`;
    else action = full || readOnly() ? `<span class="btn btn-outline btn-sm" aria-disabled="true">${full ? 'Full' : 'Closed'}</span>` : `<button class="btn btn-primary btn-sm" type="button" data-join-ride="${esc(r.id)}">Join ride</button>`;
    return `<article class="card ride-card" aria-label="${esc(`${r.kind === 'cab' ? 'Shared cab' : 'Ride'} from ${r.dir === 'home' ? g.night.area : r.from} at ${clock(r.time)}`)}">
      <div class="ride-top">
        <span class="ride-time">${esc(clock(r.time))}</span>
        <span class="ride-route"><span class="label ellipsis">${esc(r.dir === 'home' ? g.night.area : r.from)}</span><span class="label ellipsis t2">${esc(r.dir === 'home' ? r.from : g.night.area)}</span></span>
        <span class="chip ${r.kind === 'cab' ? 'info' : 'accent'}">${I(r.kind === 'cab' ? 'users' : 'car', 12)}${r.kind === 'cab' ? 'Bolt or Uber' : 'Driving'}</span>
      </div>
      ${r.note ? `<p class="small t2 ride-note">${esc(r.note)}</p>` : ''}
      <div class="ride-foot">
        ${faces(r)}
        <span class="stack grow" style="min-width:0"><span class="small ellipsis">${mine ? 'Your ride' : esc(r.kind === 'cab' ? `Posted by ${r.by.name}` : `${r.by.name} is driving`)}</span><span class="caption ${full ? 't3' : 'ride-left'}">${seats}</span></span>
        <span class="row gap-8 ride-actions">${action}</span>
      </div>
    </article>`;
  };
  const renderRides = () => {
    $$('[data-dir-filter] [data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === dir)));
    const list = g.rides.filter((r) => r.dir === dir);
    const other = g.rides.length - list.length;
    $('[data-new-ride]').hidden = readOnly();
    $('[data-rides]').innerHTML = list.length ? list.map(rideCard).join('') : `<div class="card state"><span class="tile">${I('car')}</span><span class="label">${dir === 'home' ? 'No rides home yet' : 'No rides there yet'}</span><span class="small t2">${dir === 'home' ? 'Leaving late? Post where you’re heading and split the ride with someone going your way.' : 'Post where you’re coming from. Someone on your side of town might be looking too.'}</span>${other ? `<button class="btn btn-outline btn-sm" type="button" data-flip>See ${plural(other, 'ride')} ${dir === 'home' ? 'there' : 'home'}</button>` : ''}</div>`;
  };
  $$('[data-dir-filter] [data-dir]').forEach((b) => b.addEventListener('click', () => { dir = b.dataset.dir; renderRides(); }));
  const refresh = async () => { await loadGroup(); renderHead(); if (tab === 'rides') renderRides(); if (tab === 'chat') renderRooms(); };
  $('[data-rides]').addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.flip !== undefined) { dir = dir === 'home' ? 'there' : 'home'; renderRides(); return; }
      if (t.dataset.openRide) { setTab('chat'); openRoom(t.dataset.openRide); return; }
      if (t.dataset.editRide) { openRideForm(g.rides.find((r) => r.id === t.dataset.editRide)); return; }
      if (t.dataset.joinRide) { t.disabled = true; await api('POST', `invites/${code}/rides/${t.dataset.joinRide}/join`, body()); await refresh(); toast('You’re in. Say hi in the ride chat.'); setTab('chat'); openRoom(t.dataset.joinRide); return; }
      if (t.dataset.leaveRide) { if (!window.confirm('Leave this ride? The others will see you left.')) return; await api('POST', `invites/${code}/rides/${t.dataset.leaveRide}/leave`, body()); await refresh(); toast('You left the ride.'); return; }
      if (t.dataset.removeRide) { if (!window.confirm('Remove this ride and its chat for everyone?')) return; await api('DELETE', `invites/${code}/rides/${t.dataset.removeRide}`, body()); await refresh(); toast('Ride removed.'); }
    } catch (err) { toast(err.message); t.disabled = false; await refresh().catch(() => {}); }
  });

  // Post or edit a ride
  const dlg = $('[data-ride-dialog]');
  const form = $('[data-ride-form]');
  const syncForm = () => {
    const d = form.dir.value; const k = form.kind.value;
    $('[data-from-label]').textContent = d === 'home' ? 'Heading to' : 'Leaving from';
    $('[data-time-label]').textContent = d === 'home' ? 'Leaving the party at' : 'Leaving at';
    $('[data-seats-label]').textContent = k === 'cab' ? 'Spaces for others' : 'Seats for others';
    form.seats.max = k === 'cab' ? '3' : '6';
    if (Number(form.seats.value) > Number(form.seats.max)) form.seats.value = form.seats.max;
  };
  $$('input[name="dir"], input[name="kind"]', form).forEach((x) => x.addEventListener('change', syncForm));
  const openRideForm = (r = null) => {
    editing = r; form.reset(); clearError(form);
    $('[data-ride-form-title]').textContent = r ? 'Edit your ride' : 'Post a ride';
    $('[data-ride-submit]').textContent = r ? 'Save' : 'Post ride';
    $$('input[name="dir"], input[name="kind"]', form).forEach((x) => { x.disabled = !!r; });
    if (r) {
      form.dir.value = r.dir; form.kind.value = r.kind; form.from.value = r.from; form.time.value = r.time; form.seats.value = String(r.seats); form.note.value = r.note;
    } else {
      form.dir.value = dir;
      const start = g.night.when.slice(11, 16);
      if (dir === 'there' && start) { const [h, m] = start.split(':').map(Number); const t = (h * 60 + m - 45 + 1440) % 1440; form.time.value = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
      else form.time.value = '01:00';
    }
    syncForm();
    dlg.showModal();
    form.from.focus();
  };
  $('[data-new-ride]').addEventListener('click', () => openRideForm());
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  onSubmit(form, async (d) => {
    const payload = body({ dir: d.dir, kind: d.kind, from: d.from, time: d.time, seats: Number(d.seats), note: d.note });
    if (editing) await api('PATCH', `invites/${code}/rides/${editing.id}`, payload);
    else await api('POST', `invites/${code}/rides`, payload);
    dlg.close();
    dir = d.dir || dir;
    await refresh();
    renderRides();
    toast(editing ? 'Ride updated.' : 'Ride posted. Everyone on the list can see it.');
  });

  // ---------- check-ins ----------
  // Like a safety check-in: tap "I'm here", "Heading home" (and when you expect to be in) or
  // "Home safe". The group sees it in the chat, and a pop-up asks them to check on anyone who
  // isn't home by the time they said. Only what you tap is shared, never your location.
  const CI = {
    here: { label: 'Here', icon: 'map-pin', tone: 'muted', chip: '' },
    leaving: { label: 'Heading home', icon: 'car', tone: '', chip: 'warning' },
    home: { label: 'Home safe', icon: 'house', tone: 'ok', chip: 'success' },
  };
  const nowS = () => Date.now() + skew;
  const first = (name) => String(name || '').split(' ')[0];
  const ciOf = (id) => g.checkins.find((c) => c.id === id);
  const mine = () => g.checkins.find((c) => c.me);
  const overdue = (c) => c.state === 'leaving' && c.eta && nowS() > c.eta && nowS() - c.eta < 6 * 3600000;
  const recent = (c, hrs = 2) => nowS() - c.at < hrs * 3600000;

  const renderCheckinButton = () => {
    const b = $('[data-checkin-open]');
    b.hidden = readOnly();
    const c = mine();
    b.dataset.state = c?.state || '';
    $('[data-checkin-label]').textContent = c ? (c.state === 'leaving' && overdue(c) ? 'Home yet?' : CI[c.state].label) : 'Check in';
    b.setAttribute('aria-label', c ? `Check-in: ${c.state === 'leaving' ? `heading home, expected by ${timeOf(c.eta)}` : CI[c.state].label}. Change` : 'Check in');
  };

  // The sheet: your three options, then where everyone else is at.
  const cdlg = $('[data-checkin-dialog]');
  let mins = 40;
  const byTime = () => timeOf(nowS() + mins * 60000);
  const statusOf = (c) => {
    if (!c) return '<span class="caption t3">Not checked in</span>';
    if (c.state === 'leaving') return overdue(c) ? `<span class="chip danger">Late · due ${esc(timeOf(c.eta))}</span>` : `<span class="chip warning">Home by ${esc(timeOf(c.eta))}</span>`;
    return `<span class="chip ${CI[c.state].chip}">${CI[c.state].label}</span>`;
  };
  const renderSheet = () => {
    const c = mine();
    $$('[data-ci]', cdlg).forEach((b) => { b.setAttribute('aria-pressed', String(c?.state === b.dataset.ci)); });
    $('[data-ci-here-hint]').textContent = `Tell the group you’ve made it to ${g.night.area}`;
    $$('[data-mins]', cdlg).forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.mins) === mins)));
    $('[data-ci-by]').textContent = `Start check-in · home by ${byTime()}`;
    const order = (p) => { const x = ciOf(p.id); if (!x) return 4; if (overdue(x)) return 0; return { leaving: 1, here: 2, home: 3 }[x.state]; };
    const list = [...g.people].sort((a, b) => order(a) - order(b) || (a.me ? -1 : b.me ? 1 : 0));
    $('[data-ci-list]').innerHTML = list.map((p) => {
      const x = ciOf(p.id);
      const canNudge = x && !p.me && x.state === 'leaving' && !readOnly() && !x.nudges.some((n) => n.me && nowS() - n.at < 5 * 60000);
      return `<li><span class="avatar${p.host ? ' host' : ''}" aria-hidden="true">${esc(initials(p.name))}</span><span class="stack grow gap-2" style="min-width:0"><span class="label ellipsis">${p.me ? 'You' : esc(p.name)}${p.host ? ' <span class="caption t3">· Host</span>' : ''}</span><span class="row gap-8">${statusOf(x)}</span></span>${canNudge ? `<button class="btn btn-outline btn-sm" type="button" data-nudge="${esc(p.id)}">Check on ${esc(first(p.name))}</button>` : ''}</li>`;
    }).join('');
  };
  const openSheet = (expand = false) => {
    const c = mine();
    const open = expand || c?.state === 'leaving';
    $('[data-ci="leaving"]').setAttribute('aria-expanded', String(open));
    $('[data-ci-eta]').hidden = !open;
    renderSheet();
    cdlg.showModal();
  };
  $('[data-checkin-open]').addEventListener('click', () => openSheet());
  $$('[data-close]', cdlg).forEach((b) => b.addEventListener('click', () => cdlg.close()));
  $('[data-ci-mins]', cdlg).addEventListener('click', (e) => { const b = e.target.closest('[data-mins]'); if (!b) return; mins = Number(b.dataset.mins); renderSheet(); });
  const ciTimer = setInterval(() => { if (cdlg.open) $('[data-ci-by]').textContent = `Start check-in · home by ${byTime()}`; }, 15000);
  void ciTimer;

  async function checkin(state, m) {
    const r = await api('POST', `invites/${code}/checkin`, body(state === 'leaving' ? { state, mins: m } : { state }));
    g.checkins = [...g.checkins.filter((c) => !c.me), r.checkin];
    renderHead();
    if (cdlg.open) cdlg.close();
    toast({ here: 'Checked in. The group knows you’re here.', leaving: `Check-in started. Tap Home safe when you’re in by ${timeOf(r.checkin.eta)}.`, home: 'Glad you’re home. The group can see you’re safe.' }[state]);
    if (tab === 'chat' && room === 'all') poll();
  }
  cdlg.addEventListener('click', async (e) => {
    const nb = e.target.closest('[data-nudge]');
    if (nb) { await nudge(nb.dataset.nudge, nb); renderSheet(); return; }
    const opt = e.target.closest('[data-ci]');
    const start = e.target.closest('[data-ci-start]');
    if (opt && opt.dataset.ci === 'leaving') {
      const open = opt.getAttribute('aria-expanded') !== 'true';
      opt.setAttribute('aria-expanded', String(open)); $('[data-ci-eta]').hidden = !open; return;
    }
    const btn = start || opt; if (!btn) return;
    btn.disabled = true;
    try { await checkin(start ? 'leaving' : opt.dataset.ci, mins); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });

  async function nudge(id, btn) {
    const c = ciOf(id); if (!c) return;
    if (btn) btn.disabled = true;
    try {
      const r = await api('POST', `invites/${code}/checkin/${encodeURIComponent(id)}/nudge`, body());
      g.checkins = g.checkins.map((x) => (x.id === id ? r.checkin : x));
      toast(`${first(c.name)} will see you checked on them.`);
      if (tab === 'chat' && room === 'all') poll();
      renderLog(); showPop();
    } catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  }

  // Pop-ups: one at a time, most urgent first. Each is shown once (remembered on this device).
  const popKey = `vybez-ci-${code}`;
  const popSeen = () => { try { return JSON.parse(store.get(popKey) || '[]'); } catch { return []; } };
  const markPop = (k) => store.set(popKey, JSON.stringify([...popSeen().filter((x) => x !== k), k].slice(-60)));
  let popNow = null; let popTimer = null;
  const nextPop = () => {
    if (readOnly()) return null;
    const seen = new Set(popSeen());
    const me = mine();
    const out = [];
    if (me?.state === 'leaving') {
      const n = me.nudges.filter((x) => !x.me).sort((a, b) => b.at - a.at)[0];
      if (n) out.push({ key: `nudge:${n.at}`, tone: 'warn', icon: 'bell', title: `${n.name} is checking on you`, text: 'Home yet? Let the group know you got in safe.', actions: [['home', 'I’m home safe', 'primary'], ['more', '+20 min']] });
      if (overdue(me)) out.push({ key: `selfdue:${me.eta}`, tone: 'warn', icon: 'house', title: 'Home yet?', text: `You said you’d be home by ${timeOf(me.eta)}. Let the group know you’re safe.`, actions: [['home', 'I’m home safe', 'primary'], ['more', '+20 min']] });
    }
    for (const c of g.checkins.filter((x) => !x.me)) {
      if (overdue(c) && !c.nudges.some((n) => n.me)) out.push({ key: `due:${c.id}:${c.eta}`, tone: 'warn', icon: 'triangle-alert', title: `${c.name} isn’t home yet`, text: `They expected to be home by ${timeOf(c.eta)}. Check on them?`, actions: [[`nudge:${c.id}`, `Check on ${first(c.name)}`, 'primary'], ['ok', 'Not now']] });
    }
    for (const c of g.checkins.filter((x) => !x.me && x.state === 'leaving' && !overdue(x) && recent(x))) {
      out.push({ key: `leaving:${c.id}:${c.at}`, tone: '', icon: 'car', title: `${c.name} is heading home`, text: `Expected home by ${timeOf(c.eta)}. If they’re not in by then, we’ll ask you to check on them.`, actions: [['ok', 'Okay']] });
    }
    for (const c of g.checkins.filter((x) => !x.me && x.state === 'home' && recent(x))) {
      out.push({ key: `home:${c.id}:${c.at}`, tone: 'ok', icon: 'house', title: `${c.name} got home safe`, text: '', actions: [], auto: true });
    }
    // Suggestions for you, like a phone suggesting a check-in when you set off.
    const start = lagos(g.night.when).getTime();
    const day = g.night.when.slice(0, 10);
    if (!me && nowS() > start - 30 * 60000 && nowS() < start + 8 * 3600000) out.push({ key: `suggest-here:${day}`, tone: '', icon: 'map-pin', over: 'Suggested', title: 'Made it?', text: 'Let the group know you’ve arrived.', actions: [['here', 'I’m here', 'primary'], ['ok', 'Not yet']] });
    const late = g.night.until ? lagos(g.night.until).getTime() : start + 3 * 3600000;
    if (me?.state === 'here' && nowS() > Math.max(late - 30 * 60000, me.at + 30 * 60000)) out.push({ key: `suggest-leave:${me.at}`, tone: '', icon: 'car', over: 'Suggested', title: 'Heading out soon?', text: 'Start a check-in. If you’re not home when you said, the group gets a nudge to check on you.', actions: [['sheet', 'Start check-in', 'primary'], ['ok', 'Later']] });
    return out.find((p) => !seen.has(p.key)) || null;
  };
  function showPop() {
    const host = $('[data-ci-pop]');
    const p = nextPop();
    if (popNow && p && popNow.key === p.key) return;
    clearTimeout(popTimer);
    popNow = p;
    if (!p) { host.innerHTML = ''; return; }
    host.style.top = `${$('.group-tabs').offsetHeight + 8}px`; // under the tabs, so they stay usable
    host.innerHTML = `<div class="ci-pop ${p.tone}" role="${p.tone === 'warn' ? 'alert' : 'status'}">
      <span class="tile ${p.tone === 'ok' ? 'ok' : p.tone === 'warn' ? 'warn' : ''}">${I(p.icon)}</span>
      <div class="stack grow gap-2" style="min-width:0">
        <span class="overline muted">${esc(p.over || 'Check-in')}</span>
        <span class="label">${esc(p.title)}</span>
        ${p.text ? `<span class="small t2">${esc(p.text)}</span>` : ''}
        ${p.actions.length ? `<span class="row gap-8">${p.actions.map(([a, label, kind]) => `<button class="btn btn-${kind || 'outline'} btn-sm" type="button" data-pop="${esc(a)}">${esc(label)}</button>`).join('')}</span>` : ''}
      </div>
      <button class="icon-btn ghost" type="button" data-pop="ok" aria-label="Dismiss">${I('x', 16)}</button>
    </div>`;
    if (p.auto) popTimer = setTimeout(() => { markPop(p.key); popNow = null; showPop(); }, 6000);
  }
  $('[data-ci-pop]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pop]'); if (!b || !popNow) return;
    const p = popNow; const a = b.dataset.pop;
    markPop(p.key); popNow = null;
    try {
      if (a === 'home' || a === 'here') { b.disabled = true; await checkin(a); }
      else if (a === 'more') { b.disabled = true; await checkin('leaving', 20); }
      else if (a === 'sheet') openSheet(true);
      else if (a.startsWith('nudge:')) await nudge(a.slice(6));
    } catch (err) { toast(err.message); }
    showPop();
  });
  setInterval(() => { if (!document.hidden) { renderCheckinButton(); showPop(); } }, 30000);

  // ---------- moments ----------
  let moments = null;
  const momentCard = (m) => `<figure class="moment">
      <img src="${esc(m.url)}" alt="${esc(m.caption ? `${m.caption}, from ${m.name}` : `Photo from ${m.name}`)}" width="${m.w}" height="${m.h}" loading="lazy" decoding="async" style="aspect-ratio:${m.w} / ${m.h}">
      <figcaption class="stack gap-2"><span class="small">${esc(m.caption || '')}</span><span class="caption t3">${m.mine ? 'You' : esc(m.name)} · ${timeOf(m.at)}</span></figcaption>
      ${m.canRemove ? `<button class="icon-btn moment-remove" type="button" data-remove-moment="${esc(m.id)}" aria-label="Remove photo">${I('trash-2', 14)}</button>` : `<button class="icon-btn moment-remove" type="button" data-report-moment="${esc(m.id)}" aria-label="Report photo to the host" title="Report">${I('flag', 14)}</button>`}
    </figure>`;
  const renderMoments = () => {
    $('[data-moment-add]').hidden = readOnly();
    $('[data-moments]').innerHTML = moments.length ? moments.map(momentCard).join('') : `<div class="card state"><span class="tile">${I('image-plus')}</span><span class="label">No moments yet</span><span class="small t2">Add the first photo. Only people on the list will see it.</span></div>`;
    $('[data-moments]').classList.toggle('is-empty', !moments.length);
  };
  async function loadMoments() {
    if (!moments) $('[data-moments]').innerHTML = '<div class="skeleton" style="height:160px"></div>';
    try { moments = (await api('GET', withQ(`invites/${code}/moments`))).moments; g.moments = moments.length; renderMoments(); renderHead(); } catch (err) { toast(err.message); }
  }
  const mdlg = $('[data-moment-dialog]');
  const mform = $('[data-moment-form]');
  let pending = null;
  $('[data-moment-file]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      const { img, url } = await loadImage(file);
      pending = encodeFit(img);
      URL.revokeObjectURL(url);
      $('[data-moment-preview]').src = pending.data;
      mform.reset(); clearError(mform);
      mdlg.showModal();
    } catch (err) { toast(err.message); }
  });
  $$('[data-close]', mdlg).forEach((b) => b.addEventListener('click', () => mdlg.close()));
  onSubmit(mform, async (d) => {
    if (!pending) return;
    const r = await api('POST', `invites/${code}/moments`, body({ image: pending.data, w: pending.w, h: pending.h, caption: d.caption }));
    moments = [r.moment, ...(moments || [])]; g.moments = moments.length; pending = null;
    mdlg.close(); renderMoments(); renderHead(); toast('Shared with the list.');
  });
  $('[data-moments]').addEventListener('click', async (e) => {
    const rp = e.target.closest('[data-report-moment]');
    if (rp) { report('moment', rp.dataset.reportMoment); return; }
    const b = e.target.closest('[data-remove-moment]'); if (!b) return;
    if (!window.confirm('Remove this photo for everyone?')) return;
    try { await api('DELETE', `invites/${code}/moments/${b.dataset.removeMoment}`, body()); moments = moments.filter((m) => m.id !== b.dataset.removeMoment); g.moments = moments.length; renderMoments(); renderHead(); toast('Photo removed.'); } catch (err) { showError(mform, err); toast(err.message); }
  });

  // Reports go to the host, who can remove the photo or message.
  async function report(what, id) {
    if (!window.confirm(`Report this ${what === 'moment' ? 'photo' : 'message'} to the host? They’ll see it was you and can remove it.`)) return;
    try { await api('POST', `invites/${code}/report`, body({ what, id, room })); toast('Thanks. The host has been told.'); } catch (err) { toast(err.message); }
  }

  // ---------- start ----------
  renderHead();
  const start = location.hash.slice(1);
  setTab(['rides', 'moments'].includes(start) ? start : 'chat');
  await openRoom('all');
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); setTab(['rides', 'moments'].includes(t) ? t : 'chat'); });
  setInterval(poll, 4000);
  setInterval(async () => { if (document.hidden) return; try { await refresh(); } catch (err) { if (err.status === 403) location.reload(); } }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); refresh().catch(() => {}); } });
};

export default pages;
