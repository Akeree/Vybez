// Who is signed in, and which Vybez they belong to.
// Every account is either Vybez DJ ('dj') or Vybez Social ('social'). Each side only shows
// its own pages; the API enforces the same rule (server/domain/users.js needProduct).
import { $, $$, initials } from './util.js';
import { api, toSignin } from './api.js';

export const S = { me: null, state: {} };

export const productOf = (u) => (u?.product === 'social' || u?.product === 'dj' ? u.product : u?.role === 'dj' ? 'dj' : 'social');
export const PRODUCT_NAME = { dj: 'Vybez DJ', social: 'Vybez Social' };
// Where an account lands after signing in.
export const homeFor = (u) => (!u ? '/' : !u.onboarded ? '/welcome' : productOf(u) === 'social' ? '/social' : '/dj');
// Product-specific versions of shared pages, e.g. pathFor(me, 'settings').
export const pathFor = (u, what) => `/${productOf(u) === 'social' ? 'social' : 'dj'}/${what}`;

export const mePromise = api('GET', 'me')
  .then((d) => { S.state = d; S.me = d.user; return d; })
  .catch(() => ({ user: null }));

export async function requireUser() {
  await mePromise;
  if (!S.me) { toSignin(); throw new Error('signin'); }
  return S.me;
}

// Fill in the signed-in chrome: nav buttons, sidebar account box, unread and live badges.
export function paintChrome(page) {
  mePromise.then((d) => {
    const me = S.me;
    if (d.storage === 'memory' && (me || /^(signup|signin|plan|invite)$/.test(page))) { const w = $('[data-store-warning]'); if (w) w.hidden = false; }
    $$('[data-signed-in]').forEach((el) => { el.hidden = !me; });
    $$('[data-signed-out]').forEach((el) => { el.hidden = !!me; });
    if (!me) return;
    const product = productOf(me);
    $$('[data-dash-link]').forEach((a) => { a.href = homeFor(me); a.textContent = product === 'social' ? 'Your nights' : 'Dashboard'; });
    const box = $('[data-me]');
    if (box) {
      $('[data-me-avatar]', box).textContent = initials(me.name);
      $('[data-me-name]', box).textContent = me.name;
      $('[data-me-sub]', box).textContent = product === 'social' ? me.email : `vybez/u/${me.handle}`;
    }
    $$('[data-unread]').forEach((b) => { if (d.unread) { b.textContent = d.unread > 9 ? '9+' : d.unread; b.hidden = false; } });
    $$('[data-live-dot]').forEach((b) => { b.hidden = !d.live; });
    const bar = $('[data-preview-bar]'); if (bar) bar.hidden = true;
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-signout]')) return;
    e.preventDefault();
    await api('POST', 'auth/signout').catch(() => {});
    location.href = '/';
  });
}
