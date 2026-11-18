// Playlist import. Runs in the browser; files are never uploaded.
import { $$ } from './util.js';


export function parseCsvRows(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
export function splitArtistTitle(line) {
  const s = line.replace(/^\s*(\d+[.)]?\s*)?(\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*)?[-–.]?\s*/, '').trim();
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { a: m[1].trim(), t: m[2].trim() } : { a: '', t: s };
}
export function parsePlaylist(name, text) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const xml = (src) => new DOMParser().parseFromString(src, 'application/xml');
  if (ext === 'xml' || /<DJ_PLAYLISTS/i.test(text)) {
    const doc = xml(text);
    const byId = {};
    const coll = $$('COLLECTION > TRACK', doc).map((t) => {
      const tr = { a: t.getAttribute('Artist') || '', t: t.getAttribute('Name') || '', bpm: Math.round(parseFloat(t.getAttribute('AverageBpm'))) || undefined, key: t.getAttribute('Tonality') || undefined };
      byId[t.getAttribute('TrackID')] = tr; return tr;
    });
    const lists = $$('PLAYLISTS NODE[Type="1"]', doc).filter((n) => n.querySelector('TRACK'));
    if (lists.length) {
      const pl = lists[0];
      return { title: pl.getAttribute('Name'), tracks: $$('TRACK', pl).map((t) => byId[t.getAttribute('Key')]).filter(Boolean) };
    }
    return { tracks: coll };
  }
  if (ext === 'nml' || /<NML/i.test(text)) {
    const doc = xml(text);
    const byKey = {};
    const coll = $$('COLLECTION > ENTRY', doc).map((en) => {
      const loc = en.querySelector('LOCATION');
      const tr = { a: en.getAttribute('ARTIST') || '', t: en.getAttribute('TITLE') || '', bpm: Math.round(parseFloat(en.querySelector('TEMPO')?.getAttribute('BPM'))) || undefined };
      if (loc) byKey[`${loc.getAttribute('VOLUME') || ''}${loc.getAttribute('DIR') || ''}${loc.getAttribute('FILE') || ''}`] = tr;
      return tr;
    });
    const pl = $$('PLAYLISTS NODE[TYPE="PLAYLIST"]', doc).find((n) => n.querySelector('PRIMARYKEY'));
    if (pl) {
      const tracks = $$('PRIMARYKEY', pl).map((k) => byKey[k.getAttribute('KEY')]).filter(Boolean);
      if (tracks.length) return { title: pl.getAttribute('NAME'), tracks };
    }
    return { tracks: coll };
  }
  if (ext === 'm3u' || ext === 'm3u8' || /^#EXTM3U/.test(text)) {
    const out = []; let info = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) { info = line.replace(/^#EXTINF:[^,]*,/, ''); continue; }
      if (line.startsWith('#')) continue;
      const base = info || decodeURIComponent(line.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, ''));
      out.push(splitArtistTitle(base)); info = null;
    }
    return { tracks: out };
  }
  if (ext === 'csv') {
    const rows = parseCsvRows(text);
    const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const ti = col('name', 'title', 'track', 'track title', 'song');
    const ai = col('artist', 'artists');
    if (ti >= 0) {
      const bi = col('bpm'); const ki = col('key');
      const tracks = rows.slice(1).map((r) => ({ a: (r[ai] || '').trim(), t: (r[ti] || '').trim(), bpm: Math.round(parseFloat(r[bi])) || undefined, key: (r[ki] || '').trim() || undefined }))
        .filter((t, i) => (t.a || t.t) && !(i === 0 && !t.a && rows.length > 2)); // Serato puts the session name in row 1
      return { tracks };
    }
  }
  return { tracks: text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitArtistTitle).filter((t) => t.a || t.t) };
}
export async function readPlaylistFile(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB. Export a single playlist instead of your whole collection.');
  const text = await file.text();
  const res = parsePlaylist(file.name, text);
  res.tracks = res.tracks.filter((t) => t.a || t.t).slice(0, 400);
  if (!res.tracks.length) throw new Error('We couldn’t find any tracks in that file. Check it’s a rekordbox XML, Serato CSV, M3U, NML or text list.');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  res.source = { xml: 'rekordbox XML', csv: 'Serato CSV', m3u: 'M3U playlist', m3u8: 'M3U playlist', nml: 'TRAKTOR NML', txt: 'Text list' }[ext] || 'File import';
  res.fallbackTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return res;
}
