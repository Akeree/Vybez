# Security

## Reporting a problem

Email the address on [/help#security](https://vybez-ecru.vercel.app/help#security) (also in `/.well-known/security.txt`). Please give us a chance to fix it before sharing details publicly. We won't take action against good-faith research that avoids other people's data and doesn't disrupt the service.

## What protects Vybez today

| Area | Control | Where |
|---|---|---|
| Passwords | scrypt (N=16384, r=8, p=1), 16-byte salt, constant-time compare; 8 to 200 characters | `server/auth.js`, `server/routes/auth.js` |
| Sessions | HMAC-SHA256 signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure`, 30 days; session version bumps on password change | `server/auth.js`, `server/domain/users.js` |
| CSRF | Non-GET API calls must be JSON and, when an `Origin` is sent, same-origin; a malformed `Origin` is refused | `server/api.js` |
| Rate limits | Sign-up 10/h per IP; sign-in 10 per 15 min per IP+email and 50 per 15 min per IP; forgot 5 per 15 min; reset 10 per 15 min; RSVP 20/h; nights 20/h; photos 30/h | `server/lib/http.js` callers |
| Input | Every field validated and length-capped; control characters stripped; one-line night fields lose line breaks; bodies capped at 300 KB (900 KB for photos) | `server/lib/http.js`, `server/domain/nights.js` |
| Photos | Only JPEG data URLs, magic bytes checked, ≤600 KB, served with `nosniff` and a versioned URL | `server/domain/nights.js`, `server/pages.js` |
| Authorisation | Hosts reach only their own nights; guests only their own RSVP (device token); the address is sent only to approved guests; Social and DJ accounts can't use each other's endpoints | `server/routes/social.js`, `server/domain/nights.js` |
| Output | All user text is escaped before it reaches HTML (`esc`), calendar files escape line breaks | `src/js/core/util.js`, `src/js/pages/public.js` |
| Redirects | `?next=` only accepts same-site paths (no `//host` or `/\host`) | `src/js/core/api.js` |
| Headers | CSP (`script-src 'self'`, `frame-ancestors 'none'`), HSTS with preload, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` | `vercel.json` |
| Secrets | Only in Vercel environment variables; `.env*` is git-ignored; no keys in client code; no source maps are published | `.gitignore`, `scripts/build.mjs` |
| Password reset | 24-byte random token, one hour, single use, link built from `SITE_URL` | `server/routes/auth.js` |

## Known gaps (accepted for early access)

- **Sign out is per device.** Sessions are stateless; "sign out everywhere" happens when the password changes. Add a "sign out of all devices" button that bumps the session version.
- **Sign-in timing.** A sign-in for an email with no account returns slightly faster than a wrong password. Sign-up already tells you an email is taken, so this leaks nothing new.
- **Invite codes are guessable in theory.** A code is the host's first name, the night title and 4 random characters (about 920,000 combinations). Someone guessing could see the title, date and area, never the address. Add per-IP limits on `GET /api/invites/:code` if abuse shows up.
- **Shared database.** Preview and Production use the same Upstash database, so a preview build can touch real data. Separate them before launch.
- **Reset links without `SITE_URL`.** The link falls back to the request host. Set `SITE_URL` in Production.
- **No dependency risk** (there are none), but also **no automated security scanning** in CI. Turn on GitHub secret scanning and Dependabot alerts in the repository settings.

## Breach response

If personal data may have leaked: contain it (rotate `SESSION_SECRET`, `KV_REST_API_TOKEN`, `RESEND_API_KEY`), work out what and who, then notify the Nigeria Data Protection Commission within 72 hours and the affected people without delay (Nigeria Data Protection Act 2023). Steps are in [OPERATIONS.md](OPERATIONS.md#incident-and-breach-response).
