// Moves photos that are still kept in the database (base64) into Vercel Blob, then frees the
// space in Upstash. Safe to run more than once, and the site keeps working while it runs:
// every photo is read from Blob first and from the database as a fallback (server/files.js).
//
//   vercel env pull .env.production --environment=production   (gets the database and Blob keys)
//   node --env-file=.env.production scripts/move-photos-to-blob.mjs           (dry run: only counts)
//   node --env-file=.env.production scripts/move-photos-to-blob.mjs --apply   (moves them)
//
// Don't commit .env files.
import { store } from '../server/store.js';
import { files, blobOn, coverPath, momentPath } from '../server/files.js';

const apply = process.argv.includes('--apply');
const URL_ = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
if (store.kind !== 'redis') { console.error('Not connected to the live database. Pull the env file first (see the top of this script).'); process.exit(1); }
if (!blobOn()) { console.error('BLOB_READ_WRITE_TOKEN is missing. Connect a Blob store to the project in Vercel, then pull the env file again.'); process.exit(1); }

// SCAN goes straight to Upstash (with the same key prefix the app uses, if any).
async function scan(pattern) {
  const keys = []; let cursor = '0';
  do {
    const res = await fetch(`${URL_}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(['SCAN', cursor, 'MATCH', `${store.prefix}${pattern}`, 'COUNT', '500']) });
    const { result } = await res.json();
    cursor = result[0];
    keys.push(...result[1].map((k) => k.slice(store.prefix.length)));
  } while (cursor !== '0');
  return keys;
}

const jobs = [];
for (const key of await scan('photo:*')) {
  const id = key.slice('photo:'.length);
  const night = await store.getJSON(`night:${id}`);
  jobs.push({ key, path: night?.photo ? coverPath(id, night.photo) : null, what: `cover of night ${id}` });
}
for (const key of await scan('moment:*')) {
  const [, nid, mid] = key.split(':');
  jobs.push({ key, path: nid && mid ? momentPath(nid, mid) : null, what: `moment ${mid} of night ${nid}` });
}
for (const key of await scan('file:*')) jobs.push({ key, path: key.slice('file:'.length), what: key.slice('file:'.length) });

const orphans = jobs.filter((j) => !j.path);
const moves = jobs.filter((j) => j.path);
console.log(`${moves.length} photo(s) to move to Blob, ${orphans.length} leftover photo(s) whose night is gone.`);
if (!apply) { console.log('Dry run. Add --apply to move them.'); process.exit(0); }

let moved = 0;
for (const j of moves) {
  const b64 = await store.cmd('GET', j.key);
  if (!b64) continue;
  const buf = Buffer.from(b64, 'base64');
  await files.put(j.path, buf);
  const check = await files.get(j.path);
  if (!check || check.length !== buf.length) { console.error(`Couldn't confirm ${j.what}; left it in the database.`); continue; }
  await store.cmd('DEL', j.key);
  moved++;
  console.log(`moved ${j.what}`);
}
for (const j of orphans) { await store.cmd('DEL', j.key); console.log(`removed leftover ${j.key}`); }
console.log(`Done: ${moved} moved, ${orphans.length} leftovers removed.`);
