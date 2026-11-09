// Vybez app entry. Loaded as an ES module on every page after site.js and icons.js.
//   core/     helpers, API client, session, playlist parser, shared renderers
//   pages/    one module per area; only the module the current page needs is downloaded
// Each page's <main> carries data-page (its controller) and, for signed-in areas,
// data-product ('dj' or 'social'). A signed-in account that opens the other product's
// page is sent to its own home, so DJ accounts only see DJ pages and Social accounts
// only see Social pages.
import { $, store, toast } from './core/util.js';
import { S, mePromise, paintChrome, productOf, homeFor } from './core/session.js';

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

paintChrome(page);

const flash = store.get('vybez-flash');
if (flash) { store.del('vybez-flash'); setTimeout(() => toast(flash), 200); }

async function run() {
  if (product) {
    await mePromise;
    if (S.me && productOf(S.me) !== product) { location.replace(homeFor(S.me)); return; }
  }
  const mod = moduleFor(page);
  if (!mod) return;
  const pages = (await import(`./pages/${mod}.js`)).default;
  await pages[page]?.();
}

run().catch((err) => {
  if (err && err.message === 'signin') return;
  console.error(err);
  toast(err?.message || 'Something went wrong. Refresh to try again.');
});

// Mobile drawer: the DJ tab bar's "More" opens the sidebar.
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-drawer-open]');
  const close = e.target.closest('[data-drawer-close]') || (document.body.classList.contains('drawer-open') && !e.target.closest('.sidebar') && !open);
  if (open) { document.body.classList.add('drawer-open'); open.setAttribute('aria-expanded', 'true'); document.querySelector('#app-drawer a')?.focus(); }
  else if (close) { document.body.classList.remove('drawer-open'); document.querySelector('[data-drawer-open]')?.setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) { document.body.classList.remove('drawer-open'); document.querySelector('[data-drawer-open]')?.focus(); } });
