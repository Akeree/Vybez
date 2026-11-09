// Account pages shared by both products: notifications and settings.
import { $, $$, I, ago, download, esc, initials, toast } from '../core/util.js';
import { api, onSubmit } from '../core/api.js';
import { S, requireUser, productOf, homeFor, pathFor, PRODUCT_NAME } from '../core/session.js';
import { ACT_ICON, emptyState } from '../core/ui.js';
const pages = {};

const NOTIF_ICON = ACT_ICON;
pages.notifications = async () => {
  await requireUser();
  // DJ accounts get follows, saves, comments and live rooms; Social accounts get RSVPs.
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


pages.settings = async () => {
  const u = await requireUser();
  const pf = $('[data-profile-form]');
  // The same form serves both products; DJ-only fields are left out of the Social page at build time.
  const has = (k) => !!pf[k];
  const fill = (x) => {
    pf.name.value = x.name; pf.city.value = x.city || '';
    if (has('handle')) pf.handle.value = x.handle;
    if (has('bio')) pf.bio.value = x.bio || '';
    if (has('genres')) pf.genres.value = (x.genres || []).join(', ');
    for (const k of ['mixcloud', 'soundcloud', 'instagram', 'youtube']) if (has(k)) pf[k].value = x.links?.[k] || '';
    $('[data-avatar]').textContent = initials(x.name);
    const vp = $('[data-view-profile]'); if (vp) vp.href = `/u/${x.handle}`;
    $('[data-email]').textContent = x.email;
    $('[data-product-select]').value = productOf(x);
    $$('[data-notify]').forEach((sw) => sw.setAttribute('aria-checked', String(!!x.prefs.notify[sw.dataset.notify])));
    $$('[data-pref]').forEach((sw) => sw.setAttribute('aria-checked', String(x.prefs[sw.dataset.pref] !== false)));
    $$('[data-visibility] [data-radio]').forEach((r) => { const on = r.dataset.value === x.prefs.visibility; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; });
  };
  fill(u);
  onSubmit(pf, async (d) => {
    const body = { name: d.name, city: d.city };
    if (has('handle')) Object.assign(body, { handle: d.handle, bio: d.bio, genres: d.genres.split(',').map((g) => g.trim()).filter(Boolean), links: { mixcloud: d.mixcloud, soundcloud: d.soundcloud, instagram: d.instagram, youtube: d.youtube } });
    const r = await api('PATCH', 'me', body);
    S.me = r.user; fill(S.me); toast('Profile saved.');
  });
  const patch = async (body, msg) => { try { const r = await api('PATCH', 'me', body); S.me = r.user; if (msg) toast(msg); } catch (err) { toast(err.message); fill(S.me); } };
  $$('[data-notify]').forEach((sw) => sw.addEventListener('click', () => { const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); patch({ prefs: { notify: { [sw.dataset.notify]: on } } }, 'Saved.'); }));
  $$('[data-pref]').forEach((sw) => sw.addEventListener('click', () => { const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); patch({ prefs: { [sw.dataset.pref]: on } }, 'Saved.'); }));
  $$('[data-visibility] [data-radio]').forEach((r) => r.addEventListener('click', () => patch({ prefs: { visibility: r.dataset.value } }, 'New sets will use this.')));
  $('[data-product-select]').addEventListener('change', async (e) => {
    const next = e.target.value;
    if (!window.confirm(`Switch this account to ${PRODUCT_NAME[next]}? Your data stays, but you’ll only see ${PRODUCT_NAME[next]} pages.`)) { e.target.value = productOf(S.me); return; }
    try { const r = await api('PATCH', 'me', { product: next }); S.me = r.user; location.href = homeFor(S.me); } catch (err) { toast(err.message); e.target.value = productOf(S.me); }
  });
  onSubmit($('[data-password-form]'), async (d, f) => { await api('POST', 'me/password', d); f.reset(); toast('Password updated.'); });
  $('[data-export]').addEventListener('click', async () => {
    try { const data = await api('GET', 'me/export'); download(`vybez-${S.me.handle}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); } catch (err) { toast(err.message); }
  });
  const dlg = $('[data-delete-dialog]');
  $('[data-delete-open]').addEventListener('click', () => dlg.showModal());
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  onSubmit($('[data-delete-form]'), async (d) => { await api('DELETE', 'me', { password: d.password }); location.href = '/?deleted=1'; });
  // Highlight the section in view.
  const links = $$('[data-settings-nav] a[href^="#"]');
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => { if (a.getAttribute('href') === `#${en.target.id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }), { rootMargin: '-30% 0px -60% 0px' });
  ['profile', 'account', 'notifications', 'data'].forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
};


// /me and /notifications from before the split: send each account to its own version.
pages.home = async () => {
  const u = await requireUser();
  const to = document.querySelector('main').dataset.to;
  location.replace(to === 'notifications' ? pathFor(u, 'notifications') : productOf(u) === 'dj' ? '/dj/following' : homeFor(u));
};

export default pages;
