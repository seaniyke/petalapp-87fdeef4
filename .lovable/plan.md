# Intent Detection Gap Audit — Petal vs the Field

## What we ship today

| Intent | Detector | Chip | Status |
|---|---|---|---|
| Backend (auth/db/storage) | ✅ | ✅ | Live |
| Email | ✅ | ✅ | Live |
| Custom domain | ✅ | ✅ | Live |
| Payments | ✅ | ✅ | Just shipped |

That's 4 of ~10 places where Petal *should* be smart. The rest get scaffolded as broken stubs or skipped entirely.

## What competitors trigger that we don't

From scanning Lovable, Bolt, v0, Replit, Base44, plus the third-party "Lovable SEO" auto-fixer that exists *because* Lovable misses this:

- **SEO** — Lovable is famously not SEO-ready out of the box. A whole side-business (lovable-seo.com) exists to fix it. Mentioning "rank on Google", "meta tags", "share preview", "OG image" should trigger an SEO setup chip.
- **Analytics** — Bolt and Replit auto-suggest Plausible/PostHog when users say "track visits". We have `plausible.integration.ts` sitting unused.
- **AI features in the user's app** — Replit and v0 detect "add a chatbot / summarize / generate text" and offer their AI gateway. We have Lovable AI but no detector that says "use the gateway, don't ask for an OpenAI key."
- **File uploads / images** — currently folded into the generic backend chip. Deserves its own surfacing because the answer is "Cloud storage bucket", not "Cloud + auth + DB."
- **Realtime** ("live chat", "presence", "collaborative cursor") — Cloud has it, Petal never mentions it.
- **Cron / scheduled jobs** — "send weekly digest", "remind me", "reset every Monday" needs `pg_cron`. No detector.
- **Maps / geolocation** — "store locator", "delivery zone", "nearby". Needs Mapbox/Google Maps key. No detector.
- **Push notifications** — PWA + web push. No detector.
- **PWA / install to home screen** — common ask, easy win. No detector.
- **Social auth** — "let users sign in with Google" works through backend chip but doesn't tell them they need to also configure the OAuth provider. Sub-detector under backend.

## The 6 to ship now (ranked by user impact)

I'm not building all 10. Six are clear wins; the others can wait.

### 1. SEO intent (highest impact — competitors weaponize our gap)

`src/lib/seo-intent.ts` — triggers on: "rank on Google", "SEO", "meta tags", "OG image", "share preview", "sitemap", "robots.txt", "Google indexing", "search engine".

Chip CTA: "Make this page shareable & searchable" → opens a new `SeoSetupSheet` (separate task, scoped here just to detector + chip).

### 2. Analytics intent

`src/lib/analytics-intent.ts` — triggers on: "track visitors", "page views", "analytics", "Plausible", "PostHog", "Google Analytics", "conversion", "funnel".

Chip CTA: "Add visitor analytics" → enables our existing Plausible integration.

### 3. AI-feature intent (in the user's app, not Petal itself)

`src/lib/ai-feature-intent.ts` — triggers on: "add a chatbot", "AI assistant", "summarize", "generate text/image", "translate", "ask AI", "OpenAI", "Claude", "Gemini" *when* paired with verbs like "add/integrate/build".

Chip CTA: "Wire this through Lovable AI — no key needed" → scaffolds a server function using our gateway. Critical: prevents the AI from asking the user for an OpenAI key when we have a free gateway.

### 4. File-upload intent (split from backend chip)

`src/lib/storage-intent.ts` — triggers on: "upload image/photo/video/file/PDF", "user avatar", "profile picture", "attach file", "S3", "bucket".

Chip CTA: same Cloud activation but with "+ storage bucket" copy so the user knows what's being turned on.

### 5. Realtime intent

`src/lib/realtime-intent.ts` — triggers on: "live chat", "real-time", "realtime", "presence", "online users", "collaborative", "live updates", "websocket", "pusher", "ably".

Chip CTA: "Enable realtime" → toggles Cloud's realtime publication on the relevant table.

### 6. Cron / scheduled jobs intent

`src/lib/cron-intent.ts` — triggers on: "every day/week/month", "daily/weekly/nightly", "scheduled", "cron", "reminder email", "digest", "auto-send", "background job".

Chip CTA: "Schedule this job" → scaffolds a `pg_cron` entry hitting an API route.

## Deferred (not now, but document)

- Maps / geolocation — needs paid Mapbox/Google key; better as a future paid integration.
- Push notifications — Service Worker complexity; punt.
- PWA install — small surface area, low ask volume so far.
- Social auth sub-chip — works through backend chip already; refine later.

## Implementation pattern (identical for all 6)

Each detector + chip follows the existing `email-intent.ts` / `EnableEmailSuggestionChip.tsx` pattern. Per intent:

1. `src/lib/<name>-intent.ts` — same shape as existing detectors (regex list, MIN_LENGTH, `detect…InTurn`).
2. `src/components/Enable<Name>SuggestionChip.tsx` — same two-mode pattern (default + `needsBackendFirst` for the four that require Cloud: Analytics, AI feature, Storage, Realtime, Cron).
3. Wire into `src/routes/builder.tsx` — add to the chip block alongside the existing four, with the same dedupe rule (don't double-show with backend chip).
4. Add a state slot: `dismissed<Name>Chips` Set keyed by message index.
5. Extend `settingsScrollTo` union with the new section keys.
6. Update `src/server/generate.server.ts` PREREQUISITE GATING block — add the new categories so Petal's plan/summary mentions them before scaffolding broken code.

## Order of work

```text
Pass A (detectors + chips, no settings UI yet)
  1. SEO intent + chip → opens existing project settings (placeholder)
  2. Analytics intent + chip → reuses Plausible installer
  3. AI-feature intent + chip → scaffolds gateway server fn
  4. Storage intent + chip → reuses Cloud activation
  5. Realtime intent + chip → reuses Cloud activation
  6. Cron intent + chip → reuses Cloud activation

Pass B (system prompt)
  7. Update PREREQUISITE GATING in generate.server.ts to cover all 10 intents

Pass C (deferred — needs design)
  - SeoSetupSheet (real settings panel for OG/meta/sitemap)
  - Storage bucket picker UI
  - Cron job manager UI
```

Pass A + B is the scope of the next implementation message. Pass C is its own follow-up because each needs a real settings panel, not just a chip.

## Why this matters now (we're live)

Every day Petal scaffolds an SEO-broken site, asks the user for an OpenAI key we don't need, or builds a "live chat" with no realtime, is a day a competitor's blog post writes itself ("Lovable can't even do X"). The chips are cheap insurance — they cost nothing when intent isn't detected, and they save a wasted prompt cycle when it is.

Approve and I'll ship Pass A + B in the next message.