// Vybez app: talks to /api and renders the signed-in parts of the site.
// Loaded after site.js (toasts, tabs, radios) and icons.js (window.VZ_ICONS).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const main = $('main[data-page]');
  const page = main?.dataset.page || '';
  const toast = (m) => window.vybezToast?.(m);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = (n, s = 20) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${(window.VZ_ICONS || {})[n] || ''}</svg>`;
  const initials = (name) => String(name || '?').replace(/^dj\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const num = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : Number(n || 0).toLocaleString('en-GB'));
  const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const lagos = (local) => new Date(`${local}:00+01:00`);
  const fmtWhen = (local, opts = {}) => (local ? lagos(local).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos', ...opts }) : '');
  const ago = (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const trackLine = (t) => [t.a, t.t].filter(Boolean).join(' - ');
  const isId = (t) => /^id\b/i.test(t.t || '') || /^id$/i.test(t.a || '');
  const spotify = (t) => `https://open.spotify.com/search/${encodeURIComponent(`${t.a} ${t.t}`)}`;
  const apple = (t) => `https://music.apple.com/search?term=${encodeURIComponent(`${t.a} ${t.t}`)}`;
  const listenLinks = (t) => (isId(t) ? '<span class="caption t3">Not on streaming</span>' : `<span class="listen-links"><a class="track-link" href="${spotify(t)}" target="_blank" rel="noopener nofollow" aria-label="Find ${esc(t.t)} on Spotify" title="Spotify">${BRAND.spotify}</a><a class="track-link" href="${apple(t)}" target="_blank" rel="noopener nofollow" aria-label="Find ${esc(t.t)} on Apple Music" title="Apple Music">${BRAND.apple}</a></span>`);
  const BRAND = {};
  // Reuse the brand marks already rendered on the page by the build, if any.
  const grabBrand = () => {
    const sp = document.querySelector('svg.b path[fill="#1ED760"]');
    const am = document.querySelector('svg.b path[fill="#FA243C"]');
    // pages that render tracks include hidden copies of the marks (data-brand-marks)
    BRAND.spotify = sp ? sp.closest('svg').outerHTML.replace(/width="\d+"/, 'width="18"').replace(/height="\d+"/, 'height="18"') : I('music', 18);
    BRAND.apple = am ? am.closest('svg').outerHTML.replace(/width="\d+"/, 'width="18"').replace(/height="\d+"/, 'height="18"') : I('headphones', 18);
  };
  grabBrand();
  const download = (name, text, type = 'text/plain') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = (text, msg = 'Copied.') => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Copy failed. Select the text and copy it instead.'));
    else toast('Copy is not available in this browser.');
  };
  const params = new URLSearchParams(location.search);
  const seg = (i) => decodeURIComponent(location.pathname.split('/').filter(Boolean)[i] || '');

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    let res;
    try { res = await fetch(`/api/${path}`, opts); } catch { throw Object.assign(new Error('You seem to be offline. Check your connection and try again.'), { status: 0 }); }
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { status: res.status, data });
    return data;
  }

  function showError(form, err) {
    const box = $('[data-error]', form);
    if (box) { box.textContent = err.message; box.hidden = false; } else toast(err.message);
  }
  function clearError(form) { const box = $('[data-error]', form); if (box) box.hidden = true; }

  // Wire a form: collects named fields, disables the submit button while working.
  function onSubmit(form, fn) {
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError(form);
      if (form.hasAttribute('novalidate') && !form.reportValidity()) return;
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v.trim() : v; });
      $$('input[type="checkbox"][name]', form).forEach((c) => { data[c.name] = c.checked; });
      const btns = $$('button[type="submit"], button:not([type])', form);
      btns.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
      try { await fn(data, form); } catch (err) { showError(form, err); } finally { btns.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); }); }
    });
  }

  const nextUrl = () => {
    const n = params.get('next');
    return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
  };
  const toSignin = () => { location.replace(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`); };

  let ME = null;
  let STATE = {};
  const mePromise = api('GET', 'me').then((d) => { STATE = d; ME = d.user; return d; }).catch(() => ({ user: null }));
  async function requireUser() {
    await mePromise;
    if (!ME) { toSignin(); throw new Error('signin'); }
    return ME;
  }

  // ---------- chrome: nav, sidebar, storage warning ----------
  mePromise.then((d) => {
    if (d.storage === 'memory' && (ME || /^(signup|signin|plan|invite)$/.test(page))) { const w = $('[data-store-warning]'); if (w) w.hidden = false; }
    $$('[data-signed-in]').forEach((el) => { el.hidden = !ME; });
    $$('[data-signed-out]').forEach((el) => { el.hidden = !!ME; });
    if (ME && ME.role === 'listener') $$('[data-dash-link]').forEach((a) => { a.href = '/me'; a.textContent = 'Your Vybez'; });
    if (ME) {
      const box = $('[data-me]');
      if (box) {
        $('[data-me-avatar]', box).textContent = initials(ME.name);
        $('[data-me-name]', box).textContent = ME.name;
        $('[data-me-sub]', box).textContent = `vybez/u/${ME.handle}`;
      }
      $$('[data-unread]').forEach((b) => { if (d.unread) { b.textContent = d.unread > 9 ? '9+' : d.unread; b.hidden = false; } });
      $$('[data-live-dot]').forEach((b) => { b.hidden = !d.live; });
      const bar = $('[data-preview-bar]'); if (bar) bar.hidden = true;
    }
  });

  document.addEventListener('click', async (e) => {
    const so = e.target.closest('[data-signout]');
    if (so) {
      e.preventDefault();
      await api('POST', 'auth/signout').catch(() => {});
      location.href = '/';
    }
  });

  // ---------- playlist import (runs in the browser; files are never uploaded) ----------
  function parseCsvRows(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',' || c === '\t' || c === ';') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function splitArtistTitle(line) {
    const s = line.replace(/^\s*(\d+[.)]?\s*)?(\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*)?[-–.]?\s*/, '').trim();
    const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m ? { a: m[1].trim(), t: m[2].trim() } : { a: '', t: s };
  }
  function parsePlaylist(name, text) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const xml = (src) => new DOMParser().parseFromString(src, 'application/xml');
    if (ext === 'xml' || /<DJ_PLAYLISTS/i.test(text)) {
      const doc = xml(text);
      const byId = {};
      const coll = $$('COLLECTION > TRACK', doc).map((t) => {
        const tr = { a: t.getAttribute('Artist') || '', t: t.getAttribute('Name') || '', bpm: Math.round(parseFloat(t.getAttribute('AverageBpm'))) || undefined, key: t.getAttribute('Tonality') || undefined };
        byId[t.getAttribute('TrackID')] = tr; return tr;
      });
      const lists = $$('PLAYLISTS NODE[Type="1"]', doc).filter((n) => n.querySelector('TRACK'));
      if (lists.length) {
        const pl = lists[0];
        return { title: pl.getAttribute('Name'), tracks: $$('TRACK', pl).map((t) => byId[t.getAttribute('Key')]).filter(Boolean) };
      }
      return { tracks: coll };
    }
    if (ext === 'nml' || /<NML/i.test(text)) {
      const doc = xml(text);
      const byKey = {};
      const coll = $$('COLLECTION > ENTRY', doc).map((en) => {
        const loc = en.querySelector('LOCATION');
        const tr = { a: en.getAttribute('ARTIST') || '', t: en.getAttribute('TITLE') || '', bpm: Math.round(parseFloat(en.querySelector('TEMPO')?.getAttribute('BPM'))) || undefined };
        if (loc) byKey[`${loc.getAttribute('VOLUME') || ''}${loc.getAttribute('DIR') || ''}${loc.getAttribute('FILE') || ''}`] = tr;
        return tr;
      });
      const pl = $$('PLAYLISTS NODE[TYPE="PLAYLIST"]', doc).find((n) => n.querySelector('PRIMARYKEY'));
      if (pl) {
        const tracks = $$('PRIMARYKEY', pl).map((k) => byKey[k.getAttribute('KEY')]).filter(Boolean);
        if (tracks.length) return { title: pl.getAttribute('NAME'), tracks };
      }
      return { tracks: coll };
    }
    if (ext === 'm3u' || ext === 'm3u8' || /^#EXTM3U/.test(text)) {
      const out = []; let info = null;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF')) { info = line.replace(/^#EXTINF:[^,]*,/, ''); continue; }
        if (line.startsWith('#')) continue;
        const base = info || decodeURIComponent(line.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, ''));
        out.push(splitArtistTitle(base)); info = null;
      }
      return { tracks: out };
    }
    if (ext === 'csv') {
      const rows = parseCsvRows(text);
      const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
      const col = (...names) => head.findIndex((h) => names.includes(h));
      const ti = col('name', 'title', 'track', 'track title', 'song');
      const ai = col('artist', 'artists');
      if (ti >= 0) {
        const bi = col('bpm'); const ki = col('key');
        const tracks = rows.slice(1).map((r) => ({ a: (r[ai] || '').trim(), t: (r[ti] || '').trim(), bpm: Math.round(parseFloat(r[bi])) || undefined, key: (r[ki] || '').trim() || undefined }))
          .filter((t, i) => (t.a || t.t) && !(i === 0 && !t.a && rows.length > 2)); // Serato puts the session name in row 1
        return { tracks };
      }
    }
    return { tracks: text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitArtistTitle).filter((t) => t.a || t.t) };
  }
  async function readPlaylistFile(file) {
    if (file.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB. Export a single playlist instead of your whole collection.');
    const text = await file.text();
    const res = parsePlaylist(file.name, text);
    res.tracks = res.tracks.filter((t) => t.a || t.t).slice(0, 400);
    if (!res.tracks.length) throw new Error('We couldn’t find any tracks in that file. Check it’s a rekordbox XML, Serato CSV, M3U, NML or text list.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    res.source = { xml: 'rekordbox XML', csv: 'Serato CSV', m3u: 'M3U playlist', m3u8: 'M3U playlist', nml: 'TRAKTOR NML', txt: 'Text list' }[ext] || 'File import';
    res.fallbackTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return res;
  }

  // ---------- shared renderers ----------
  const visLabel = { public: 'Everyone', followers: 'Followers only', unlisted: 'Link only', private: 'Only me' };
  const statusChip = (s) => (s.status === 'published' ? '<span class="chip dot success">Published</span>' : '<span class="chip dot warning">Draft</span>');
  const emptyState = (icon, title, text, action = '') => `<div class="state"><span class="tile">${I(icon)}</span><h3 class="h4">${esc(title)}</h3><p class="small t2">${text}</p>${action}</div>`;
  const tracklistItems = (tracks, nowIdx = -1) => tracks.map((t, i) => `<li class="track${i === nowIdx ? ' now' : ''}"><span class="num mono t3">${i + 1}</span><span class="cover-slot">${I('music', 18)}</span><span class="stack" style="min-width:0"><span class="label ellipsis">${esc(t.t || 'Untitled')}</span><span class="caption t3 ellipsis">${esc(t.a || 'Unknown artist')}${t.bpm ? ` · ${t.bpm} BPM` : ''}${t.key ? ` · ${esc(t.key)}` : ''}</span></span><span class="mono t2 played">${esc(t.at || '')}</span>${listenLinks(t)}</li>`).join('');
  const EMOJI = ['🔥', '🙌', '💃', '❤️', '🤯'];
  const EMOJI_LABEL = { '🔥': 'Fire', '🙌': 'Raised hands', '💃': 'Dancing', '❤️': 'Love', '🤯': 'Mind blown' };
  const feedItem = (c) => `<li class="${c.kind === 'request' ? 'request' : ''}${c.dj ? ' dj' : ''}"><span class="avatar">${esc(initials(c.name))}</span><p><strong>${esc(c.name)}</strong>${c.dj ? ' <span class="chip accent" style="height:20px">DJ</span>' : ''}${c.kind === 'request' ? ' <span class="chip accent" style="height:20px">Request</span>' : ''} <span class="t2">${esc(c.text)}</span> <span class="caption t3">${ago(c.at)}</span></p></li>`;

  async function createSetFromFile(file) {
    const res = await readPlaylistFile(file);
    const { set } = await api('POST', 'sets', { title: (res.title || res.fallbackTitle || 'Imported set').slice(0, 90), source: res.source, tracks: res.tracks });
    store.set('vybez-flash', `Imported ${plural(set.tracks.length, 'track')}. Check them, then publish.`);
    location.href = `/dj/sets/${set.id}`;
  }

  function bindImport(zone, input, handler) {
    if (!zone) return;
    const run = async (files) => {
      if (!files || !files[0]) return;
      try { toast('Reading your file…'); await handler(files[0]); } catch (err) { toast(err.message); }
    };
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => run(e.dataTransfer?.files));
    input?.addEventListener('change', () => { run(input.files); input.value = ''; });
  }

  const flash = store.get('vybez-flash');
  if (flash) { store.del('vybez-flash'); setTimeout(() => toast(flash), 200); }

  // ---------- pages ----------
  const pages = {};

  pages.signup = () => {
    mePromise.then(() => { if (ME) location.replace(nextUrl() || (ME.role === 'listener' ? '/me' : '/dj')); });
    $$('[data-keep-next]').forEach((a) => { if (nextUrl()) a.href += `?next=${encodeURIComponent(nextUrl())}`; });
    onSubmit($('[data-form="signup"]'), async (d) => {
      const role = $('[data-role-group] [aria-checked="true"]')?.dataset.value || 'dj';
      await api('POST', 'auth/signup', { ...d, role });
      location.href = `/welcome${nextUrl() ? `?next=${encodeURIComponent(nextUrl())}` : ''}`;
    });
  };

  pages.signin = () => {
    mePromise.then(() => { if (ME) location.replace(nextUrl() || '/dj'); });
    $$('[data-keep-next]').forEach((a) => { if (nextUrl()) a.href += `?next=${encodeURIComponent(nextUrl())}`; });
    onSubmit($('[data-form="signin"]'), async (d) => {
      const { user } = await api('POST', 'auth/signin', d);
      location.href = nextUrl() || (!user.onboarded ? '/welcome' : user.role === 'listener' ? '/me' : '/dj');
    });
  };

  pages.forgot = () => {
    onSubmit($('[data-form="forgot"]'), async (d, form) => {
      const r = await api('POST', 'auth/forgot', d);
      const done = $('[data-done]', form);
      const text = $('[data-done-text]', form);
      if (r.devLink) text.innerHTML = `Local development: there’s no email service, so here’s the link. <a class="link" href="${esc(r.devLink)}">Reset your password</a>`;
      else if (!r.emailConfigured) text.textContent = 'Email isn’t switched on for Vybez yet, so we can’t send reset links. Ask the Vybez team on WhatsApp to reset it for you.';
      done.hidden = false; done.focus();
    });
  };

  pages.reset = () => {
    onSubmit($('[data-form="reset"]'), async (d) => {
      await api('POST', 'auth/reset', { token: params.get('token') || '', password: d.password });
      store.set('vybez-flash', 'Password updated. You’re signed in.');
      location.href = '/dj';
    });
  };

  pages.welcome = async () => {
    const u = await requireUser();
    const isDj = u.role === 'dj';
    let step = 1;
    const genres = new Set(u.genres || []);
    let software = u.software || '';
    $$('[data-dj-only]').forEach((el) => { el.hidden = !isDj; });
    if (!isDj) $('[data-last-num]').textContent = '3';
    const f1 = $('[data-step="1"]');
    f1.name.value = u.name; f1.handle.value = u.handle; f1.city.value = u.city || ''; if (f1.bio) f1.bio.value = u.bio || '';
    $$('[data-genres] .pill').forEach((p) => {
      p.setAttribute('aria-pressed', String(genres.has(p.textContent)));
      p.addEventListener('click', () => {
        const on = p.getAttribute('aria-pressed') !== 'true';
        if (on && genres.size >= 6) { toast('Pick up to 6.'); return; }
        p.setAttribute('aria-pressed', String(on));
        if (on) genres.add(p.textContent); else genres.delete(p.textContent);
        $('[data-genre-count]').textContent = `${genres.size} of 6 picked`;
      });
    });
    $('[data-genre-count]').textContent = `${genres.size} of 6 picked`;
    $$('[data-software] [data-press]').forEach((b) => {
      if (b.dataset.value === software) b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => { software = b.dataset.value; });
    });
    const order = isDj ? [1, 2, 3, 4] : [1, 2, 4];
    const go = (n) => {
      step = n;
      $$('[data-step]').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
      const lis = $$('[data-steps] li').filter((li) => !li.hidden);
      const idx = order.indexOf(n);
      lis.forEach((li, i) => { li.classList.toggle('done', i < idx); if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      $(`[data-step="${n}"] input, [data-step="${n}"] button, [data-step="${n}"] a`)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    };
    const next = () => go(order[order.indexOf(step) + 1]);
    $$('[data-back]').forEach((b) => b.addEventListener('click', () => go(order[order.indexOf(step) - 1])));
    onSubmit(f1, async (d) => { await api('PATCH', 'me', { name: d.name, handle: d.handle, city: d.city, ...(isDj ? { bio: d.bio } : {}) }); next(); });
    onSubmit($('[data-step="2"]'), async () => { await api('PATCH', 'me', { genres: [...genres] }); next(); });
    onSubmit($('[data-step="3"]'), async () => { await api('PATCH', 'me', { software }); next(); });
    const finish = async () => {
      await api('PATCH', 'me', { onboarded: true }).catch(() => {});
      $('[data-next-dj]').hidden = !isDj;
      $('[data-next-listener]').hidden = isDj;
      if (nextUrl()) { location.href = nextUrl(); }
    };
    const obs = new MutationObserver(() => { if (!$('[data-step="4"]').hidden) { finish(); obs.disconnect(); } });
    obs.observe($('[data-step="4"]'), { attributes: true });
    go(1);
  };

  pages.dashboard = async () => {
    await mePromise;
    if (!ME) return; // demo stays
    if (ME.role === 'listener' && !params.has('dj')) { /* listeners can still use the DJ tools */ }
    $('[data-demo]').hidden = true;
    const real = $('[data-real]'); real.hidden = false;
    const hour = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }));
    $('[data-greeting]').textContent = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${ME.name.split(' ').slice(-1)[0] === ME.name ? ME.name : ME.name.replace(/^DJ\s+/i, '')}`;
    const profileUrl = `${location.origin}/u/${ME.handle}`;
    $('[data-profile-url]').textContent = profileUrl.replace(/^https?:\/\//, '');
    $('[data-profile-link]').href = `/u/${ME.handle}`;
    $('[data-copy-profile]').addEventListener('click', () => copy(profileUrl, 'Profile link copied.'));
    const [{ sets }, ins, notifs, nights] = await Promise.all([api('GET', 'sets'), api('GET', 'insights'), api('GET', 'notifications'), api('GET', 'nights')]);
    const drafts = sets.filter((s) => s.status !== 'published').length;
    const upcoming = nights.nights.filter((n) => lagos(n.when) > Date.now() && n.status !== 'cancelled');
    $('[data-summary]').textContent = sets.length
      ? `${plural(sets.length, 'set')}${drafts ? `, ${drafts} still in draft` : ''}. ${upcoming.length ? `Next night: ${upcoming[0].title}, ${fmtWhen(upcoming[0].when)}.` : ''}`
      : 'Let’s get your first set in.';
    const gs = [
      { done: !!(ME.bio && ME.city), text: 'Add a bio and city', href: '/dj/settings#profile' },
      { done: sets.length > 0, text: 'Import your first set', href: '/dj/sets?import=1' },
      { done: sets.some((s) => s.status === 'published'), text: 'Publish a tracklist', href: '/dj/sets' },
      { done: ins.followers > 0, text: 'Share your page for a first follower', href: `/u/${ME.handle}` },
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
    if (upcoming[0]) {
      const n = upcoming[0];
      $('[data-next-night]').innerHTML = `<p class="overline">Next night</p><h2 class="h3">${esc(n.title)}</h2><p class="small t2">${esc(fmtWhen(n.when))} · ${esc(n.area)}<br>${n.going} of ${n.cap} going${n.asking ? ` · ${n.asking} asking` : ''}</p><div class="row gap-8 wrap-row"><a class="btn btn-primary btn-sm" href="/social/${n.id}">${I('users', 16)}Guest list</a><a class="btn btn-outline btn-sm" href="/social/${n.id}/door">${I('scan-line', 16)}Door mode</a></div>`;
    }
  };

  const ACT_ICON = { follow: 'user-plus', rsvp: 'ticket', comment: 'message-square-quote', save: 'bookmark', live: 'radio' };
  const activityRow = (a) => `<a class="activity-row" href="${esc(a.link || '#')}"><span class="tile">${I(ACT_ICON[a.type] || 'bell', 16)}</span><span class="grow">${esc(a.text)}<br><span class="caption t3">${ago(a.at)}</span></span></a>`;

  pages.sets = async () => {
    await mePromise;
    if (!ME) return;
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
    if (set.owner !== ME.id) { location.replace(`/s/${id}`); return; }
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
        try { const r = await api('PATCH', 'me', { prefs: { [sw.dataset.pref]: on } }); ME = r.user; } catch (err) { toast(err.message); }
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
  pages.live = async () => {
    const handle = seg(1);
    await mePromise;
    let since = 0; let feed = []; let following = false;
    const nameKey = 'vybez-guest-name';
    const cf = $('[data-comment-form]');
    if (ME) $('[data-name-field]').hidden = true; else cf.name.value = store.get(nameKey) || '';
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
      if (!ME) { toSignin(); return; }
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
      if (!ME) store.set(nameKey, data.name || '');
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
      if (!ME) { toSignin(); return; }
      try { const r = await api('POST', `sets/${s.id}/save`); saved = r.saved; setSave(); toast(saved ? 'Saved to Your Vybez.' : 'Removed from saved.'); } catch (err) { toast(err.message); }
    });
    $('[data-copy-list]').addEventListener('click', () => copy(`${s.title} · ${d.dj.name}\n${s.tracks.map((t, i) => `${i + 1}. ${trackLine(t)}`).join('\n')}`, 'Tracklist copied as text.'));
    $('[data-reacts]').innerHTML = EMOJI.map((e) => `<button class="emoji-react" type="button" data-emoji="${e}" aria-label="${EMOJI_LABEL[e]}">${e} <span>${num(s.reactions[e] || 0)}</span></button>`).join('');
    $('[data-reacts]').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-emoji]'); if (!b) return;
      try { const r = await api('POST', `sets/${s.id}/react`, { emoji: b.dataset.emoji }); $('span', b).textContent = num(r.count); b.setAttribute('aria-pressed', 'true'); } catch (err) { toast(err.message); }
    });
    const cf = $('[data-comment-form]');
    if (ME) $('[data-name-field]').hidden = true; else cf.name.value = store.get('vybez-guest-name') || '';
    const loadComments = async () => {
      const { comments } = await api('GET', `sets/${s.id}/comments`);
      $('[data-comments]').dataset.empty = 'No comments yet.';
      $('[data-comments]').innerHTML = comments.map(feedItem).join('');
    };
    onSubmit(cf, async (data) => {
      if (!data.text) return;
      if (!ME) store.set('vybez-guest-name', data.name || '');
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
    if (links.length) { $('[data-links]').hidden = false; $('[data-link-list]').innerHTML = links.map(([k, v]) => `<a class="link" href="${esc(v)}" target="_blank" rel="noopener nofollow me">${I('external-link', 14)} ${esc(k[0].toUpperCase() + k.slice(1))}</a>`).join(''); }
    const fb = $('[data-follow]');
    let following = d.following;
    if (d.mine) { fb.hidden = true; $('[data-edit]').hidden = false; }
    const setFollow = () => { fb.setAttribute('aria-pressed', String(following)); fb.textContent = following ? 'Following' : 'Follow'; fb.className = `btn ${following ? 'btn-outline' : 'btn-primary'}`; };
    setFollow();
    fb.addEventListener('click', async () => {
      if (!ME) { toSignin(); return; }
      try { const r = await api('POST', `users/${handle}/follow`); following = r.following; setFollow(); $('[data-followers]').textContent = num(r.followers); } catch (err) { toast(err.message); }
    });
    $('[data-share]').addEventListener('click', () => { if (navigator.share) navigator.share({ title: `${u.name} on Vybez`, url: location.href }).catch(() => {}); else copy(location.href, 'Profile link copied.'); });
  };

  pages.me = async () => {
    const u = await requireUser();
    $('[data-hello]').textContent = `Hi, ${u.name}`;
    $('[data-dj-cta]').hidden = u.role !== 'dj';
    if (STATE.unread) { const b = $('[data-unread]'); b.textContent = STATE.unread; b.hidden = false; }
    const [saved, nights] = await Promise.all([api('GET', 'me/saved'), api('GET', 'nights')]);
    $('[data-following]').innerHTML = saved.following.length ? saved.following.map((f) => `<a class="card follow-card" href="${f.live ? `/live/${f.handle}` : `/u/${f.handle}`}"><span class="avatar md">${esc(initials(f.name))}</span><span class="stack grow" style="min-width:0"><span class="label ellipsis">${esc(f.name)}</span><span class="caption t3 ellipsis">${esc([f.city, ...(f.genres || []).slice(0, 1)].filter(Boolean).join(' · ') || `@${f.handle}`)}</span></span>${f.live ? '<span class="live-badge">Live</span>' : I('chevron-right', 18)}</a>`).join('') : `<div class="card" style="grid-column:1/-1">${emptyState('headphones', 'You’re not following anyone yet', 'Find DJs on Explore and follow them to hear when they go live.', '<a class="btn btn-primary btn-sm" href="/explore">Explore</a>')}</div>`;
    $('[data-saved]').innerHTML = saved.sets.length ? saved.sets.map((s, i) => `<a class="card set-row" href="/s/${s.id}"><span class="art g${(i % 6) + 1}"></span><span class="stack grow gap-2"><span class="label">${esc(s.title)}</span><span class="caption t3">${esc(s.dj?.name || '')} · ${fmtDate(s.date)} · ${plural(s.tracks, 'track')}</span></span>${I('chevron-right', 18)}</a>`).join('') : '<div class="card">' + emptyState('bookmark', 'No saved tracklists', 'Tap “Save tracklist” on any set to keep it here.') + '</div>';
    $('[data-nights]').innerHTML = nights.nights.length ? nights.nights.map(nightRow).join('') : '<p class="small t2">No nights yet.</p>';
  };

  const NOTIF_ICON = ACT_ICON;
  pages.notifications = async () => {
    await requireUser();
    const { items, readAt } = await api('GET', 'notifications');
    let k = 'all';
    const render = () => {
      const list = items.filter((n) => k === 'all' || n.type === k || (k === 'comment' && n.type === 'save'));
      $('[data-notifs]').innerHTML = list.length ? list.map((n) => `<li class="${n.at > readAt ? 'unread' : ''}"><span class="tile">${I(NOTIF_ICON[n.type] || 'bell', 18)}</span><a class="stack grow gap-2" href="${esc(n.link || '#')}"><span class="small">${esc(n.text)}</span><span class="caption t3">${ago(n.at)}</span></a>${n.at > readAt ? '<span class="badge">New</span>' : ''}</li>`).join('') : `<li>${emptyState('bell', 'Nothing here yet', 'Follows, RSVPs, comments and live rooms from DJs you follow show up here.')}</li>`;
    };
    $$('[data-notif-filter] [data-k]').forEach((b) => b.addEventListener('click', () => { k = b.dataset.k; $$('[data-notif-filter] [data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }));
    render();
    api('POST', 'notifications/read').then(() => $$('[data-unread]').forEach((b) => { b.hidden = true; })).catch(() => {});
  };

  pages.explore = async () => {
    let d;
    try { d = await api('GET', 'explore'); } catch { return; }
    await mePromise;
    if (d.live.length) {
      $('[data-real-live]').hidden = false;
      $('[data-live-list]').innerHTML = d.live.map((r, i) => `<article class="live-card stack gap-16"><a class="cover rings photo" href="/live/${r.dj.handle}" style="border-radius:16px;aspect-ratio:413/250;display:block" aria-label="Join ${esc(r.dj.name)}"><div class="over" style="left:16px;top:16px"><span class="live-badge">Live</span></div></a><div class="row gap-16"><div class="stack grow gap-2" style="min-width:0"><h3 class="h4 ellipsis">${esc(r.title)}</h3><p class="caption t3 ellipsis">${esc(r.dj.name)}${r.now ? ` · Now playing: ${esc(r.now.t)}, ${esc(r.now.a)}` : ''}</p></div><a class="btn btn-primary btn-sm" href="/live/${r.dj.handle}">Join</a></div></article>`).join('');
    }
    const djs = d.djs.filter((x) => x.id !== ME?.id);
    if (djs.length) {
      $('[data-real-djs]').hidden = false;
      $('[data-dj-list]').innerHTML = djs.map((x) => `<div class="card follow-card"><span class="avatar md">${esc(initials(x.name))}</span><a class="stack grow" href="/u/${x.handle}" style="min-width:0"><span class="label ellipsis">${esc(x.name)}</span><span class="caption t3 ellipsis">${esc([(x.genres || [])[0], x.city, `${num(x.followers)} followers`].filter(Boolean).join(' · '))}</span></a><button class="btn ${x.following ? 'btn-outline' : 'btn-primary'} btn-sm" type="button" data-follow-handle="${esc(x.handle)}" aria-pressed="${x.following}">${x.following ? 'Following' : 'Follow'}</button></div>`).join('');
      $('[data-dj-list]').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-follow-handle]'); if (!b) return;
        if (!ME) { toSignin(); return; }
        try { const r = await api('POST', `users/${b.dataset.followHandle}/follow`); b.setAttribute('aria-pressed', String(r.following)); b.textContent = r.following ? 'Following' : 'Follow'; b.className = `btn ${r.following ? 'btn-outline' : 'btn-primary'} btn-sm`; } catch (err) { toast(err.message); }
      });
    }
    if (d.sets.length) {
      $('[data-real-sets]').hidden = false;
      $('[data-set-list]').innerHTML = d.sets.map((s, i) => `<a class="card set-row" href="/s/${s.id}"><span class="art g${(i % 6) + 1}"></span><span class="stack grow gap-2"><span class="label">${esc(s.title)}</span><span class="caption t3">${esc(s.dj?.name || '')} · ${fmtDate(s.date)} · ${plural(s.tracks, 'track')}</span></span>${I('chevron-right', 18)}</a>`).join('');
    }
  };

  // Vybez Social: host pages
  const nightRow = (n) => {
    const d = lagos(n.when);
    const past = d < Date.now();
    return `<div class="card night-row"><span class="date-tile"><span class="overline">${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Africa/Lagos' })}</span><span class="h3">${d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' })}</span></span><div class="stack grow gap-2"><a class="h4" href="/social/${n.id}">${esc(n.title)}</a><span class="caption t3">${esc(fmtWhen(n.when))} · ${esc(n.area)}</span></div><span class="row gap-8 wrap-row">${n.status === 'cancelled' ? '<span class="chip danger">Cancelled</span>' : past ? '<span class="chip">Past</span>' : ''}<span class="chip success">${n.going} of ${n.cap} going</span>${n.asking ? `<span class="chip warning">${n.asking} asking</span>` : ''}</span><a class="btn btn-outline btn-sm" href="/social/${n.id}">Manage</a></div>`;
  };

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
    if (!ME) { $('[data-signin-note]').hidden = false; $('[data-submit]').textContent = 'Sign in to create the invite'; }
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
    if (editId && ME) {
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
      if (!ME) {
        store.set('vybez-night-draft', JSON.stringify({ ...d, cover, fields }));
        location.href = `/signup?next=${encodeURIComponent('/social/new')}`;
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

  // Guest invite page (no account)
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

  pages.settings = async () => {
    const u = await requireUser();
    const pf = $('[data-profile-form]');
    const fill = (x) => {
      pf.name.value = x.name; pf.handle.value = x.handle; pf.bio.value = x.bio || ''; pf.city.value = x.city || ''; pf.genres.value = (x.genres || []).join(', ');
      for (const k of ['mixcloud', 'soundcloud', 'instagram', 'youtube']) pf[k].value = x.links?.[k] || '';
      $('[data-avatar]').textContent = initials(x.name);
      $('[data-view-profile]').href = `/u/${x.handle}`;
      $('[data-email]').textContent = x.email;
      $('[data-role-select]').value = x.role;
      $$('[data-notify]').forEach((sw) => sw.setAttribute('aria-checked', String(!!x.prefs.notify[sw.dataset.notify])));
      $$('[data-pref]').forEach((sw) => sw.setAttribute('aria-checked', String(x.prefs[sw.dataset.pref] !== false)));
      $$('[data-visibility] [data-radio]').forEach((r) => { const on = r.dataset.value === x.prefs.visibility; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; });
    };
    fill(u);
    onSubmit(pf, async (d) => {
      const r = await api('PATCH', 'me', { name: d.name, handle: d.handle, bio: d.bio, city: d.city, genres: d.genres.split(',').map((g) => g.trim()).filter(Boolean), links: { mixcloud: d.mixcloud, soundcloud: d.soundcloud, instagram: d.instagram, youtube: d.youtube } });
      ME = r.user; fill(ME); toast('Profile saved.');
    });
    const patch = async (body, msg) => { try { const r = await api('PATCH', 'me', body); ME = r.user; if (msg) toast(msg); } catch (err) { toast(err.message); fill(ME); } };
    $$('[data-notify]').forEach((sw) => sw.addEventListener('click', () => { const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); patch({ prefs: { notify: { [sw.dataset.notify]: on } } }, 'Saved.'); }));
    $$('[data-pref]').forEach((sw) => sw.addEventListener('click', () => { const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); patch({ prefs: { [sw.dataset.pref]: on } }, 'Saved.'); }));
    $$('[data-visibility] [data-radio]').forEach((r) => r.addEventListener('click', () => patch({ prefs: { visibility: r.dataset.value } }, 'New sets will use this.')));
    $('[data-role-select]').addEventListener('change', (e) => patch({ role: e.target.value }, 'Saved.'));
    onSubmit($('[data-password-form]'), async (d, f) => { await api('POST', 'me/password', d); f.reset(); toast('Password updated.'); });
    $('[data-export]').addEventListener('click', async () => {
      try { const data = await api('GET', 'me/export'); download(`vybez-${ME.handle}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); } catch (err) { toast(err.message); }
    });
    const dlg = $('[data-delete-dialog]');
    $('[data-delete-open]').addEventListener('click', () => dlg.showModal());
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    onSubmit($('[data-delete-form]'), async (d) => { await api('DELETE', 'me', { password: d.password }); location.href = '/?deleted=1'; });
    // Highlight the section in view.
    const links = $$('[data-settings-nav] a[href^="#"]');
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => { if (a.getAttribute('href') === `#${en.target.id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }), { rootMargin: '-30% 0px -60% 0px' });
    ['profile', 'account', 'notifications', 'privacy'].forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  };

  pages.connections = async () => {
    await mePromise;
    if (!ME) return;
    const map = { 'Serato DJ Pro': 'Serato', rekordbox: 'rekordbox', VirtualDJ: 'VirtualDJ', TRAKTOR: 'TRAKTOR' };
    $$('.sw-card[data-press]').forEach((b) => {
      const name = map[$('.label', b)?.textContent];
      if (!name) return;
      b.setAttribute('aria-pressed', String(ME.software === name));
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true') return; api('PATCH', 'me', { software: name }).then(() => toast(`Saved: you play on ${name}.`)).catch((err) => toast(err.message)); });
    });
  };

  pages.upgrade = async () => {
    await mePromise;
    if (!ME) { const n = document.createElement('p'); n.className = 'notice'; n.innerHTML = `${I('info', 18)}<span>You’ll need a free account first. <a class="link" href="/signup?next=/upgrade">Create one</a> or <a class="link" href="/signin?next=/upgrade">sign in</a>.</span>`; $('[data-pay]').prepend(n); }
  };

  if (pages[page]) {
    Promise.resolve(pages[page]()).catch((err) => {
      if (err && err.message === 'signin') return;
      console.error(err);
      toast(err?.message || 'Something went wrong. Refresh to try again.');
    });
  }
  // Pages without a controller still get /dj/connections behaviour by path.
  if (!page && location.pathname === '/dj/connections') pages.connections();
})();
