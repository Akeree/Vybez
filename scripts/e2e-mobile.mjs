// Mobile end-to-end check: runs the real site at phone width and walks both products.
//   node scripts/e2e-mobile.mjs            (needs Playwright with Chromium installed)
// Starts the dev server with an in-memory store, so nothing is written to .data/.
// Checks: DJ and Social accounts only see their own side, every flow works by tapping,
// no page scrolls sideways, no console errors, tap targets are at least 40px.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3123;
const BASE = `http://localhost:${PORT}`;
const WIDTHS = (process.env.WIDTHS || '360,390').split(',').map(Number);

let failures = 0;
const findings = [];
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; findings.push(name); console.log(`  FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
};

const server = spawn(process.execPath, [join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT), VYBEZ_STORE: 'memory' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.on('data', (d) => { if (String(d).includes('dev server')) ok(); }));

const browser = await chromium.launch();
const errors = [];
async function phone(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()} ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const settle = (page) => page.waitForLoadState('networkidle').catch(() => {});
async function go(page, path) { await page.goto(BASE + path); await settle(page); }

// Layout audit for the current page: sideways scroll, small tap targets, text cut off.
async function layoutAudit(page, label) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = document.documentElement.scrollWidth > vw + 1;
    const visible = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0; };
    const offscreen = [...document.querySelectorAll('body *')].filter((el) => visible(el) && !el.closest('.table-scroll, .app-tabs, .pills, .social-grid, [data-scroll-x], .sidebar, dialog:not([open]), .mobile-menu') && el.getBoundingClientRect().right > vw + 1).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
    const small = [...document.querySelectorAll('a[href], button, [role="button"], input:not([type=hidden]), select, [role="switch"], [role="radio"]')].filter((el) => visible(el) && getComputedStyle(el).display !== 'inline' && !el.closest('.sidebar, .mobile-menu, p, .caption, .small, li.track, .foot-links, .skip, [data-scroll-x]') && !el.matches('.link, .sr-only, label input[type=checkbox]') && !(el.matches('.switch') && el.closest('[data-tap-row]'))).filter((el) => { const b = el.getBoundingClientRect(); return b.height < 40 || b.width < 40; }).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}`);
    return { wide, offscreen, small };
  });
  check(`${label}: no sideways scroll`, !r.wide && !r.offscreen.length, r.offscreen);
  check(`${label}: tap targets 40px+`, !r.small.length, r.small);
}

const navTexts = (page) => page.$$eval('.tabbar a, .tabbar button, .sidebar a', (els) => els.map((e) => e.textContent.trim()).join('|'));

for (const W of WIDTHS) {
  console.log(`\n== ${W}px ==`);
  const tag = `${W}`;

  // ---------- Vybez DJ ----------
  const dj = await phone(W);
  let p = dj.page;
  await go(p, '/signup');
  await layoutAudit(p, `${tag} signup`);
  await p.fill('#name', `DJ Test ${W}`);
  await p.fill('#email', `dj${W}@test.dev`);
  await p.fill('#password', 'longenough1');
  await p.tap('button[type=submit]');
  await p.waitForURL('**/welcome');
  await settle(p);
  check(`${tag} DJ onboarding shows 4 steps`, (await p.$$eval('[data-steps] li', (l) => l.filter((x) => !x.hidden).length)) === 4);
  await p.tap('[data-step="1"] button[type=submit]');
  await p.waitForSelector('[data-step="2"]:not([hidden])');
  await p.tap('[data-genres] .pill >> nth=0');
  await p.tap('[data-step="2"] button[type=submit]');
  await p.waitForSelector('[data-step="3"]:not([hidden])');
  await layoutAudit(p, `${tag} welcome software step`);
  await p.tap('[data-step="3"] [data-value="rekordbox"]');
  await p.tap('[data-step="3"] button[type=submit]');
  await p.waitForSelector('[data-next-dj]:not([hidden])');
  await go(p, '/dj');
  const djNav = await navTexts(p);
  check(`${tag} DJ nav has no Social links`, !/night|Plan/i.test(djNav), djNav);
  check(`${tag} DJ bottom tab bar visible`, await p.isVisible('.tabbar'));
  await layoutAudit(p, `${tag} DJ dashboard`);
  for (const path of ['/social', '/social/new', '/social/settings', '/social/notifications']) {
    await go(p, path);
    await p.waitForURL((u) => u.pathname === '/dj', { timeout: 5000 }).catch(() => {});
    check(`${tag} DJ account sent home from ${path}`, new URL(p.url()).pathname === '/dj', p.url());
  }
  // Import a set from a file, publish it.
  const dir = mkdtempSync(join(tmpdir(), 'vz-'));
  const m3u = join(dir, 'Rooftop Sunday.m3u');
  writeFileSync(m3u, '#EXTM3U\n#EXTINF:240,Burna Boy - Last Last\nlast.mp3\n#EXTINF:200,Rema - Calm Down\ncalm.mp3\n');
  await go(p, '/dj/sets');
  await layoutAudit(p, `${tag} DJ sets`);
  await p.setInputFiles('#import-file', m3u);
  await p.waitForURL('**/dj/sets/*');
  await settle(p);
  await p.waitForSelector('[data-editor]:not([hidden])');
  check(`${tag} import parsed 2 tracks`, (await p.$$('[data-tracks] [data-i]')).length === 2);
  await layoutAudit(p, `${tag} set editor`);
  await p.tap('[data-publish]');
  await p.waitForFunction(() => document.querySelector('[data-status-chip]')?.textContent.includes('Published'));
  check(`${tag} publish`, true);
  const setUrl = await p.getAttribute('[data-view-public]', 'href');
  for (const path of ['/dj/library', '/dj/crates', '/dj/insights', '/dj/connections', '/dj/following', '/dj/notifications', '/dj/settings', '/explore', setUrl]) {
    await go(p, path);
    await layoutAudit(p, `${tag} ${path}`);
  }
  // Drawer
  await go(p, '/dj');
  await p.tap('[data-drawer-open]');
  check(`${tag} More opens the drawer`, await p.isVisible('#app-drawer'));
  await p.tap('#app-drawer [data-drawer-close]');
  check(`${tag} drawer closes`, !(await p.evaluate(() => document.body.classList.contains('drawer-open'))));
  // Go live and end
  await go(p, '/dj/live');
  await layoutAudit(p, `${tag} go live (off)`);
  await p.fill('#gl-title', 'Test room');
  await p.tap('[data-start] button[type=submit]');
  await p.waitForSelector('[data-on]:not([hidden])');
  await layoutAudit(p, `${tag} go live (on)`);
  await p.tap('[data-queue] [data-play] >> nth=0').catch(() => {});
  await p.fill('[data-now-form] [name=a]', 'Tems');
  await p.fill('[data-now-form] [name=t]', 'Free Mind');
  await p.press('[data-now-form] [name=t]', 'Enter');
  await p.waitForFunction(() => document.querySelector('[data-now-title]')?.textContent === 'Free Mind');
  check(`${tag} now playing by hand`, true);
  const handle = await p.evaluate(() => fetch('/api/me').then((r) => r.json()).then((d) => d.user.handle));
  // A signed-out fan reacts in the room
  const fan = await phone(W);
  await go(fan.page, `/live/${handle}`);
  await fan.page.waitForSelector('[data-room]:not([hidden])');
  await layoutAudit(fan.page, `${tag} public live room`);
  await fan.page.tap('[data-reacts] [data-emoji] >> nth=0');
  await fan.page.fill('[data-comment-form] [name=name]', 'Seyi');
  await fan.page.fill('[data-comment-form] [name=text]', 'Play Rush');
  await fan.page.tap('[data-comment-form] button[type=submit]');
  await fan.page.waitForSelector('[data-feed] li');
  check(`${tag} fan comment shows`, true);
  await fan.ctx.close();
  await p.tap('[data-end-open]');
  await p.tap('[data-end-dialog] button[value=end]');
  await p.waitForURL('**/dj/sets/*').catch(() => {});
  check(`${tag} end live saves a draft set`, /\/dj\/sets\//.test(p.url()), p.url());
  await dj.ctx.close();

  // ---------- Vybez Social ----------
  const host = await phone(W);
  p = host.page;
  await go(p, '/social/new');
  check(`${tag} signed-out planner asks to sign in`, (await p.textContent('[data-submit]')).includes('Sign in'));
  await p.fill('[name=title]', 'Tobi’s Birthday');
  await p.fill('[name=area]', 'Lekki');
  await p.fill('[name=place]', '12 Admiralty Way');
  await p.tap('[data-submit]');
  await p.waitForURL('**/signup**');
  await settle(p);
  check(`${tag} signup preselects Vybez Social`, (await p.getAttribute('[data-value="social"]', 'aria-checked')) === 'true');
  await p.fill('#name', `Tobi ${W}`);
  await p.fill('#email', `host${W}@test.dev`);
  await p.fill('#password', 'longenough1');
  await p.tap('button[type=submit]');
  await p.waitForURL('**/welcome**');
  await settle(p);
  check(`${tag} Social onboarding shows 2 steps`, (await p.$$eval('[data-steps] li', (l) => l.filter((x) => !x.hidden).length)) === 2);
  check(`${tag} Social onboarding hides the public link`, !(await p.isVisible('#ob-handle')));
  await p.tap('[data-step="1"] button[type=submit]');
  await p.waitForURL('**/social/new');
  await settle(p);
  check(`${tag} draft night restored after sign up`, (await p.inputValue('[name=title]')) === 'Tobi’s Birthday');
  await layoutAudit(p, `${tag} plan a night`);
  const socialNav = await navTexts(p);
  check(`${tag} Social nav has no DJ links`, !/Sets|Library|Crates|Insights|Go live|Explore|Connections/.test(socialNav), socialNav);
  await p.tap('[data-submit]');
  await p.waitForURL('**/social/*?created=1').catch(() => {});
  await p.waitForSelector('[data-content]:not([hidden])');
  await layoutAudit(p, `${tag} night manager`);
  const code = (await p.textContent('[data-link]')).split('/i/')[1];
  for (const path of ['/dj', '/dj/sets', '/dj/live', '/dj/settings', '/dj/following', '/me']) {
    await go(p, path);
    await p.waitForURL((u) => u.pathname === '/social', { timeout: 5000 }).catch(() => {});
    check(`${tag} Social account sent home from ${path}`, new URL(p.url()).pathname === '/social', p.url());
  }
  await layoutAudit(p, `${tag} your nights`);
  for (const path of ['/social/settings', '/social/notifications']) { await go(p, path); await layoutAudit(p, `${tag} ${path}`); }
  check(`${tag} Social settings have no DJ fields`, !(await p.$('#pf-handle')) && !(await p.$('[data-visibility]')));
  const hostCan = (await p.request.get(`${BASE}/api/sets`)).status();
  check(`${tag} API refuses DJ data to a Social account`, hostCan === 403);

  // Guest RSVP (no account), host approves, door check-in by pass
  const guest = await phone(W);
  await go(guest.page, `/i/${code}`);
  await guest.page.waitForSelector('[data-content]:not([hidden])');
  await layoutAudit(guest.page, `${tag} invite`);
  await guest.page.fill('[data-rsvp] [name=name]', 'Bisi');
  await guest.page.tap('[data-rsvp] button[type=submit]');
  await guest.page.waitForSelector('[data-status]:not([hidden])');
  const nightPath = await p.evaluate(() => fetch('/api/nights').then((r) => r.json()).then((d) => `/social/${d.nights[0].id}`));
  await go(p, nightPath);
  await p.waitForSelector('[data-guests] [data-status="going"]');
  await p.tap('[data-guests] [data-status="going"]');
  await p.waitForFunction(() => document.querySelector('[data-n="going"]')?.textContent === '1');
  await go(guest.page, `/i/${code}`);
  await guest.page.waitForSelector('[data-pass]:not([hidden])');
  const pass = (await guest.page.textContent('[data-pass-code]')).trim();
  check(`${tag} approved guest sees pass + address`, pass.length === 6 && await guest.page.isVisible('[data-address]'));
  await guest.page.tap('[data-song-form] [name=t]');
  await guest.page.fill('[data-song-form] [name=a]', 'Ayra Starr');
  await guest.page.fill('[data-song-form] [name=t]', 'Rush');
  await guest.page.press('[data-song-form] [name=t]', 'Enter');
  await guest.page.waitForSelector('[data-song-list] li');
  await guest.ctx.close();
  await go(p, `${nightPath}/door`);
  await layoutAudit(p, `${tag} door mode`);
  await p.fill('[data-pass-form] [name=pass]', pass.toLowerCase());
  await p.press('[data-pass-form] [name=pass]', 'Enter');
  await p.waitForSelector('[data-result].ok');
  check(`${tag} door check-in by pass`, true);
  await host.ctx.close();

  // ---------- Moving between the two products ----------
  const sw = await phone(W);
  p = sw.page;
  await p.request.post(`${BASE}/api/auth/signup`, { data: { name: `Switch ${W}`, email: `switch${W}@test.dev`, password: 'longenough1', product: 'social' } });
  await p.request.patch(`${BASE}/api/me`, { data: { onboarded: true } });
  const meCalls = [];
  p.on('request', (r) => { if (r.url().endsWith('/api/me') && r.method() === 'GET') meCalls.push(r.url()); });
  await go(p, '/social');
  check(`${tag} /api/me fetched once per page (preload is used)`, meCalls.length === 1, meCalls.length);
  check(`${tag} signed-in page is marked ready`, (await p.getAttribute('html', 'data-ready')) === '1');
  // A DJ link: the server answers with a redirect, so the DJ page never loads or flashes.
  const docs = [];
  const onDoc = (r) => { if (r.request().isNavigationRequest() && r.frame() === p.mainFrame()) docs.push(`${new URL(r.url()).pathname} ${r.status()}`); };
  p.on('response', onDoc);
  await go(p, '/dj/sets');
  p.off('response', onDoc);
  check(`${tag} DJ link redirects before any DJ page loads`, docs[0] === '/dj/sets 307' && !docs.some((d) => d.startsWith('/dj') && d.endsWith(' 200')), docs);
  check(`${tag} redirect lands on Social home with a clean URL`, new URL(p.url()).pathname === '/social' && !p.url().includes('from='), p.url());
  check(`${tag} redirect explains itself`, (await p.textContent('[data-toast-host]')).includes('That page is part of Vybez DJ'));
  // Without the hint cookie (an older session), the in-page fallback does the same job.
  await sw.ctx.clearCookies({ name: 'vz_product' });
  await go(p, '/dj/library');
  await p.waitForURL((u) => u.pathname === '/social', { timeout: 5000 }).catch(() => {});
  check(`${tag} fallback redirect also lands home`, new URL(p.url()).pathname === '/social', p.url());
  check(`${tag} /api/me restores the hint cookie`, (await sw.ctx.cookies()).some((c) => c.name === 'vz_product' && c.value === 'social'));
  // Switching product in Settings: an accessible dialog, cancel puts things back.
  await go(p, '/social/settings');
  await p.selectOption('[data-product-select]', 'dj');
  check(`${tag} switch opens a dialog`, await p.isVisible('[data-switch-dialog]') && (await p.textContent('#sw-t')).includes('Vybez DJ'));
  check(`${tag} focus moves into the dialog`, await p.evaluate(() => !!document.activeElement?.closest('[data-switch-dialog]')));
  await layoutAudit(p, `${tag} switch dialog`);
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('[data-switch-dialog]').open && document.querySelector('[data-product-select]').value === 'social', null, { timeout: 2000 }).catch(() => {});
  check(`${tag} Escape cancels and restores the choice`, !(await p.isVisible('[data-switch-dialog]')) && (await p.inputValue('[data-product-select]')) === 'social');
  await p.selectOption('[data-product-select]', 'dj');
  await p.tap('[data-switch-dialog] button[type=submit]');
  await p.waitForURL((u) => u.pathname === '/dj', { timeout: 5000 }).catch(() => {});
  await settle(p);
  check(`${tag} switch lands on DJ home`, new URL(p.url()).pathname === '/dj', p.url());
  check(`${tag} switch confirms with a message`, (await p.textContent('[data-toast-host]')).includes('Vybez DJ now'));
  check(`${tag} signed-in DJ never sees the sample dashboard`, !(await p.isVisible('[data-demo]')));
  check(`${tag} page changes cross-fade with the shell held still`, await p.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).viewTransitionName === 'vz-tabbar'));
  await sw.ctx.close();
  const calm = await browser.newContext({ viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const cp = await calm.newPage();
  await cp.goto(`${BASE}/dj`);
  check(`${tag} no page animation with reduced motion`, await cp.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).viewTransitionName === 'none'));
  await calm.close();

  // Public pages signed out
  const anon = await phone(W);
  for (const path of ['/', '/pricing', '/help', '/guides', '/signin', '/explore', '/kemi', '/i/tobi-30', '/upgrade', '/forgot']) { await go(anon.page, path); await layoutAudit(anon.page, `${tag} ${path}`); }
  await go(anon.page, '/');
  check(`${tag} home quotes slide (5 quotes, all marked illustrative)`, (await anon.page.$$eval('[data-carousel] [data-slide]', (l) => l.filter((x) => /illustrative quote/.test(x.textContent)).length)) === 5);
  await anon.page.tap('[data-go="2"]');
  await anon.page.waitForFunction(() => document.querySelector('[data-go="2"]').getAttribute('aria-current') === 'true' && document.querySelector('[data-track]').scrollLeft > 0);
  check(`${tag} tapping a dot shows that quote and stops auto-play`, (await anon.page.getAttribute('[data-play]', 'aria-label')) === 'Play the quotes');
  await anon.ctx.close();
}

// Chrome logs this when a test navigates again while a page cross-fade is still running.
// A person can't trigger it in a way that matters (the new page simply shows), so it's ignored.
const real = errors.filter((e) => !e.includes('ViewTransition opt-in disabled'));
check('no console errors', !real.length, real.slice(0, 6));
await browser.close();
server.kill();
console.log(failures ? `\n${failures} failed:\n- ${findings.join('\n- ')}` : '\nAll mobile checks passed');
process.exit(failures ? 1 : 0);
