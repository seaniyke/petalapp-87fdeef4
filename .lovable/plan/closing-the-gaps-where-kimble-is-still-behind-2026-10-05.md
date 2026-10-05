# Closing the gaps: where Kimble is still behind

Four gaps came out of the comparison with Lovable, Bolt, Replit and v0. This plan covers all four in a set order. Each phase ships on its own and is tested live before the next one starts.

```text
Phase 1  Connector Hub (one-click connections)  <- biggest gap, needed by every other phase
Phase 2  Speed (first preview in seconds)
Phase 3  Coverage of unusual requests (robustness at scale)
Phase 4  Launch Kit (business suite: brand, social, marketing, launch, monitor)
```

## What exists today (confirmed)
- 9 integrations (Resend, Plausible, Stripe, Paystack, Flutterwave, PostHog, OpenAI, PWA, Stripe Identity). All of them ask the user to paste keys. None has a one-click sign-in flow.
- Kimble Cloud, email, custom domains and Git sync work live.
- Builds go through one tool loop. The preview appears only after the whole build passes its checks.
- Still open on the roadmap: moving edits onto the tool loop, run-time tracing (Stage C) and live benchmarks.

---

## Phase 1: Connector Hub
**Goal:** "Connect Stripe" or "post to Instagram" becomes one click and one consent screen. No keys to paste, and Kimble asks for each connection at the moment the build needs it.

1. **One connector model.** Each connector has a name, a category, a way to sign in (one-click sign-in, API key or webhook), the permissions it needs, a health status and the build instructions Kimble uses to wire it in. The existing 9 integrations move onto this model unchanged.
2. **One-click sign-in flow.** A single connect / return / refresh flow, built on Kimble's own server. Tokens are encrypted at rest. Two kinds of owner:
   - **Business-owner connections:** the customer's own Stripe, Instagram and so on, used by their app and their launch tools.
   - **End-user connections:** a visitor of the generated app links their own Google account, for example. This ships in a second step.
3. **First connectors, by business value:**
   - Payments: Stripe Connect (Standard), Paystack
   - Social: Meta (Facebook Pages and Instagram), X, LinkedIn, TikTok
   - Google: Business Profile, Analytics, Search Console, Calendar
   - Comms: WhatsApp Business, Resend (already done), Slack
   - Dev: GitHub (move the existing Git sync over)
4. **Connector Hub screen.** The current Connectors sheet becomes a hub with categories, a status for each connection (connected, needs attention, expired), reconnect and disconnect.
5. **In-chat ask.** The planner spots when a connector is needed. Kimble asks once in chat with a connect card, and the build waits only on that one item. This follows the existing "ask inline, no banners" rule.
6. **Health monitor.** A scheduled check finds expired or revoked tokens and shows "needs attention" in the hub.

**Done when:** a live build of "a salon that takes Stripe deposits and posts new services to Instagram" connects both services in one click each and works end to end.

## Phase 2: Speed
**Goal:** something visible within about 10 seconds, and a full first build in under half the current time, without weakening any check.

1. **Run-time tracing first (roadmap Stage C).** Time each step: time to first token, model time, tool time, checking time. Changes then aim at the real slow parts, not guesses.
2. **Live draft preview.** Pages appear in a draft preview as soon as each one passes its own check. The final verified version still decides "done", so nothing unchecked is ever published.
3. **Instant starting shell.** A preset layout with the chosen design and navigation renders while the pages are being written.
4. **Run more in parallel.** Independent pages are written at the same time; writes to shared files stay one at a time. Page checks are cached by content.
5. **Faster model routes.** Use the existing preferred-speed setting with measured thresholds. Steps that need little thinking use a faster model.
6. **Edits on the tool loop** (the open roadmap item), so small edits stay small and quick.

**Done when:** 4-page site, medium app and small edit are benchmarked live, with before/after times and no drop in margin or pass rate.

## Phase 3: Coverage of unusual requests
**Goal:** reliable results beyond the known product types.

1. **Test suite of about 60 prompts** across many industries, odd requests and unusual libraries. It runs on a schedule against the live engine.
2. **Failure library.** Every failed build is grouped by root cause. The top causes become checked rules, following the existing "fix the root cause" practice.
3. **Approved package list.** Known-good versions of common libraries, plus a safe fallback when a request names an unknown one.
4. **Generic intent families** for request types that are still missing (marketplace, community, internal tool, content/media), with tests.
5. **Quality dashboard.** Pass rate, average time, cost and top failures over time, in admin.

**Done when:** the suite passes at 90% or more on two scheduled runs in a row.

## Phase 4: Launch Kit (the business suite)
**Goal:** "Launch my business" delivers the app plus everything around it. This is the part no competitor offers.

1. **Business brief.** Kimble asks a few focused questions (audience, offer, price, location, tone) and saves them to the product plan.
2. **Brand kit.** Name, logo, colours, voice and taglines, reusing the design packages.
3. **Launch assets.** A 30-day social content calendar with images, ad copy variants, launch email, Google Business listing text, search-engine basics.
4. **Publishing.** Through the Phase 1 connectors: schedule posts, send the launch email, update the Google Business profile. Every post needs approval, and nothing goes out on its own without the owner saying yes.
5. **Launch checklist.** Domain, email, payments, analytics and legal pages, each with a live status.
6. **Business monitor.** One screen with visitors, sign-ups, orders and revenue, social reach, uptime, plus a weekly summary from Kimble with suggested next steps.
7. **Pricing.** Launch Kit work is priced in credits on the existing effort curve. No new pricing model.

**Done when:** one prompt for a real test business gives a live app, a brand, scheduled posts and a working monitor.

---

## Out of scope / unchanged
Billing rules, the pricing curve, cloud tiers, the design-package authority, verification gates, edit scope rules. Mobile, API-backend and Chrome-extension builds stay paused.

## Technical details
- New modules: `src/server/connectors/` (model, registry, sign-in flow, token store, health job) and `src/routes/api/public/connectors/callback.ts` (state check, PKCE). Tokens are encrypted with a new master key secret. Tables `connector_accounts` and `connector_events` have RLS, grants and service_role access.
- Existing `IntegrationDefinition` entries move onto the connector model through a compatibility adapter. The installer stays the single place that writes code into the app.
- Each provider needs its own developer app (Meta, X, LinkedIn, TikTok, Google, Stripe Connect). The user must register these, and some need review: Meta takes about 1–4 weeks, TikTok about 1–2. This is an external blocker for the social connectors. Stripe, Google and GitHub can ship first.
- Speed work goes into `tool-loop.ts` and `loop-telemetry.ts`. The draft preview streams through the existing page checkpoint writes; commit stays protected by the revision check.
- Any change under `src/server/` used by generation means rebuilding the agent bundle and bumping its version.
- Every phase ends with tests, a typecheck and one live build before it is called done.

## Suggested start
Phase 1, steps 1–4, with Stripe Connect, Google and GitHub first. These need no long provider review.
