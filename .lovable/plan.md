# Petal differentiation plan

You already have the table-stakes (chat builder, preview, publish, custom domains, managed backend, Cloud + AI wallet, Africa-friendly Paystack billing, build-credit subs). Here's where the top 5 — **Lovable, Bolt.new, v0.dev, Replit Agent, Cursor** — are weakest, and concrete features that turn those gaps into Petal's edge.

## Competitive gap summary

| Pain that's loud in reviews | Who suffers from it | Petal's opening |
|---|---|---|
| "Fixing one thing breaks two others" — no safety net | Bolt, Lovable | **Auto-checkpoints + visual diff revert** |
| Burning credits on retries / unclear cost per change | Bolt (2M token horror stories), Lovable | **Pre-flight cost estimate before each run** |
| Insecure RLS, exposed webhooks, no signature checks | All five (DEV.to "12 security issues") | **One-click Security Audit + Petal Shield** |
| "Tested 4 tools, only one was production-ready" | Across the board | **Production Readiness Score** |
| No real mobile/native target — only PWA | Lovable, Bolt | **Capacitor wrap → real iOS/Android binary** |
| Africa/EM payments, low-bandwidth previews, NGN/KES/ZAR | Nobody serves this well | **Already half-built — double down** |
| No way to share a half-built app for feedback before publishing | All five | **Live preview share-links with comments** |

## The 7 features to ship

### 1. Time Machine — auto-checkpoints with visual diff revert
Every assistant turn auto-snapshots files. A timeline rail in the builder lets users scrub, hover to see a thumbnail of the preview at that point, and one-click revert *only the regressed file* instead of the whole project. Solves the #1 Bolt/Lovable complaint.

### 2. Pre-flight cost estimate
Before sending a prompt, a small chip shows "~$0.04 / ~12s" based on intent classification (UI tweak vs. backend change vs. full feature). Inspired by user rage about credit burn. Cheap to build: one Lovable AI classification call before the real run.

### 3. Petal Shield — automated security audit
A panel that scans the generated project for: unprotected RLS, missing webhook signature checks, exposed service-role keys, public buckets, open signup + admin tables, missing rate-limits. Runs after every backend change. Shows a Shield Score (A–F) and offers one-click fixes. Directly attacks the DEV.to "12 issues" article that's blowing up.

### 4. Production Readiness Score
A persistent badge in the header (`Prototype 62/100 → Production`). Combines: Shield Score + Lighthouse perf + accessibility + has-tests + has-error-boundary + custom domain + analytics wired. Click it to see the checklist. Turns "is my app actually ready?" into a measurable journey — no other builder has this.

### 5. Live Preview Share — comments on the preview
Generate a `petal.app/preview/{token}` link to share an in-progress project. Visitors can click any element and leave a sticky-note comment that lands back in the builder chat as "User feedback on Hero CTA: 'too small on mobile'." Founders ship faster when they don't have to schedule Loom calls. None of the top 5 have this.

### 6. Petal Mobile — one-click native wrap
"Publish to App Store" button that wraps the build with Capacitor, generates icons/splash, and produces a downloadable `.ipa`/`.apk` (or hands off to EAS Build). Lovable and Bolt are stuck on PWA — even a basic version of this is a wedge in the "AI builder for mobile" search traffic.

### 7. Region Mode — EM-first defaults
Toggle in project settings:
- Optimize images < 50KB
- Lazy-load below the fold by default
- Detect slow connections and serve text-first version
- Local payment methods auto-suggested by visitor IP (Paystack / Flutterwave / M-Pesa / Stripe)
- Optional offline-first PWA shell

You're already the best-positioned platform for Africa/SE Asia — make it explicit.

## Bold UI/UX direction

Lovable, Bolt, and Replit all converge on the same look: dark slate, rounded cards, neutral grays, blue accent. Generic SaaS. Petal should look unmistakably *itself* the moment you land on it.

**Aesthetic:** *Editorial brutalism with a warm tropical palette* — think Linear's precision crossed with Are.na's confidence and a sunset palette nobody else dares use.

- **Color** — keep the coral primary, add a deep botanical green and a buttery cream as co-stars. No pure white, no cool grays. Backgrounds tinted warm (`oklch(0.98 0.015 80)` light / `oklch(0.18 0.02 25)` dark).
- **Type** — pair a distinctive editorial display (e.g. *Fraunces* / *Tobias* / *PP Editorial New*) with a refined geometric body (*General Sans* / *Söhne*). Never Inter.
- **Layout** — asymmetric grids, oversized numerals for stats, generous whitespace on marketing routes; controlled density inside the builder.
- **Motion** — one signature page transition (a soft "petal unfurl" stagger on route change via Framer Motion), and a single delightful micro-interaction on the Send button. Resist the urge to animate everything.
- **Builder chrome** — replace the standard 3-panel IDE clone with a **floating composer dock** that overlaps the preview (like a chat window over your live app), so the preview always feels like the hero, not a sidebar.
- **Empty states** — illustrated, opinionated, and funny. Lovable's empty states are placeholder-grey rectangles. Yours should be memorable.
- **Marketing site** — full-bleed hero with a real running app embedded (not a screenshot), oversized type, and a single bold CTA. Steal nothing from the v0/Lovable layout playbook.

## Suggested order of attack

1. **Time Machine** + **Pre-flight cost** — biggest pain relief, cheapest to build, immediate viral demos.
2. **Petal Shield** — rides the security-FUD wave that's already trending against competitors.
3. **Bold UI redesign** of marketing site + builder chrome — makes everything else feel new.
4. **Live Preview Share with comments** — high-leverage growth loop (every shared link is an ad).
5. **Production Readiness Score** — frames Petal as "the one that actually ships."
6. **Region Mode** — locks in your EM moat.
7. **Petal Mobile** — biggest engineering lift, save for last but tease early.

## Technical notes

- **Time Machine:** you already write to `project_versions` — just auto-trigger on every assistant message and add a visual scrubber UI + a per-file diff/revert.
- **Pre-flight estimator:** a single `gemini-2.5-flash-lite` classification call returning `{kind, est_seconds, est_cents}`; cache by prompt hash.
- **Shield:** static analysis on `project_files` (regex + AST) for known bad patterns + a SQL probe that asks the project's backend for tables-without-RLS.
- **Readiness Score:** server function aggregating 6–8 signals you already have in DB + a Lighthouse run on the latest preview build.
- **Preview comments:** new `preview_comments` table keyed by build_id + DOM selector; the share page injects a tiny commenting widget into the iframe.
- **Mobile wrap:** background job that runs `npx cap` against the built `dist/` and uses EAS Build (or your own Mac runner) for binaries. Gate behind paid plan.
- **Region Mode:** project flag → injected `vite.config` defaults + a runtime helper that swaps payment SDKs based on `request.cf.country`.

Approve and I'll start with Time Machine + Pre-flight cost in the next turn.
