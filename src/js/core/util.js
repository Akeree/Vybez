// Small browser helpers shared by every page. No framework, no dependencies.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const toast = (m) => window.vybezToast?.(m);
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const I = (n, s = 20) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${(window.VZ_ICONS || {})[n] || ''}</svg>`;
export const initials = (name) => String(name || '?').replace(/^dj\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const num = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : Number(n || 0).toLocaleString('en-GB'));
export const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const lagos = (local) => new Date(`${local}:00+01:00`);
export const fmtWhen = (local, opts = {}) => (local ? lagos(local).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos', ...opts }) : '');
export const ago = (ts) => {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export const trackLine = (t) => [t.a, t.t].filter(Boolean).join(' - ');
export const isId = (t) => /^id\b/i.test(t.t || '') || /^id$/i.test(t.a || '');
export const spotify = (t) => `https://open.spotify.com/search/${encodeURIComponent(`${t.a} ${t.t}`)}`;
export const apple = (t) => `https://music.apple.com/search?term=${encodeURIComponent(`${t.a} ${t.t}`)}`;
export const listenLinks = (t) => (isId(t) ? '<span class="caption t3">Not on streaming</span>' : `<span class="listen-links"><a class="track-link" href="${spotify(t)}" target="_blank" rel="noopener nofollow" aria-label="Find ${esc(t.t)} on Spotify" title="Spotify">${BRAND.spotify}</a><a class="track-link" href="${apple(t)}" target="_blank" rel="noopener nofollow" aria-label="Find ${esc(t.t)} on Apple Music" title="Apple Music">${BRAND.apple}</a></span>`);
export const BRAND = {};
// Reuse the brand marks already rendered on the page by the build, if any.
export const grabBrand = () => {
  const sp = document.querySelector('svg.b path[fill="#1ED760"]');
  const am = document.querySelector('svg.b path[fill="#FA243C"]');
  // pages that render tracks include hidden copies of the marks (data-brand-marks)
  BRAND.spotify = sp ? sp.closest('svg').outerHTML.replace(/width="\d+"/, 'width="18"').replace(/height="\d+"/, 'height="18"') : I('music', 18);
  BRAND.apple = am ? am.closest('svg').outerHTML.replace(/width="\d+"/, 'width="18"').replace(/height="\d+"/, 'height="18"') : I('headphones', 18);
};
grabBrand();
export const download = (name, text, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const copy = (text, msg = 'Copied.') => {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Copy failed. Select the text and copy it instead.'));
  else toast('Copy is not available in this browser.');
};
export const params = new URLSearchParams(location.search);
export const seg = (i) => decodeURIComponent(location.pathname.split('/').filter(Boolean)[i] || '');
