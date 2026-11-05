# Vybez website

Static site for Vybez: **Vybez DJ** (sets, tracklists, live rooms) and **Vybez Social** (small invite-only nights). No runtime dependencies.

```
npm run build      # src/ -> dist/
```

Deployed on Vercel (`vercel.json`: build `npm run build`, output `dist`, clean URLs, security headers). Set `SITE_URL` for a custom domain; otherwise canonical URLs use Vercel's production domain.

## Structure
- `src/pages/**.html` pages, each starting with a `<!--meta {...}-->` comment
- `src/layouts/` site, app (DJ dashboard shell) and bare (invites, sign-up)
- `src/partials/` nav, footer, sidebar, preview bar
- `src/css/site.css` tokens and styles; `src/js/site.js` small progressive behaviour
- `scripts/build.mjs` the build (helpers: `{{icon:}}`, `{{brand:}}`, `{{photo:}}`, `{{svg:}}`, `{{lockup}}`, `{{> partial}}`)

## Design system
Spacing and radius use one x2 scale: none 0, xxs 2, xs 4, sm 8, md 16, lg 32 (`--s-*`, `--r-*`). Grid: desktop margin 64 / gutter 32, tablet 32 / 16, mobile 16 / 16, content max 1280. Type: display 72, brand heading 44, heading-1 30, heading-2 28, heading-3 22, heading-4 16, body 14, caption 13, overline 11. Fonts: Bricolage Grotesque, Figtree, JetBrains Mono (self-hosted). Icons: Lucide outline 2px.

## Placeholders to replace before launch
- **Photos** are AI-generated placeholders.
- **Serato and rekordbox logos** are recreations. Swap in official press-kit files (`src/logos/w-*.svg`, `m-*.svg`). VirtualDJ, TRAKTOR, djay Pro and Engine DJ show "logo pending".
- **Pricing** figures are placeholders pending confirmation.
- DJs, numbers, rooms and quotes are examples; the site says so in a preview bar.
- Accounts, payments, imports and the browser extension are not live. Buttons explain this instead of pretending.
