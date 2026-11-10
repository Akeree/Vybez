// Load-time check on a simulated phone: slow 4G (150 ms round trips, 1.6 Mbps) and a 4x slower CPU.
//   node scripts/perf-mobile.mjs                 measures this checkout
//   VYBEZ_ROOT=/path/to/other/checkout node ...  measures another checkout (before/after)
// The dev server runs with PROD_LIKE=1 (Vercel's cache headers and gzip), so repeat visits
// use the browser cache as they do on the live site.
// Starts that checkout's dev server with an in-memory store and reports medians of RUNS runs:
//   cold   first visit to a signed-in home (empty cache): first paint, and when its data has loaded
//   warm   moving to another page of the same product (cached files)
//   cross  a Social account opening a DJ link: time to its own home, and whether the DJ shell flashed
//   switch changing product in Settings: tap to the new home with its data loaded
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = process.env.VYBEZ_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3125);
const BASE = `http://localhost:${PORT}`;
const RUNS = Number(process.env.RUNS || 5);

const server = spawn(process.execPath, [join(root, 'scripts/dev.mjs')], { cwd: root, env: { ...process.env, PORT: String(PORT), VYBEZ_STORE: 'memory', PROD_LIKE: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise((ok) => server.stdout.on('data', (d) => { if (String(d).includes('dev server')) ok(); }));
const browser = await chromium.launch();

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { ctx, page };
}
let n = 0;
async function account(ctx, product) {
  n++;
  const r = await ctx.request.post(`${BASE}/api/auth/signup`, { data: { name: `Perf ${n}`, email: `perf${n}-${Date.now()}@test.dev`, password: 'longenough1', product } });
  if (!r.ok()) throw new Error(`signup ${r.status()}`);
  await ctx.request.patch(`${BASE}/api/me`, { data: { onboarded: true } });
}
// Wall-clock time the current page finished loading its data (last /api response, or load).
const doneAt = (page) => page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const api = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/')).map((e) => e.responseEnd);
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0;
  return { origin: performance.timeOrigin, done: Math.max(nav.loadEventEnd, ...api), fcp, path: location.pathname };
});
const settle = (page) => page.waitForLoadState('networkidle').catch(() => {});
const median = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };

const R = { coldFcp: [], coldDone: [], warm: [], cross: [], crossFlash: [], switch: [] };
for (let i = 0; i < RUNS; i++) {
  // cold + warm: DJ account
  let { ctx, page } = await phone();
  await account(ctx, 'dj');
  await page.goto(`${BASE}/dj`); await settle(page);
  let d = await doneAt(page);
  R.coldFcp.push(d.fcp); R.coldDone.push(d.done);
  let t0 = Date.now();
  await page.click('.tabbar a[href="/dj/sets"]'); await page.waitForURL('**/dj/sets'); await settle(page);
  d = await doneAt(page); R.warm.push(d.origin + d.done - t0);
  await ctx.close();

  // cross: Social account opens a DJ link (cache warmed by a visit to its own home first)
  ({ ctx, page } = await phone());
  await account(ctx, 'social');
  await page.goto(`${BASE}/social`); await settle(page);
  const docs = [];
  page.on('response', (r) => { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) docs.push(`${new URL(r.url()).pathname} ${r.status()}`); });
  t0 = Date.now();
  await page.goto(`${BASE}/dj/sets`);
  await page.waitForURL((u) => u.pathname === '/social', { timeout: 15000 }); await settle(page);
  d = await doneAt(page); R.cross.push(d.origin + d.done - t0);
  R.crossFlash.push(docs.some((x) => x === '/dj/sets 200') ? 1 : 0);

  // switch: Social -> DJ in Settings
  await page.goto(`${BASE}/social/settings`); await settle(page);
  t0 = Date.now();
  await page.selectOption('[data-product-select]', 'dj');
  if (await page.$('[data-switch-dialog][open]')) await page.click('[data-switch-dialog] button[type=submit]');
  await page.waitForURL((u) => u.pathname === '/dj', { timeout: 15000 }); await settle(page);
  d = await doneAt(page); R.switch.push(d.origin + d.done - t0);
  await ctx.close();
}

const out = {
  'Cold home, first paint (ms)': median(R.coldFcp),
  'Cold home, data loaded (ms)': median(R.coldDone),
  'Next page, data loaded (ms)': median(R.warm),
  'Wrong-product link to own home (ms)': median(R.cross),
  'Wrong-product page shown first (runs)': `${R.crossFlash.reduce((a, b) => a + b, 0)}/${RUNS}`,
  'Settings switch to new home (ms)': median(R.switch),
};
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.kill();
