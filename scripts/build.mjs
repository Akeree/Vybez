// Static site build for Vybez. No dependencies: reads src/, writes dist/.
// Pages live in src/pages/**.html and start with a meta comment:
//   <!--meta {"title":"Explore","layout":"site","nav":"explore"}-->
// Helpers inside pages and partials:
//   {{icon:name}} or {{icon:name:20}}   Lucide icon, inline SVG
//   {{brand:name}} or {{brand:name:24}} Brand mark (Simple Icons), inline SVG
//   {{svg:file}}                        Any SVG from src/logos, inline
//   {{lockup}} {{lockup:dj}} {{lockup:social}}
//   {{> partial}}                       Include src/partials/partial.html
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
// Vercel sets VERCEL_PROJECT_PRODUCTION_URL during builds; SITE_URL overrides it for a custom domain.
const SITE = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://vybez.vercel.app')).replace(/\/$/, '');

const read = (p) => readFileSync(p, 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// Brand colours for Simple Icons marks. White where the brand colour would vanish on dark.
const BRAND_COLOURS = {
  spotify: '#1ED760', applemusic: '#FA243C', soundcloud: '#FF5500', mixcloud: '#FFFFFF',
  tidal: '#FFFFFF', youtube: '#FF0000', beatport: '#01FF95', whatsapp: '#25D366',
  googlechrome: '#FFFFFF', apple: '#FFFFFF', google: '#FFFFFF', instagram: '#E4405F',
};

function icon(name, size = 20) {
  const file = join(src, 'icons', `${name}.svg`);
  if (!existsSync(file)) throw new Error(`Unknown icon: ${name}`);
  const body = read(file).replace(/<!--[\s\S]*?-->/g, '').match(/<svg[\s\S]*?>([\s\S]*)<\/svg>/)[1]
    .replace(/\s+/g, ' ').trim();
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

function brand(name, size = 24) {
  const logo = join(src, 'logos', `m-${name}.svg`);
  if (existsSync(logo)) return svgFile(`m-${name}`, size, size);
  const file = join(src, 'brands', `${name}.svg`);
  if (!existsSync(file)) throw new Error(`Unknown brand: ${name}`);
  const path = read(file).match(/<path d="([^"]+)"/)[1];
  return `<svg class="b" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="${BRAND_COLOURS[name] || '#fff'}" d="${path}"/></svg>`;
}

function svgFile(name, w, h) {
  let s = read(join(src, 'logos', `${name}.svg`)).trim();
  s = s.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
  if (w) s = s.replace(/width="[^"]+"/, `width="${w}"`).replace(/height="[^"]+"/, `height="${h || w}"`);
  return s;
}

function lockup(product) {
  const word = product ? `<span class="lockup-sub">${product}</span>` : '';
  return `<span class="lockup">${svgFile('mark', 30, 26)}<span class="lockup-words"><span class="lockup-v">vybez</span>${word}</span></span>`;
}

// Photos: name -> [width, height] of the full file; '-sm' files are half size.
const PHOTOS = {
  rooftop: [1264, 848], dinner: [1264, 848], crowd: [1264, 848], beach: [1264, 848], living: [1264, 848],
  owambe: [848, 1264], kemi: [928, 1152], hands: [1024, 1024], bucket: [1024, 1024],
};
// {{photo:name}} lazy, {{photo:name:eager}} for above-the-fold. Alt is empty: the photos are
// illustrative placeholders and the surrounding text carries the meaning.
function photo(name, mode, sizes = '(max-width: 720px) 100vw, 50vw') {
  const d = PHOTOS[name];
  if (!d) throw new Error(`Unknown photo: ${name}`);
  const [w, h] = d;
  const load = mode === 'eager' ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<img src="/img/${name}.webp" srcset="/img/${name}-sm.webp ${w / 2}w, /img/${name}.webp ${w}w" sizes="${sizes}" width="${w}" height="${h}" alt="" decoding="async" ${load}>`;
}

// {{#if:dj}}...{{/if}} keeps its contents only on pages whose meta product is 'dj'
// (the 'app' layout implies dj, the 'social' layout implies social).
function render(html, vars = {}, depth = 0) {
  if (depth > 8) throw new Error('Partial nesting too deep');
  return html
    .replace(/\{\{#if:(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, p, inner) => (vars.product === p ? inner : ''))
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, p) => render(read(join(src, 'partials', `${p}.html`)), vars, depth + 1))
    .replace(/\{\{icon:([\w-]+)(?::(\d+))?\}\}/g, (_, n, s) => icon(n, s ? +s : 20))
    .replace(/\{\{brand:([\w-]+)(?::(\d+))?\}\}/g, (_, n, s) => brand(n, s ? +s : 24))
    .replace(/\{\{svg:([\w-]+)(?::(\d+))?\}\}/g, (_, n, s) => svgFile(n, s ? +s : undefined))
    .replace(/\{\{photo:([\w-]+)(?::(eager|small))?\}\}/g, (_, n, m) => photo(n, m, m === 'small' ? '(max-width: 720px) 50vw, 25vw' : undefined))
    .replace(/\{\{lockup(?::(\w+))?\}\}/g, (_, p) => lockup(p))
    .replace(/\{\{var:(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['img', 'fonts', 'css', 'js']) cpSync(join(src, dir), join(out, dir), { recursive: true });
cpSync(join(src, 'logos', 'mark.svg'), join(out, 'favicon.svg'));

const pages = walk(join(src, 'pages')).filter((p) => p.endsWith('.html'));
const urls = [];
for (const file of pages) {
  const raw = read(file);
  const m = raw.match(/^<!--meta\s+(\{[\s\S]*?\})\s*-->\n?/);
  if (!m) throw new Error(`Missing meta in ${file}`);
  const meta = JSON.parse(m[1]);
  const rel = relative(join(src, 'pages'), file).replace(/\\/g, '/');
  const route = '/' + rel.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '');
  const layout = meta.layout || 'site';
  meta.product = meta.product || { app: 'dj', social: 'social' }[meta.layout] || '';
  const body = render(raw.slice(m[0].length), meta);
  const shell = read(join(src, 'layouts', `${layout}.html`));
  const title = meta.title ? `${meta.title} · Vybez` : 'Vybez · Make the night more exciting';
  let html = render(shell, {
    ...meta,
    title: escapeAttr(title),
    description: escapeAttr(meta.description || 'Follow the DJs you love, or throw a small night for the people you love. Vybez runs in your browser, no app to download.'),
    canonical: SITE + (route === '/' ? '/' : route),
    site: SITE,
    content: '@@CONTENT@@',
    robots: meta.noindex ? 'noindex' : 'index,follow',
  }).replace('@@CONTENT@@', body);
  // Mark the current navigation item.
  if (meta.nav) html = html.replace(new RegExp(`data-nav="${meta.nav}"`, 'g'), `data-nav="${meta.nav}" aria-current="page"`);
  if (meta.app) html = html.replace(new RegExp(`data-app="${meta.app}"`, 'g'), `data-app="${meta.app}" aria-current="page"`);
  if (/\{\{|\}\}/.test(html)) throw new Error(`Unrendered template tag in ${file}`);
  const dest = join(out, rel === '404.html' ? '404.html' : rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  if (!meta.noindex) urls.push(SITE + (route === '/' ? '/' : route));
}

// Icons for client-side rendering (src/js/app.js): window.VZ_ICONS[name] -> inner SVG markup.
const iconMap = Object.fromEntries(readdirSync(join(src, 'icons')).filter((f) => f.endsWith('.svg')).map((f) => {
  const name = f.replace(/\.svg$/, '');
  return [name, icon(name).match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]];
}));
// Brand marks the client renders (profile links): window.VZ_BRANDS[name] -> full SVG markup.
const brandMap = Object.fromEntries(['mixcloud', 'soundcloud', 'instagram', 'youtube'].map((n) => [n, brand(n, 16)]));
writeFileSync(join(out, 'js', 'icons.js'), `window.VZ_ICONS=${JSON.stringify(iconMap)};\nwindow.VZ_BRANDS=${JSON.stringify(brandMap)};\n`);

writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Built ${pages.length} pages into dist/`);
