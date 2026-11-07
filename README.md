# Vybez website

Vybez: **Vybez DJ** (sets, tracklists, live rooms) and **Vybez Social** (small invite-only nights). Static pages plus one Vercel Function for the API. No runtime dependencies.

```
npm run dev     # build + local server with the API on http://localhost:3000 (data in .data/db.json)
npm test        # end-to-end API checks (in-memory store)
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

## Structure
- `src/pages/**.html` pages, each starting with a `<!--meta {...}-->` comment (`page` picks the controller in `src/js/app.js`)
- `src/pages/v/` templates for dynamic routes, mapped by `rewrites` in `vercel.json`
- `src/layouts/`, `src/partials/`, `src/css/site.css`, `src/js/site.js` (UI behaviour), `src/js/app.js` (API-driven pages)
- `server/api.js` routes, `server/store.js` storage (Upstash REST / file / memory), `server/auth.js` scrypt passwords and signed cookies
- `api/index.js` the Vercel Function; `scripts/dev.mjs` local server; `scripts/test-api.mjs` API checks

## Design system
Spacing and radius use one x2 scale: none 0, xxs 2, xs 4, sm 8, md 16, lg 32 (`--s-*`, `--r-*`). Grid: desktop margin 64 / gutter 32, tablet 32 / 16, mobile 16 / 16, content max 1280. Type: display 72, brand heading 44, heading-1 30, heading-2 28, heading-3 22, heading-4 16, body 14, caption 13, overline 11. Fonts: Bricolage Grotesque, Figtree, JetBrains Mono (self-hosted). Icons: Lucide outline 2px.

## Placeholders to replace before launch
- **Photos** are AI-generated placeholders.
- **Serato and rekordbox logos** are recreations. Swap in official press-kit files (`src/logos/w-*.svg`, `m-*.svg`). VirtualDJ, TRAKTOR, djay Pro and Engine DJ show "logo pending".
- **Pricing** figures are placeholders pending confirmation.
- `/kemi`, the demo dashboard and `/i/tobi-30` are example pages and say so.
