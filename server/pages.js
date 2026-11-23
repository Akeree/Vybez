// Server-rendered link previews. When an invite link (/i/:code) is pasted into WhatsApp,
// iMessage or Instagram, their crawlers don't run JavaScript, so the static page would only
// ever show "You're invited · Vybez". This fills the page's title and Open Graph tags with the
// night's name, date, area and cover photo. The address is never included: it stays locked
// until the host lets a guest in.
import { store } from './store.js';
import { getUser } from './domain/users.js';
import { coverOf, photoUrl } from './domain/nights.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let template = null;
async function inviteTemplate() {
  if (template === null) {
    // Written by scripts/build.mjs from dist/v/invite.html (absent before the first build).
    try { template = (await import('./generated/invite-page.js')).default; } catch { template = ''; }
  }
  return template;
}

// "Sat 6 Dec, 8:00 pm" from "2026-12-06T20:00" (the host's local time, as typed).
export function whenText(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const h = +m[4];
  return `${day}, ${h % 12 || 12}:${m[5]} ${h < 12 ? 'am' : 'pm'}`;
}

export function fillInvite(html, night, host, origin) {
  const title = `${night.title} · You’re invited`;
  const bits = [whenText(night.when), night.area].filter(Boolean).join(' · ');
  const desc = night.status === 'cancelled'
    ? `${host?.name || 'The host'} cancelled this night.`
    : `${host?.name || 'Your host'} invited you${bits ? `: ${bits}` : ''}. RSVP on Vybez Social, no app needed.`;
  const cover = coverOf(night);
  const image = cover === 'photo' ? `${origin}${photoUrl(night)}` : `${origin}/img/${cover === 'rings' ? 'og' : `og-${cover}`}.jpg`;
  const url = `${origin}/i/${night.code}`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta (?:name|property)="(?:description|og:description)" content=")[^"]*"/g, `$1${esc(desc)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(title)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${esc(url)}"`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${esc(url)}"`)
    .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(image)}"`);
}

// Serves a host's cover photo. The version in the URL changes with every upload, so browsers,
// WhatsApp and the CDN can keep it for a year.
export async function photoResponse(id, version) {
  let b64 = null;
  try {
    const night = await store.getJSON(`night:${id}`);
    if (night?.photo === version) b64 = await store.cmd('GET', `photo:${id}`);
  } catch { /* treat as missing */ }
  if (!b64) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=60' } });
  const buf = Buffer.from(b64, 'base64');
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function invitePage(code, origin) {
  const html = await inviteTemplate();
  if (!html) return null;
  let out = html;
  try {
    const id = await store.cmd('GET', `code:${String(code).toLowerCase()}`);
    const night = id && await store.getJSON(`night:${id}`);
    if (night) out = fillInvite(html, night, await getUser(night.host), origin);
  } catch { /* fall back to the plain page; the browser loads the invite itself */ }
  return new Response(out, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  });
}
