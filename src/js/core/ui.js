// Shared renderers used by more than one product.
import { I, ago, esc, fmtWhen, initials, lagos, listenLinks, num, plural, store, toast } from './util.js';
import { api } from './api.js';
import { readPlaylistFile } from './playlist.js';

export const visLabel = { public: 'Everyone', followers: 'Followers only', unlisted: 'Link only', private: 'Only me' };
export const statusChip = (s) => (s.status === 'published' ? '<span class="chip dot success">Published</span>' : '<span class="chip dot warning">Draft</span>');
export const emptyState = (icon, title, text, action = '') => `<div class="state"><span class="tile">${I(icon)}</span><h3 class="h4">${esc(title)}</h3><p class="small t2">${text}</p>${action}</div>`;
export const tracklistItems = (tracks, nowIdx = -1) => tracks.map((t, i) => `<li class="track${i === nowIdx ? ' now' : ''}"><span class="num mono t3">${i + 1}</span><span class="cover-slot">${I('music', 18)}</span><span class="stack" style="min-width:0"><span class="label ellipsis">${esc(t.t || 'Untitled')}</span><span class="caption t3 ellipsis">${esc(t.a || 'Unknown artist')}${t.bpm ? ` · ${t.bpm} BPM` : ''}${t.key ? ` · ${esc(t.key)}` : ''}</span></span><span class="mono t2 played">${esc(t.at || '')}</span>${listenLinks(t)}</li>`).join('');
export const EMOJI = ['🔥', '🙌', '💃', '❤️', '🤯'];
export const EMOJI_LABEL = { '🔥': 'Fire', '🙌': 'Raised hands', '💃': 'Dancing', '❤️': 'Love', '🤯': 'Mind blown' };
export const feedItem = (c) => `<li class="${c.kind === 'request' ? 'request' : ''}${c.dj ? ' dj' : ''}"><span class="avatar">${esc(initials(c.name))}</span><p><strong>${esc(c.name)}</strong>${c.dj ? ' <span class="chip accent" style="height:20px">DJ</span>' : ''}${c.kind === 'request' ? ' <span class="chip accent" style="height:20px">Request</span>' : ''} <span class="t2">${esc(c.text)}</span> <span class="caption t3">${ago(c.at)}</span></p></li>`;

export async function createSetFromFile(file) {
  const res = await readPlaylistFile(file);
  const { set } = await api('POST', 'sets', { title: (res.title || res.fallbackTitle || 'Imported set').slice(0, 90), source: res.source, tracks: res.tracks });
  store.set('vybez-flash', `Imported ${plural(set.tracks.length, 'track')}. Check them, then publish.`);
  location.href = `/dj/sets/${set.id}`;
}

export function bindImport(zone, input, handler) {
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

export const ACT_ICON = { follow: 'user-plus', rsvp: 'ticket', comment: 'message-square-quote', save: 'bookmark', live: 'radio' };
export const activityRow = (a) => `<a class="activity-row" href="${esc(a.link || '#')}"><span class="tile">${I(ACT_ICON[a.type] || 'bell', 16)}</span><span class="grow">${esc(a.text)}<br><span class="caption t3">${ago(a.at)}</span></span></a>`;

export const nightRow = (n) => {
  const d = lagos(n.when);
  const past = d < Date.now();
  return `<div class="card night-row"><span class="date-tile"><span class="overline">${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Africa/Lagos' })}</span><span class="h3">${d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' })}</span></span><div class="stack grow gap-2"><a class="h4" href="/social/${n.id}">${esc(n.title)}</a><span class="caption t3">${esc(fmtWhen(n.when))} · ${esc(n.area)}</span></div><span class="row gap-8 wrap-row">${n.status === 'cancelled' ? '<span class="chip danger">Cancelled</span>' : past ? '<span class="chip">Past</span>' : ''}<span class="chip success">${n.going} of ${n.cap} going</span>${n.asking ? `<span class="chip warning">${n.asking} asking</span>` : ''}</span><a class="btn btn-outline btn-sm" href="/social/${n.id}">Manage</a></div>`;
};

