# Legal and compliance checklist

Reviewed 23 November 2026. This is a working checklist written by an engineer, **not legal advice**. Items marked **Lawyer** need a Nigerian lawyer (ideally one who does tech and data protection) before or soon after launch. Everything else is done in code or is a setting.

Vybez's risk profile: a Nigerian consumer web service for nights out (18+), collecting names and phone numbers of people who never signed up (guests), hosting photos people upload, showing music and DJ-software brand names, with paid plans planned.

## Status at a glance

| # | Area | Status | What's in place / what's left |
|---|---|---|---|
| 1 | Privacy policy | ✅ Done | `/privacy`: what, why, lawful basis under the NDPA 2023, processors (Vercel, Upstash, Resend), transfers outside Nigeria, cookies, retention, rights, NDPC complaint route, children, security and 72-hour breach notice. Group chat/rides/moments added by PR #9. |
| 2 | Terms of service | ✅ Done | `/terms`: 18+, account rules, host responsibility for events, content rules, photos of other people, reporting, copyright complaints, music and trademarks, early-access pricing, liability, Nigerian law. |
| 3 | Consent at sign-up and RSVP | ✅ Fixed today | Sign-up and the RSVP form now say "you confirm you're 18 or over and agree to the Terms and Privacy policy" right next to the button, with links. |
| 4 | Cookie consent banner | ✅ Not needed | Only strictly necessary cookies (`vz_session`, `vz_product`) and local storage for things the user asked for. No analytics or ad cookies. **If you add analytics**, use cookieless Vercel Web Analytics or add a consent banner first. |
| 5 | NDPA / NDPC registration | ⚠️ **Lawyer** | Controllers "of major importance" must register with the NDPC and may need a Data Protection Officer and yearly compliance audits. A small early-access service is probably below the thresholds, but the NDPC's General Application and Implementation Directive (GAID) sets them by number of data subjects. Confirm and set a trigger (e.g. 1,000+ people). |
| 6 | Cross-border transfer | ⚠️ **Lawyer** | Data sits with US providers (Vercel, Upstash, Resend). The privacy policy says so. Confirm the legal basis for transfer under the NDPA's cross-border transfer rules (adequacy or contractual safeguards: the providers' DPAs) and keep copies of each provider's Data Processing Addendum. |
| 7 | GDPR / UK GDPR | ℹ️ Low | Only applies if you target people in the EU/UK. You don't today (naira, Lagos). If diaspora hosts in London start using it, revisit (EU/UK representative, legal basis wording). |
| 8 | Guests' personal data | ✅ Done | Guests give name and optional phone/email; only the host sees contact details (stated on the form). Terms limit hosts to using guest details for that night. Guests can leave a list; removal by email within 30 days (OPERATIONS.md). |
| 9 | Age (18+) | ⚠️ Partly | Terms and Privacy say 18+, and sign-up/RSVP now ask people to confirm it. There is no hard age check (none is standard for invite tools). **Lawyer**: confirm a self-declaration is enough for a nightlife product; hosts stay responsible for age limits at their event (Terms). |
| 10 | User photos (cover, moments) | ⚠️ Partly | Terms now ban photos of minors and of people who haven't agreed, and say how to report. Still missing: a **"Report" button on each photo** in the group (PR #9) and a way for the host to remove a guest's photo quickly. Add before Moments is promoted. |
| 11 | Reporting and takedown | ✅ Fixed today | "Report this invite" on every invite, a report/security section in Help, and a copyright-complaint process in Terms, all going to the contact email. Aim: look within 2 working days. |
| 12 | Fake testimonials | ✅ Fixed today | The home page and sign-up showed "illustrative" quotes from invented people next to a real person's stock photo. That can read as a misleading endorsement under the Federal Competition and Consumer Protection Act 2018. Replaced with plain product statements. Use only real, permission-given quotes later. |
| 13 | Stock photos of real people | ⚠️ Check | Unsplash License allows commercial use but gives no model release. Example pages (`/kemi`, Explore, the sample invite) put real people's faces next to invented names and comments. They're labelled examples and mostly hidden while DJ is coming soon. Before DJ launches, swap faces for initials or illustrations, or use photos with model releases. |
| 14 | Link-preview image | ✅ Fixed today | The default share image (`og.jpg`) was a photo of a crowd of children. For an 18+ nightlife product that's a real reputational and child-image risk. Replaced with a branded graphic. |
| 15 | Fonts | ✅ Fixed today | Bricolage Grotesque, Figtree and JetBrains Mono are SIL Open Font License 1.1. The licence texts now ship next to the font files (`src/fonts/OFL-*.txt`). |
| 16 | Icons | ✅ Fixed today | Lucide (ISC licence, notice now in `src/icons/LICENSE-lucide.txt` and THIRD_PARTY_NOTICES.md). Brand marks from Simple Icons (CC0, but the marks themselves are trademarks; see 17). |
| 17 | Trademarks (Spotify, Apple Music, SoundCloud, Serato, rekordbox, VirtualDJ, TRAKTOR, WhatsApp, Google, Apple) | ⚠️ Partly | A non-affiliation notice is in the footer and Terms. Naming products to say "imports files from X" is normally fair. Risks: the DJ-software logos are **recreations**, and Google/Apple sign-in buttons are shown but not working. Before DJ opens, use official press-kit logos within each brand's guidelines or text names only. Follow Google's and Apple's button rules when sign-in goes live. |
| 18 | The "Vybez" name | ⚠️ **Lawyer** | Other apps and businesses use Vybez/Vibez. Run a trademark search at the Nigerian Trademarks Registry (and WIPO Global Brand Database) and consider filing in class 9/41/42 before spending on brand. |
| 19 | Who runs Vybez | ⚠️ **You** | `LEGAL_NAME` defaults to "Vybez", which isn't a legal person. Set your full name, or register a business name / company with the CAC and use that. Contracts and the privacy policy need a real "controller". |
| 20 | Contact address | ⚠️ **You** | The legal contact defaults to a personal Gmail in `scripts/build.mjs`, which is published on Privacy, Terms, Help and security.txt. Once the domain is bought, set `CONTACT_EMAIL` to `hello@` or `privacy@` on it and remove the personal fallback. |
| 21 | Music copyright | ✅ Low | Vybez doesn't stream or host audio. Tracklists are names (facts). Guest song suggestions are names. Live rooms carry no audio. Keep it that way; streaming DJ mixes needs licences (PRS/COSON/MCSN or platform deals). |
| 22 | Event liability | ✅ Done | Terms say Vybez doesn't organise or supervise events and hosts follow local law (licences, noise, capacity, age). **Lawyer**: confirm the liability wording holds under Nigerian consumer law. |
| 23 | Pricing and payments | ✅ Fixed today | Pricing said "Secure card and bank payments" while payments are off. Now says free during early access. Before charging: refund policy, receipts, VAT (7.5%) once over the threshold, payment provider in Privacy, and FCCPC-compliant price display. **Lawyer/accountant** before payments. |
| 24 | Accessibility | ✅ Done | axe-core WCAG 2.1 AA: 0 violations on 21 public pages at 320 px and 1440 px. Footer tap targets enlarged today. Nigeria's Discrimination Against Persons with Disabilities Act 2018 favours accessible services; keep running axe on new pages. |
| 25 | Security disclosure | ✅ Fixed today | `/.well-known/security.txt` and `/help#security`. See docs/SECURITY.md. |
| 26 | Breach process | ✅ Fixed today | 72-hour NDPC notice and steps in docs/OPERATIONS.md, and the promise in the privacy policy. |

## Lawyer pack (take this list to one meeting)

1. NDPC registration / Data Protection Officer threshold for Vybez, and what triggers it (item 5).
2. Cross-border transfer basis for Vercel, Upstash and Resend (item 6).
3. Is the 18+ self-declaration enough for an invite tool used for nights out (item 9)?
4. Trademark search and filing for "Vybez" (item 18).
5. Business registration: name vs company, and who is the data controller (item 19).
6. Review Terms and Privacy as a whole, especially liability, host responsibility and UGC (items 1, 2, 22).
7. Before payments: refunds, VAT, consumer-protection price display (item 23).

## Before Vybez DJ opens

- Replace recreated DJ-software logos with official ones under their brand rules, or text.
- Replace stock faces on example DJ pages.
- Re-check the music section of the Terms if any audio feature is added.
