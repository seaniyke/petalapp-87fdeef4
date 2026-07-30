# Petal today: what it does, and what's left before launch

## Part 1 — What Petal can do for a user right now

**Build**
- Prompt-to-app generation for four targets: web apps, mobile apps (Expo/React Native), backends, and Chrome extensions.
- Guided idea intake: Idea Coach, start-idea prompts, industry packs, templates, themes/snippets, plan-proposal cards.
- Images, screenshots and voice input as prompt references; attachments.
- Streaming build trace with a compact activity card, Details sheet (Timeline + Changes), and phase narration.
- Live preview: web (WebContainer) and mobile (Snack with iOS/Android frame, rotate, QR to Expo Go).
- Code explorer with folder tree, search, tabs, editor and ZIP export.
- Version history, checkpoints, partial revert, "Try to fix", self-recovery and autofix passes.

**Backend and platform (Petal Cloud)**
- Managed database, auth, storage, secrets, cron, realtime, serverless functions — enabled from suggestion chips.
- Migrations, RLS policy scaffolding, and an RLS sanity linter.
- AI features via a managed gateway (no user API keys), plus image generation and transcription.
- Rate limiting, error/failure tracking, pipeline telemetry, runtime error capture.

**Ship**
- Publish to a Petal subdomain, custom domains via the registrar/Cloudflare path, SEO setup, analytics.
- Mobile publishing through Petal's own build pipeline, producing installable artifacts.
- Petal Shield security scan and a Production Readiness score with an actionable checklist.
- Sharing: share links, preview shares, visitor pages, comments inbox.

**Account, money, growth**
- Waitlist-gated access with admin toggle, name/email capture, confirmation emails and bulk announcements.
- Referral codes, invite rewards, queue position tracking.
- Subscriptions (Pro/Business) plus pay-as-you-go credit packs; free tier of 5 credits/day up to 30/month.
- Crypto checkout with background on-chain verification, PDF receipts, email confirmations, billing dashboard, Cloud + AI balance sheet, coffee tips.
- Admin console: users, projects, waitlist, billing, ledgers, AI providers, AI spend, failures, QA, pipeline, digest, mobile signing.

## Part 2 — Are we close to the reference ad?

The ad's claim is "not just frontend — the whole stack." Mapped against Petal:

| Their column | Petal today |
| --- | --- |
| Frontend | Yes |
| APIs & backend logic | Yes |
| Database & storage | Yes |
| Auth & permissions | Yes |
| Hosting & deployment | Yes |
| Cloud & compute | Yes |
| CI/CD & version control | Partial — checkpoints/revert exist; no Git remote sync or PR flow |
| Security & RLS | Yes (Shield + RLS linter) |
| Rate limiting | Yes (platform-side) |
| Caching & CDN | Yes (Cloudflare) |
| Load balancing & scaling | Managed by the host, not surfaced to users |
| Error tracking & logs | Yes internally; thin in the user-facing project view |

Answer: yes, Petal already covers the same stack, and goes further with the Readiness score, waitlist/referral growth engine, crypto billing and mobile store pipeline. The two real gaps are Git/CI/CD and a user-visible logs surface. The bigger gap is that none of this is *communicated* — the ad wins on messaging, not capability.

## Part 3 — Launch readiness plan

**A. Tell the story (highest leverage, smallest effort)**
1. Add a "What Petal actually does" section on the landing page in the reference's format: the thin "what you think" block versus the full stacked list of twelve capabilities, using Petal's tokens and a young, high-energy tone.
2. Rewrite the hero and features copy around "the whole stack, shipped" rather than feature lists.
3. Add a comparison strip (Petal vs frontend-only tools) and surface the Readiness score as the signature differentiator.

**B. Close the two capability gaps**
4. User-facing project Logs tab: build failures, runtime errors and function logs from data already captured.
5. Git export/sync: connect a repo, push generated code, keep checkpoints mapped to commits.

**C. Pre-launch hardening**
6. End-to-end pass on the money paths: subscribe, top up, crypto confirm, receipt, refund/failure states.
7. End-to-end pass on waitlist → invite → sign-up → first build → publish, on mobile viewport.
8. Run Shield plus a dependency scan on Petal itself; fix criticals.
9. Verify every transactional email renders and sends from "Petal AI" on buildwithpetal.com.
10. Load-check the generate pipeline and confirm rate limits and credit settlement behave when many users arrive at once.

**D. Launch mechanics**
11. Announcement email to the full waitlist, staged in batches, with referral CTA.
12. Public changelog entry, docs pass, and share-card/OG images for every marketing route.

## Technical notes

- The landing capability section is presentation-only: a new component under `src/components/` rendered from `src/routes/index.tsx`, using semantic tokens from `src/styles.css`.
- Logs tab reads existing sources: `src/routes/api/public/track-failure.ts`, `track-runtime-error.ts`, and `pipeline-telemetry.server.ts`.
- Git sync would follow the existing `mobile-github.server.ts` pattern for repo auth.
- No schema changes are required for Part A; Logs and Git sync each need their own review before implementation.

## Suggested first step

Ship Part A (items 1–3) as one focused change, since it directly answers the reference ad and needs no backend work.
