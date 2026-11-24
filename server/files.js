// Photo storage: hosts' cover photos and guests' moments.
//  - Vercel Blob (private store) when BLOB_READ_WRITE_TOKEN is set. Vercel adds it when a
//    Blob store is connected to the project (Storage → Create → Blob, access: Private).
//  - Otherwise the photo goes into the key-value store as base64 under file:<path>, which is
//    how every photo was kept before Blob. Fine for a few hundred photos, not for thousands.
// Reads check Blob first, then file:<path>, then the pre-Blob key the caller names (legacy),
// so nothing breaks while old photos are moved over (scripts/move-photos-to-blob.mjs).
// Photos are always served through the API (server/pages.js, server/domain/group.js), never by
// their Blob URL, so the same access rules apply wherever they're kept.
// No dependencies: the Blob REST API is called with fetch, the same calls @vercel/blob makes.
import { store, KEY_PREFIX } from './store.js';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const API = (process.env.VERCEL_BLOB_API_URL || 'https://vercel.com/api/blob').replace(/\/$/, '');
const STORE_ID = TOKEN.split('_')[3] || '';
const BLOB_HOST = process.env.VYBEZ_BLOB_HOST || `https://${STORE_ID}.private.blob.vercel-storage.com`;
// Preview deployments write under preview/ so they never overwrite a live photo.
const PREFIX = KEY_PREFIX.replace(/:/g, '/');
const API_VERSION = '13';

export const blobOn = () => !!(TOKEN && STORE_ID);
const pathname = (path) => `${PREFIX}${path}`;
const kvKey = (path) => `file:${path}`;

async function blobApi(sub, init) {
  const res = await fetch(`${API}${sub}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'x-api-version': API_VERSION, 'x-vercel-blob-store-id': STORE_ID, ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Blob ${init.method} failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res;
}

export const files = {
  kind: () => (blobOn() ? 'blob' : store.kind),

  // Saves a JPEG at a path like cover/<night>/<version>.jpg or moment/<night>/<id>.jpg.
  async put(path, buf, contentType = 'image/jpeg') {
    if (!blobOn()) return store.cmd('SET', kvKey(path), buf.toString('base64'));
    await blobApi(`/?${new URLSearchParams({ pathname: pathname(path) })}`, {
      method: 'PUT',
      body: buf,
      headers: {
        'x-vercel-blob-access': 'private', 'x-add-random-suffix': '0', 'x-allow-overwrite': '1',
        'x-content-type': contentType, 'x-cache-control-max-age': '31536000', 'x-content-length': String(buf.length),
      },
    });
  },

  // The photo's bytes, or null. legacyKey: where the photo lived before (base64 in the store).
  async get(path, legacyKey) {
    if (blobOn()) {
      try {
        const res = await fetch(`${BLOB_HOST}/${pathname(path)}`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(15000) });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        if (res.status !== 404) console.error(`Blob GET ${path}: ${res.status}`);
      } catch (err) { console.error(err); }
    }
    const [kv, old] = await store.pipe([['GET', kvKey(path)], ['GET', legacyKey || kvKey(path)]]);
    const b64 = kv || old;
    return b64 ? Buffer.from(b64, 'base64') : null;
  },

  // Removes photos wherever they are. Never throws: a leftover file is better than a failed delete.
  async del(paths, legacyKeys = []) {
    const keys = [...paths.map(kvKey), ...legacyKeys];
    try { if (keys.length) await store.cmd('DEL', ...keys); } catch (err) { console.error(err); }
    if (!blobOn() || !paths.length) return;
    try {
      await blobApi('/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: paths.map((p) => `${BLOB_HOST}/${pathname(p)}`) }),
      });
    } catch (err) { console.error(err); }
  },
};

export const coverPath = (nightId, version) => `cover/${nightId}/${version}.jpg`;
export const momentPath = (nightId, momentId) => `moment/${nightId}/${momentId}.jpg`;
