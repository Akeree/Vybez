# Operations runbook

How Vybez is deployed, configured, watched and recovered. Hosting: Vercel (team `papiwys`, project `vybez`). Database: Upstash Redis connected through Vercel Storage.

## Deploy

- Every push to `main` deploys to Production. Every other branch and pull request gets a Preview URL.
- Build: `npm run build` (no dependencies to install). Output: `dist/`. API: `api/index.js`.
- Before merging: `npm test` (API) and `DJ_OPEN=1 npm run test:mobile` (phone run, needs Playwright).
- After a deploy: open `/api/health`. Expect `"storage":"redis"`, `"persistent":true`, `"sessionSecret":true`, and `"email":true` once Resend is set up.

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

## Monitoring (to set up)

Nothing alerts anyone yet. Cheapest useful setup:

1. **Uptime**: a free monitor (Better Stack, UptimeRobot) on `https://<domain>/api/health` every 5 minutes, alerting by email or WhatsApp.
2. **Errors**: Vercel → Logs filtered to `level:error` (the API logs every 500 with `console.error`). Add Vercel Log Drains or Sentry later.
3. **Usage**: Vercel Web Analytics is cookieless, so it can be turned on without a cookie banner. Add one line to the Privacy policy when you do.
4. **Upstash**: watch the daily command count and storage on the free tier; photos are the biggest keys.

## Routine tasks

- **Yearly**: renew `/.well-known/security.txt` (the build sets `Expires` 11 months ahead, so any deploy renews it).
- **When Terms or Privacy change in a way that matters**: update `LEGAL_UPDATED` (or the default in `scripts/build.mjs`) and email account holders before it applies.
- **Before turning on payments**: update Terms (refunds, chargebacks), Privacy (payment provider), and pricing copy.
- **Password reset by hand** (no email yet): `scripts/reset-link.mjs` prints a one-hour link for an account.

## Incident and breach response

1. **Contain**: roll back (above). If secrets may be exposed, rotate them: `SESSION_SECRET` (signs everyone out), Upstash token (Vercel → Storage → rotate), `RESEND_API_KEY`.
2. **Assess**: what data, whose, since when. Vercel logs keep about a day on the free plan, so export them early.
3. **Notify**: if personal data was exposed, tell the Nigeria Data Protection Commission within **72 hours** of finding out, and tell affected people without delay in plain language (what happened, what data, what they should do). Keep a written record either way.
4. **Fix and review**: patch, add a test, write a short note on what happened and what changes.

## Data requests

- **Download / delete**: account holders do this in Settings.
- **Guests without an account** who ask to be removed: find them through the host's night (`night:<id>:g` → `guest:<id>`) and delete the guest record, `gtok:<token>` and `pass:<night>:<pass>` keys. Reply within 30 days.
