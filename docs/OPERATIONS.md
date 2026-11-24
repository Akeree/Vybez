# Operations runbook

How Vybez is deployed, configured, watched and recovered. Hosting: Vercel (team `papiwys`, project `vybez`). Database: Upstash Redis connected through Vercel Storage.

## Deploy

- Every push to `main` deploys to Production. Every other branch and pull request gets a Preview URL.
- Build: `npm run build` (no dependencies to install). Output: `dist/`. API: `api/index.js`.
- Before merging: `npm test` (API) and `DJ_OPEN=1 npm run test:mobile` (phone run, needs Playwright).
- After a deploy: open `/api/health`. Expect `"ok":true`, `"storage":"redis"`, `"photos":"blob"`, `"errorTracking":true`, `"sessionSecret":true`, and `"email":true` once Resend is set up. On a Preview URL also expect `"isolated":true`.

## Rollback

Vercel → Deployments → pick the last good Production deployment → **Promote to Production** (instant, no rebuild). Then revert the bad commit on `main` so the next push doesn't bring it back. Data changes are not rolled back by this; Redis has no automatic point-in-time restore on the free plan.

## Environment variables

Set in Vercel → Settings → Environment Variables, then redeploy. A template is in [`.env.example`](../.env.example).

| Name | Needed | What it does |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Yes | Upstash Redis (added by the Vercel integration) |
| `SESSION_SECRET` | Yes | Signs session cookies. Changing it signs everyone out. `openssl rand -hex 32` |
| `SITE_URL` | Yes, once the domain is live | Canonical links, sitemap, password-reset links, link previews |
| `RESEND_API_KEY`, `EMAIL_FROM` | Yes, for password reset | Sends reset emails. `EMAIL_FROM` must be on a domain verified in Resend |
| `CONTACT_EMAIL` | Recommended | Contact on Privacy, Terms, Help and security.txt. Use a domain address (e.g. `hello@` or `privacy@`), not a personal inbox |
| `LEGAL_NAME` | Recommended | Who runs Vybez (a person or registered business). Defaults to "Vybez" |
| `LEGAL_UPDATED` | Optional | Overrides the "last updated" date on Privacy and Terms |
| `DJ_OPEN` | Optional | `1` opens Vybez DJ. Unset keeps it "coming soon" |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob for photos (added by Vercel → Storage → Blob). Without it photos go into Redis |
| `SENTRY_DSN` | Recommended | Sends server errors and browser crashes to Sentry. Without it errors only reach Vercel → Logs |
| `STORE_PREFIX` | No | Overrides the automatic `preview:` key prefix on Preview. Leave unset |

## Preview data stays apart from live data

On Preview deployments (`VERCEL_ENV=preview`) every database key starts with `preview:` and every photo path with `preview/`. Test nights, accounts and rate limits made on a Preview URL can never show up on, or overwrite, the live site, even though both use the same Upstash database. For a fully separate database as well: Vercel → Storage → create a second Upstash Redis (free) → connect it to **Preview only**, and remove Preview from the first database's connection. Data created on Preview URLs before 24 Nov 2026 is still in the live database without a prefix; it's harmless test data.

## Monitoring

1. **Uptime**: a free UptimeRobot (or Better Stack) monitor on `https://<domain>/api/health` every 5 minutes, alerting by email. Health checks the database on every call and answers **503** when it can't reach it, so a broken database alerts too, not only a site that's down.
2. **Errors**: set `SENTRY_DSN` (free Sentry Developer plan, a "Browser JavaScript" or "Node.js" project; copy the DSN from Project Settings → Client Keys). Every 500 from the API and every uncaught error in a visitor's browser (max 3 per page view, rate limited per IP) goes to Sentry, tagged `production` or `preview` and with the commit it came from. Paths are stripped of ids, codes and handles; no cookies, bodies, query strings or IPs are sent. Sentry emails you on new issues by default. Errors are always in Vercel → Logs as well.
3. **Usage**: Vercel Web Analytics is cookieless, so it can be turned on without a cookie banner. Add one line to the Privacy policy when you do.
4. **Upstash**: watch the daily command count and storage on the free tier.
5. **Blob**: photos are in Vercel Blob (free on Hobby up to 1 GB storage). Photos saved before Blob still load from Redis; move them once with `node --env-file=.env.production scripts/move-photos-to-blob.mjs --apply` (dry run without `--apply`).

## Routine tasks

- **Yearly**: renew `/.well-known/security.txt` (the build sets `Expires` 11 months ahead, so any deploy renews it).
- **When Terms or Privacy change in a way that matters**: update `LEGAL_UPDATED` (or the default in `scripts/build.mjs`) and email account holders before it applies.
- **Before turning on payments**: update Terms (refunds, chargebacks), Privacy (payment provider), and pricing copy.
- **Password reset by hand** (no email yet): `scripts/reset-link.mjs` prints a one-hour link for an account.

## Incident and breach response

1. **Contain**: roll back (above). If secrets may be exposed, rotate them: `SESSION_SECRET` (signs everyone out), Upstash token (Vercel → Storage → rotate), Blob token, `RESEND_API_KEY`, `SENTRY_DSN`.
2. **Assess**: what data, whose, since when. Vercel logs keep about a day on the free plan, so export them early.
3. **Notify**: if personal data was exposed, tell the Nigeria Data Protection Commission within **72 hours** of finding out, and tell affected people without delay in plain language (what happened, what data, what they should do). Keep a written record either way.
4. **Fix and review**: patch, add a test, write a short note on what happened and what changes.

## Data requests

- **Download / delete**: account holders do this in Settings.
- **Guests without an account** who ask to be removed: find them through the host's night (`night:<id>:g` → `guest:<id>`) and delete the guest record, `gtok:<token>` and `pass:<night>:<pass>` keys. Reply within 30 days.
