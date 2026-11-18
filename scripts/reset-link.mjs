// Make a one-hour password reset link by hand, for when email isn't switched on yet.
//   vercel env pull .env.production --environment=production   (once, gets the database keys)
//   node --env-file=.env.production scripts/reset-link.mjs someone@example.com
// Send the printed link to that person yourself (for example on WhatsApp). Don't commit .env files.
import { store } from '../server/store.js';
import { randomId } from '../server/auth.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: node --env-file=.env.production scripts/reset-link.mjs <email>'); process.exit(1); }
if (store.kind !== 'redis') { console.error('Not connected to the live database. Pull the env file first (see the top of this script).'); process.exit(1); }
const id = await store.cmd('GET', `email:${email}`);
if (!id) { console.error(`No Vybez account uses ${email}.`); process.exit(1); }
const token = randomId(24);
await store.cmd('SET', `reset:${token}`, id, 'EX', 3600);
const site = (process.env.SITE_URL || 'https://vybez-ecru.vercel.app').replace(/\/$/, '');
console.log(`${site}/reset?token=${token}\n(works for 1 hour, once)`);
