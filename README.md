# Vybez website

Vybez: **Vybez DJ** (sets, tracklists, live rooms) and **Vybez Social** (small invite-only nights). Static pages plus one Vercel Function for the API. No runtime dependencies.

```
npm run dev     # build + local server with the API on http://localhost:3000 (data in .data/db.json)
npm test        # end-to-end API checks (in-memory store)
npm run test:mobile  # phone-width run of both products in Chromium (needs Playwright)
npm run perf    # load times on a simulated slow-4G phone; VYBEZ_ROOT=<other checkout> to compare
npm run build   # src/ -> dist/
```

## Going live on Vercel (one step)
Accounts and data need storage. In the Vercel project: **Storage → Connect a store → Upstash for Redis** (free tier is fine) and connect it to the project, then redeploy. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`; the API picks them up. Until then the site still works, but data lives in memory and can disappear, and the app shows a warning bar. Check `/api/health`: `"storage":"redis"` means it's connected.

Optional environment variables:
- `SESSION_SECRET`: signs login cookies. If unset, one is derived from the Redis token.
- `RESEND_API_KEY` + `EMAIL_FROM`: send password-reset emails through Resend. Without them, “Forgot password” explains that email isn’t on yet.
- `SITE_URL`: canonical URL for a custom domain.

## What works
- **Accounts**: email + password sign-up and sign-in, onboarding (`/welcome`), password reset, settings (profile, password, notifications, privacy), data export, account deletion.
- **Vybez DJ**: import rekordbox XML, Serato CSV, VirtualDJ M3U, TRAKTOR NML or text (parsed in the browser; files never upload), set editor with publish and visibility, library, crates, insights, public set pages (`/s/:id`) with saves, reactions and comments, public profiles (`/u/:handle`) with follows.
- **Live rooms**: the DJ opens a room (`/dj/live`), marks tracks as they play; fans (`/live/:handle`) see the tracklist, react, comment and request. No audio is streamed.
- **Vybez Social**: plan a night, invite link (`/i/:code`), RSVP without an account, host approval, plus-ones, guest songs, address unlock, guest pass, calendar file, door check-in (`/social/:id/door`).
- **Notifications** and **Your Vybez** (`/me`) for follows, saved sets and nights.

Not live yet (the UI says so): Google/Apple sign-in, payments (`/upgrade` is a prototype), streaming-service connections, the browser extension, Vybez Link.

## Two products, one site
Every account is either **Vybez DJ** (`product: 'dj'`) or **Vybez Social** (`product: 'social'`), picked at sign-up and switchable in Settings (data is kept).
- DJ accounts see sets, library, crates, insights, live rooms, connections, Explore, following and DJ notifications. Shell: `layout: app`.
- Social accounts see their nights, planning, guest lists, door mode, RSVP notifications and Social settings. Shell: `layout: social`.
- Moving between the two: every API answer that names the account also sets a small `vz_product` cookie (not HttpOnly, no secrets, just `dj` or `social`). `vercel.json` redirects use it, so a Social account that opens a `/dj` link is sent to `/social?from=dj` by Vercel before any DJ page loads (no flash), and gets a one-line explanation. Sign-in and sign-up pages are never redirected, so a stale cookie can't loop. If the cookie is missing, `src/js/app.js` does the same redirect after `/api/me`.
- Switching product in Settings asks in a dialog, saves, and goes straight to the new home. Page changes inside a product cross-fade (View Transitions) with the sidebar and tab bar held still; nothing animates with reduced motion.
- The browser sends an account that opens the other product's page back to its own home (`src/js/app.js`), and the API refuses the other product's endpoints with 403 (`needProduct` in `server/domain/users.js`). Public pages (`/s/:id`, `/u/:handle`, `/live/:handle`, `/i/:code`, marketing pages) stay open to everyone. Social accounts have no public profile.
- Accounts from before the split with `role: 'listener'` are treated as Social.

## Load time
- Every page preloads `/api/me` and `<link rel="modulepreload">`s all the JS it will run (the build reads the import graph), so nothing waits on a chain of downloads.
- `src/js/app.js` downloads the page's module while `/api/me` is in flight. `GET /api/me` is one Redis round trip after the session lookup.
- Signed-in visitors never get the signed-out sample content or its photos. Small thumbnails use `*-xs.webp` (about 3 KB) instead of the 30 to 80 KB card images.
- `npm run perf` measures it. `scripts/dev.mjs` with `PROD_LIKE=1` serves files with Vercel's cache headers and gzip so repeat visits behave like the live site.

## Structure
- `src/pages/**.html` pages, each starting with a `<!--meta {...}-->` comment (`page` picks the controller, `layout` picks the shell, `app` marks the current nav item)
- `src/pages/v/` templates for dynamic routes, mapped by `rewrites` in `vercel.json`
- `src/layouts/` (`site`, `bare`, `app` = Vybez DJ, `social` = Vybez Social), `src/partials/` (sidebars, top bars, phone tab bars, shared settings and notifications bodies). `{{#if:dj}}…{{/if}}` keeps markup for one product only.
- `src/js/site.js` UI behaviour, `src/js/app.js` entry (ES module): `core/` (util, api, session, playlist, ui) and `pages/` (auth, dj, social, public, account), loaded per page
- `server/api.js` entry; `server/lib/http.js` validation, rate limits, router; `server/domain/` users, music, live, nights, email; `server/routes/` auth, account, dj, social; `server/store.js` storage (Upstash REST / file / memory); `server/auth.js` scrypt passwords and signed cookies
- `api/index.js` the Vercel Function; `scripts/dev.mjs` local server; `scripts/test-api.mjs` API checks; `scripts/e2e-mobile.mjs` phone run

## Design system
Spacing and radius use one x2 scale: none 0, xxs 2, xs 4, sm 8, md 16, lg 32 (`--s-*`, `--r-*`). Grid: desktop margin 64 / gutter 32, tablet 32 / 16, mobile 16 / 16, content max 1280. Type: display 72, brand heading 44, heading-1 30, heading-2 28, heading-3 22, heading-4 16, body 14, caption 13, overline 11. Fonts: Bricolage Grotesque, Figtree, JetBrains Mono (self-hosted). Icons: Lucide outline 2px.

## Placeholders to replace before launch
- **Photos** are real photos from Unsplash (Unsplash License). Credits are in src/img/CREDITS.md.
- **DJ software logos** (Serato, rekordbox, VirtualDJ, TRAKTOR, djay Pro, Engine DJ) are recreations. Swap in official press-kit files (`src/logos/w-*.svg`, `m-*.svg`). File badges `f-*.svg` are Vybez's own.
- **Pricing** figures are placeholders pending confirmation.
- `/kemi`, the demo dashboard and `/i/tobi-30` are example pages and say so.
