// Vybez app entry. Loaded as an ES module on every page after site.js and icons.js.
//   core/     helpers, API client, session, playlist parser, shared renderers
//   pages/    one module per area; only the module the current page needs is downloaded
// Each page's <main> carries data-page (its controller) and, for signed-in areas,
// data-product ('dj' or 'social'). A signed-in account that opens the other product's
// page is sent to its own home, so DJ accounts only see DJ pages and Social accounts
// only see Social pages.
import { $, store, toast } from './core/util.js';
import { S, mePromise, paintChrome, productOf, homeFor, PRODUCT_NAME } from './core/session.js';

const main = $('main[data-page]');
const page = main?.dataset.page || '';
const product = main?.dataset.product || '';

const MODULES = {
  auth: ['signup', 'signin', 'forgot', 'reset', 'welcome'],
  dj: ['dashboard', 'sets', 'set-edit', 'library', 'crates', 'insights', 'golive', 'connections', 'following'],
  social: ['nights', 'plan', 'night', 'door'],
  public: ['live', 'set', 'profile', 'explore', 'invite', 'upgrade'],
  account: ['notifications', 'settings', 'home'],
};
const moduleFor = (p) => Object.keys(MODULES).find((m) => MODULES[m].includes(p));

// Signed-in visitors carry the vz_product hint cookie. Mark the page right away so the
// sample content signed-out visitors see ([data-demo]) never shows, or downloads its photos,
// before /api/me answers. If the session turns out to be gone, the sample comes back.
const root = document.documentElement;
if (/(?:^|;\s*)vz_product=(dj|social)/.test(document.cookie)) root.dataset.signedIn = '1';
mePromise.then(() => { if (!S.me) delete root.dataset.signedIn; });

paintChrome(page);

const flash = store.get('vybez-flash');
if (flash) { store.del('vybez-flash'); setTimeout(() => toast(flash), 200); }

// Arrived here from the other product's page (redirected at the edge by vercel.json using the
// vz_product cookie, or by the fallback below): say why, then tidy the URL.
const params = new URLSearchParams(location.search);
const from = params.get('from');
if (from === 'dj' || from === 'social') {
  const here = from === 'dj' ? 'social' : 'dj';
  setTimeout(() => toast(`That page is part of ${PRODUCT_NAME[from]}. You’re signed in to ${PRODUCT_NAME[here]}.`), 200);
  params.delete('from');
  history.replaceState(history.state, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
}

async function run() {
  // Fetch the page's module while /api/me is in flight, not after it (the build also
  // modulepreloads it), so the two network waits overlap instead of adding up.
  const mod = moduleFor(page);
  const modPromise = mod ? import(`./pages/${mod}.js`) : null;
  if (product) {
    await mePromise;
    // Fallback for when the edge redirect didn't run (no product cookie yet, or a stale one).
    if (S.me && productOf(S.me) !== product) { location.replace(`${homeFor(S.me)}?from=${product}`); return false; }
  }
  if (!modPromise) return true;
  const pages = (await modPromise).default;
  await pages[page]?.();
  return true;
}

// The page is ready once its controller has rendered: tests and the perf script wait on this.
const ready = () => { root.dataset.ready = '1'; performance.mark?.('vz-ready'); };
run().then((ok) => { if (ok) ready(); }).catch((err) => {
  if (err && err.message === 'signin') return;
  console.error(err);
  toast(err?.message || 'Something went wrong. Refresh to try again.');
  ready();
});

// Mobile drawer: the DJ tab bar's "More" opens the sidebar.
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-drawer-open]');
  const close = e.target.closest('[data-drawer-close]') || (document.body.classList.contains('drawer-open') && !e.target.closest('.sidebar') && !open);
  if (open) { document.body.classList.add('drawer-open'); open.setAttribute('aria-expanded', 'true'); document.querySelector('#app-drawer a')?.focus(); }
  else if (close) { document.body.classList.remove('drawer-open'); document.querySelector('[data-drawer-open]')?.setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) { document.body.classList.remove('drawer-open'); document.querySelector('[data-drawer-open]')?.focus(); } });
