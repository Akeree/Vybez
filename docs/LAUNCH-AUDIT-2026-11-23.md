# Vybez launch audit, 23 November 2026

Scope: the whole site and API on `main` (commit 94bcd4d) as Vybez Social prepares to launch on 1 December 2026, with Vybez DJ still "coming soon". Covers technical requirements, product and UX against Mobbin references, and legal/compliance risk. PR #9 (group chat, rides, moments) was open and is reviewed only where it affects launch.

**Verdict:** the build is solid. Security fundamentals, accessibility and performance were already good. The real launch risks were the share image, invented testimonials, a DJ-first pricing page for a Social-first launch, and legal loose ends. The code-side items are fixed in this PR; what's left needs Dayo or a lawyer (bottom of this page).

How it was checked: read every server file; built the site; ran `npm test` (all API checks pass) and `DJ_OPEN=1 npm run test:mobile` (231 phone checks pass); crawled 21 public routes at 320 px and 1440 px with Playwright for status, title, h1, overflow, console errors, failed requests, tap targets and axe-core WCAG 2.1 AA; looked at full-page screenshots; measured JS/CSS weight; benchmarked pricing and 404 against Mobbin.

## 1. Ship-readiness (19 checks)

| # | Check | Status | Evidence / fix |
|---|---|---|---|
| 1 | Platform default domain | ❌ To do | Live on `vybez-ecru.vercel.app`. Domain purchase is in hand elsewhere; then set `SITE_URL`. Fallback in the build pointed at the wrong URL (`vybez.vercel.app`); fixed. |
| 2 | Unique titles | ✅ | Every route has `Page · Vybez`. |
| 3 | Meta descriptions | ✅ Fixed | Sign-in (17 chars) and Pricing (DJ-only copy) rewritten. Short ones left are on noindex pages. |
| 4 | Favicon / touch icon | ✅ Fixed | Had only an SVG favicon. Added `favicon.ico`, 180 px `apple-touch-icon`, 192/512 icons and a web manifest. |
| 5 | Open Graph | ✅ Fixed | Added `og:image` width/height/alt and `og:locale`. **The default share image was a photo of a crowd of children**; replaced with a branded 1200×630 graphic. Invite previews now set the image alt per night. |
| 6 | Canonical URLs | ✅ | Every page; invites point at `/i/:code`. |
| 7 | Social previews | ✅ | Invite previews are server-rendered (PR #6). Re-test in opengraph.xyz once the domain is live. |
| 8 | sitemap.xml / robots.txt | ✅ Fixed | Sitemap listed the DJ example dashboard, sets and connections while DJ is closed; app-layout pages are now left out until `DJ_OPEN`. robots.txt now disallows `/api/`. Vercel marks previews noindex. |
| 9 | Custom 404 | ✅ Fixed | Branded 404 existed but sent people to DJ "Explore" (closed). Now Social-first with Home, Plan a night, Pricing, Help, Sign in. |
| 10 | Loading states | ✅ | Skeletons on data pages; no "Loading…" text found. |
| 11 | Error messages | ✅ | API errors are specific ("That date has passed…"); offline and 5xx have plain wording; empty states exist. |
| 12 | One h1, ordered headings | ✅ | Exactly one visible h1 on all 21 routes. |
| 13 | Alt text | ✅ | 0 images without `alt`; decorative photos use `alt=""`; icon buttons labelled. |
| 14 | Console errors | ✅ | 0 errors and 0 failed requests on all routes (the 404 page's own 404 is expected). |
| 15 | Leftover console.log | ✅ | None in `src/js`. Server keeps one `console.error` for 500s on purpose. |
| 16 | Source maps / secrets | ✅ | No bundler, no `.map` files, no keys in client code, `.env*` ignored. |
| 17 | Bundle size | ✅ | All JS + CSS together is about 57 KB gzipped (budget 200 KB per route). Images are WebP with width/height. |
| 18 | Mobile layouts | ✅ Fixed | No horizontal scroll at 320/360/390/1440. Footer links were 18 px tall; now 24 px minimum and 44 px on touch screens. |
| 19 | Spacing consistency | ✅ | One x2 token scale (`--s-*`, `--r-*`) from the 5 Nov audit. |

## 2. Security

Already strong: scrypt passwords, signed HttpOnly/Secure/SameSite cookies with session versioning, same-origin JSON CSRF guard, strict CSP and HSTS, ownership checks on every host route, address only for approved guests, rate limits on every write, size caps, HTML escaping. Fixed today:

| Finding | Risk | Fix |
|---|---|---|
| `?next=/\evil.com` passed the redirect check (browsers treat `\` as `/`) | Open redirect after sign-in, usable for phishing | Reject backslashes (`src/js/core/api.js`) |
| A malformed `Origin` header crashed the request with a 500 | Noise, misleading errors | Returns 403 (`server/api.js`) |
| Sign-in limit was per IP+email only | One IP could try many accounts | Added 50 per 15 min per IP |
| Reset endpoint had no length cap or rate limit | CPU cost of hashing huge passwords | 200-char cap, 10 per 15 min per IP |
| Line breaks in night titles reached the calendar file and previews | Calendar-file injection on a guest's device | One-line fields strip line breaks; `.ics` escapes `\r` too |
| No way to report a vulnerability | Researchers have nowhere to go | `/.well-known/security.txt`, `/help#security`, docs/SECURITY.md |
| No `Cross-Origin-Opener-Policy` | Weaker isolation from pop-ups | Added `same-origin` |

Open (accepted for now, details in docs/SECURITY.md): Preview and Production share one database; sign-out is per device; invite codes are guessable in theory (title/date/area only, never the address); no uptime or error alerts.

## 3. Product and UX, benchmarked on Mobbin

| Screen | References | What they do | Vybez before | Done |
|---|---|---|---|---|
| Pricing | [Eventbrite](https://mobbin.com/sites/sections/cc8b777f-479f-43a5-9cb4-f0bb324266a6), [Eventbrite FAQ](https://mobbin.com/sites/sections/faff74c5-b742-4c0b-affa-c29a9ecb59c3), [Visitors](https://mobbin.com/sites/sections/aa7ebe2d-c846-4c7f-b3e9-5b8b21c6f712) | Lead with the plan you can buy today and say plainly who pays ("Free for you, low fees for attendees"); FAQ answers the money questions for that product | Headline "Pro when the bookings come", Listener and DJ plans first, Social host last, FAQ all about DJ mixes, a "Secure card and bank payments" badge with payments switched off | While DJ is coming soon: "Free while we're in early access", Social host first and highlighted with "Open now", Listener CTA says Coming soon, monthly/yearly toggle hidden, trust row says free/no card/guests never pay, four Social FAQs first (free now? later price? do guests pay? who sees my address?) |
| 404 | [Orchid](https://mobbin.com/sites/sections/af04a09b-9020-42cb-a63c-bd0dcc746579), [Vucko](https://mobbin.com/sites/sections/91855e0a-0354-45f7-8a78-6d7e2b1a0b67) | Say what happened, then offer the few places people actually want | Sent people to Explore live rooms (closed) | Home and Plan a night first, then Pricing, Help, Sign in; tells invite recipients to ask the host for a fresh link |
| Social proof | Luma, Partiful (from the 5 Nov audit) | Real host quotes, or none | Invented "illustrative" quote from "Ada O." beside a real person's stock photo, mentioning DJ Kemi (DJ is closed) | Plain product statement with the Vybez mark; sign-up quote panel likewise |
| Invite page | Partiful, Luma | Small "Report" link; consent line under RSVP | Neither | "Report this invite" in the footer; 18+ and Terms line under the RSVP buttons |

Other product notes (not changed):
- The home page and Social plan promise "Private moments" and the invite will show "The group" only once **PR #9** merges. Merge it before launch or soften those lines.
- Real venues in example content ("Hard Rock", "Sky Bar") replaced with fictional ones to avoid implying partnerships.
- Google and Apple buttons on sign-in say "not switched on yet" when tapped. Consider hiding them until they work; dead buttons read as unfinished.

## 4. Legal and compliance

Full checklist with 26 items: [LEGAL-AND-COMPLIANCE.md](LEGAL-AND-COMPLIANCE.md). Fixed in code today: 18+ confirmation at sign-up and RSVP, report and copyright-complaint process, rules on photos of other people, breach-notice promise, removal of invented testimonials, child-free share image, font and icon licences shipped, false payment claim removed, fictional venues.

## 5. Docs added

| File | What |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, request flow, code map, Redis data model, environments |
| [SECURITY.md](SECURITY.md) | Controls, known gaps, how to report, breach response |
| [OPERATIONS.md](OPERATIONS.md) | Deploy, rollback, environment variables, monitoring, incident and data-request runbook |
| [LEGAL-AND-COMPLIANCE.md](LEGAL-AND-COMPLIANCE.md) | Compliance checklist and the lawyer pack |
| `.env.example` | Every environment variable, no values |
| `THIRD_PARTY_NOTICES.md` | Fonts, icons, brand marks, photos and their licences |

## Still to do, by impact

1. **Merge PR #9** or remove the "moments" promises, then add a Report button on group photos.
2. **Domain**: point it at Vercel, set `SITE_URL`, `CONTACT_EMAIL` (a domain address, replacing the personal Gmail fallback) and Resend (`RESEND_API_KEY`, `EMAIL_FROM`) so password reset works.
3. **Who runs Vybez**: set `LEGAL_NAME` to your name or a CAC-registered business.
4. **Separate Preview data**: give Preview deployments their own Upstash database.
5. **Monitoring**: uptime check on `/api/health` and an error alert (docs/OPERATIONS.md).
6. **Lawyer pack**: NDPC registration threshold, cross-border transfers, 18+ approach, "Vybez" trademark search, Terms/Privacy review (docs/LEGAL-AND-COMPLIANCE.md).
7. **Before DJ opens**: official DJ-software logos, replace stock faces on example pages, hide or wire up Google/Apple sign-in.
