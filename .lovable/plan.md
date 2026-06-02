## Petal Quality Engine v1 — A + B + C

Three small, surgical additions to the existing pipeline. No new architecture, no new turn stages, no per-build extra LLM passes. All three layer on top of the marketing/app quality bars we already shipped.

---

### A. Domain Feature Packs

**Problem:** `DOMAIN_COMPONENTS` in `src/lib/app-shape-classifier.ts` lists the 3–4 *core* components per vertical (CRM → ContactsTable, Pipeline, DealDetail, ActivityLog). It does not include the **secondary product surfaces** that turn a "CRM screen" into a "CRM product": activity timeline, notifications, reporting, onboarding, etc. As a result, every business-app vertical ships the same skeleton.

**Change:** Introduce a parallel `DOMAIN_FEATURE_PACKS` map in the same file. Each entry lists 2–4 *secondary* components that must also be planned for that domain.

```ts
// src/lib/app-shape-classifier.ts
export const DOMAIN_FEATURE_PACKS: Record<BusinessDomain, string[]> = {
  crm:        ["ActivityTimeline", "ReportsPanel", "NotificationsCenter"],
  helpdesk:   ["SlaTracker", "CannedResponses", "CustomerSidebar"],
  ats:        ["InterviewScheduler", "OfferLetter", "CandidateNotes"],
  pm:         ["TimelineGantt", "WorkloadView", "TimeTracking"],
  billing:    ["RevenueChart", "DunningQueue", "TaxSettings"],
  lms:        ["QuizRunner", "Certificates", "LearnerProgress"],
  // … one row per BusinessDomain
};

// Also export fintech/marketplace/social/booking packs keyed off shape.category
// when businessDomain is undefined (Part 3 of source prompt: marketplace →
// ratings, reviews, messaging; fintech → KYC, audit log, transactions).
export const CATEGORY_FEATURE_PACKS: Partial<Record<AppShape["category"], string[]>> = {
  fintech:     ["TransactionsLedger", "KycPanel", "AuditLog"],
  marketplace: ["RatingsAndReviews", "MessagingThread", "SellerAnalytics"],
  social:      ["FeedTimeline", "NotificationsCenter", "ProfileHeader"],
  booking:     ["AvailabilityCalendar", "BookingConfirmation", "ReviewsPanel"],
};
```

**Wire-up in `src/server/pipeline/stage-plan.server.ts`:**
- Around line 296–297 (the `domainLine` block), append a second line that lists the feature pack as **also required** (separate from core components so the planner doesn't confuse them).
- Update `repairBusinessAppPlan` (line 378) to consider feature-pack components when computing gaps.
- Bump `business-app` file budget from 25 → **28** to accommodate the extra components (current cap from the last plan is 25).

**Wire-up in `renderShapeBlock` (`src/lib/app-shape-classifier.ts` line 403):**
- Add a "Domain feature pack (also required)" line after the existing "Required product components" line so monolithic single-call builds get the same signal.

**Net effect:** A "Build me a CRM" prompt now plans ContactsTable + Pipeline + DealDetail + ActivityLog **plus** ActivityTimeline + ReportsPanel + NotificationsCenter — turning a CRM screen into a CRM product. Same fix lands for every vertical at once.

---

### B. Domain → Font-Pair Defaults

**Problem:** `src/server/design-director.server.ts` picks display/body fonts purely from the LLM's interpretation of vibe. Output drifts: a fintech build can land on Fraunces, an AI tool can land on Cormorant. No deterministic floor.

**Change:** Add a small lookup that biases the design director toward domain-appropriate pairings. The director can still override when the user gave explicit design direction or the vibe strongly demands it — this is a **default**, not a lock.

```ts
// src/server/design-director.server.ts (new helper)
const DOMAIN_FONT_DEFAULTS: Record<string, { display: string; body: string }> = {
  fintech:     { display: "Inter Tight",   body: "Inter" },
  "ai-tool":   { display: "Geist",         body: "Geist" },
  saas:        { display: "Plus Jakarta Sans", body: "Inter" },
  marketplace: { display: "Space Grotesk", body: "Inter" },
  ecommerce:   { display: "Instrument Serif", body: "Inter" },
  social:      { display: "Space Grotesk", body: "Inter" },
  booking:     { display: "Bricolage Grotesque", body: "Inter" },
  editorial:   { display: "Fraunces",      body: "Inter" },
};
```

**Wire-up:**
- Inject the matched default into the LLM prompt as a **suggested pairing** (not a hard rule) — phrased as "Default for this category: X (display) + Y (body). Override only if the vibe demands a clearly distinctive direction."
- After the LLM responds, if it returned the same generic pair we already ban (Inter+Inter when no vibe distinction was made, or Poppins anywhere), substitute the domain default.

**Net effect:** Predictable, on-brand typography across verticals without removing creative latitude. Fintech reliably ships in Inter; AI tools reliably ship in Geist.

**Note:** Geist requires loading via Vercel's CDN or `@fontsource/geist`. The font-loader prompt already handles Google Fonts; we add a one-liner allowing the director to write `@fontsource/geist` into `index.html` when it picks Geist.

---

### C. Component Contract Checklist (`/app/*` only)

**Problem:** Current `appRules` in `src/server/pipeline/stage-scaffold.server.ts` (line 160) forbids placeholders and mandates sidebar/topbar/seed-data, but talks about quality in prose. The LLM skips items.

**Change:** Convert the `appRules` block into an **enumerated checklist** of component contracts the model must satisfy. Concrete, countable, lintable.

```
Component contracts (every component in /app/* MUST satisfy these — count them):

BUTTONS
- [ ] All primary actions have: default + hover + focus-visible + disabled states
- [ ] Async actions render a loading state (spinner or skeleton), never freeze
- [ ] Destructive actions use variant="destructive" + confirm dialog

FORMS
- [ ] Every <Input> has an associated <Label> and <FormMessage /> slot
- [ ] Validation runs on blur AND submit (react-hook-form + zod)
- [ ] Submit button shows loading + disables during submission
- [ ] Success path shows toast (sonner) + redirects or resets

TABLES (any list of 5+ items)
- [ ] Search input filters client-side
- [ ] At least one sortable column header
- [ ] Empty state component (icon + message + primary CTA) when length === 0
- [ ] Row actions via DropdownMenu (View / Edit / Delete)
- [ ] Pagination OR virtualized scroll above 50 rows

CARDS / DATA DISPLAY
- [ ] Loading state uses Skeleton, not text "Loading…"
- [ ] Error state uses Alert variant="destructive", not raw error string
```

**Wire-up:**
- Append the checklist to `appRules` in `stage-scaffold.server.ts` (around line 160).
- Add a tiny post-scaffold lint in `src/server/render-risk-linter.ts`: when a `/app/*` component contains a `<form>`, `<table>`, or `Table` import, verify the file also references `FormMessage` / `TableEmpty` / `Skeleton` etc. On miss, attach a warning to the file and re-prompt that single file (cheap — one file, not the whole build).

**Net effect:** No more dashboards shipped with a `<Table>` and zero empty state, no more forms shipped without validation messages.

---

### What this does NOT include (deliberately)

- No "Feature Evolution Engine" / pattern-memory store — vague, no concrete mechanism, skipped.
- No dark-mode default — violates Core memory rule.
- No full pre-finalize self-check pass — too expensive in latency/credits. The Part C lint covers the cheap structural slice that actually matters.
- No new font in the allowed list beyond what's already supported + Geist (the one genuinely missing distinctive sans for AI tools).
- No changes to backend / auth / RLS rules — already enforced elsewhere; nothing in the source prompt is new there.

---

### Files touched

- `src/lib/app-shape-classifier.ts` — add `DOMAIN_FEATURE_PACKS`, `CATEGORY_FEATURE_PACKS`, extend `renderShapeBlock`.
- `src/server/pipeline/stage-plan.server.ts` — inject feature pack into plan prompt + repair logic; bump file budget 25→28.
- `src/server/design-director.server.ts` — add `DOMAIN_FONT_DEFAULTS`, suggest in prompt, substitute on generic output.
- `src/server/pipeline/stage-scaffold.server.ts` — convert `appRules` prose into enumerated checklist.
- `src/server/pipeline/tier-render-risk.ts` (or `render-risk-linter.ts`) — add component-contract structural lint for `/app/*` files.

### Risks

- Feature packs raise per-build token cost (~5–10%). Mitigated by the file budget bump being modest (3 files).
- Font defaults may surprise users who expect more variety. Mitigated by treating the lookup as a suggestion the LLM can override when the vibe is strong.
- Lint re-prompt loop must be bounded (max 1 retry per file) to avoid runaway cost.
