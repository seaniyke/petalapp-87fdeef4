# Petal Go-Live Audit — Honest Assessment

Short answer: **Not today.** Petal is ~85% there. The product works end-to-end, but there are real backend/security findings and one untested-at-scale path (the new secret + integration auto-suggest you just shipped) that need a same-day cleanup pass before you should put paying users on it.

Below is everything we've built, rated, with what's blocking and what's safe to ship.

---

## What's built — feature-by-feature rating

Scale: A = production-ready · B = ready but rough edges · C = needs work before launch · D = broken/risky

### Core builder loop — A−
- Composer → `/api/discuss` → `/api/generate` → preview is solid.
- Streaming, autofix, self-recovery, local verifier, post-stream autofix all wired.
- Idea Coach, ComposerModePicker, sample showcase landing — polished.
- One known dev warning: `RESET_BLANK_CHECK` console message (cosmetic, not blocking).

### Auth & accounts — A
- Email/password + Google OAuth in place (`/auth`).
- Profile route, projects ownership, RLS in place on `projects`.
- 3 real users in the system already.

### Projects, gallery, sharing, publish — A−
- `/projects`, `/gallery`, `/p/$slug`, `/share/$token`, `PublishSheet`, `SharePopover` all wired.
- Petal subdomain + custom domain via Cloudflare SaaS implemented.
- Publish settings & badge visibility tools available.

### Billing & wallet — B+
- Paystack-based top-up (`paystack.server.ts`, `billing.return.tsx`).
- Runtime wallet, credits, preflight estimate, low-balance banner & top-up modal.
- $5 grant + $10 floor model is in code and matches your memory rule.
- Edge case to verify: wallet refresh after Paystack callback in production (we've only smoke-tested locally).

### Email infra — A−
- `email_domain` tools, scaffolded transactional + auth templates, unsubscribe route. Solid.

### Marketplace integrations — B
- Stripe, Paystack, Flutterwave, Resend, Plausible registered.
- AES-256-GCM secret encryption in `project_integration_secrets`.
- Auto-suggest classifier shipped this session (`auto-suggest.server.ts`).
- Not yet exercised in a real user prompt → low confidence it fires correctly under streaming load.

### `<lov-add-secret>` mid-conversation flow — B−
- DB tables (`pending_secret_requests`, `project_secrets`), encryption helper, server functions, `SecretRequestCard`, parser in `MarkdownMessage` all shipped.
- Not yet end-to-end tested with a real chat. Risk: tag arrives mid-stream before the request row exists in DB → card may render in a stuck "pending" state on first paint.

### Admin surface — A−
- `/admin/*` routes for users, projects, billing, ledgers, AI providers. Adequate for a soft launch.

### AI providers & cost — A−
- Smart router, dynamic prompts, design director, phase classifier all in place.
- Lovable AI gateway used (no BYOK required from end users).

---

## Blocking issues to fix before go-live

These are real, not nitpicks.

### 1. Database security findings (HIGH priority)
The Supabase linter found **83 issues**. None are RLS-disabled-on-data-tables (which would be catastrophic), but they include:

- **3× RLS Enabled No Policy** — tables with RLS on but zero policies = nobody can read them. Likely one of the recently-added tables (`pending_secret_requests`, `project_secrets`) or an admin table. Will cause silent failures.
- **5× Function Search Path Mutable** — security warnings on SECURITY DEFINER functions; needs `SET search_path = public` added.
- **70+ "Public/Authenticated can execute SECURITY DEFINER function"** — many of our `has_role`, owner-check, and helper functions are EXECUTE-grantable to anon/authenticated. Most are intentional, but we should audit and revoke EXECUTE on the ones that should be internal-only.
- **1× Public Bucket Allows Listing** — a storage bucket has a broad SELECT policy on `storage.objects`. If it's the public assets bucket that's fine; if it's user-uploaded content, it leaks file names.
- **1× Extension in Public** — cosmetic, low risk.

Action: triage each finding, fix the 3 RLS-with-no-policy ones (definitely blocking), fix the 5 search_path warnings, and audit the bucket + SECURITY DEFINER list.

### 2. Untested mid-stream tags
`<lov-add-secret>` and `<lov-suggest-integration>` were shipped without a live chat smoke test. Need to:
- Trigger one of each in a real conversation.
- Confirm the card renders, the secret saves, and the AI continues correctly.
- Confirm parser doesn't break ordinary markdown.

### 3. Tailwind config build warning
`Could not resolve "/dev-server/tailwind.config.ts"` is being logged repeatedly. The app still runs (Tailwind v4 reads `src/styles.css`), but a stale tooling reference is failing on every regen. Cosmetic in dev but worth removing so it doesn't mask real errors.

### 4. Paystack production callback
Verify the published `billing.return` URL actually receives the redirect from Paystack live mode (not just test mode) and that the wallet credits before the user lands on the page.

---

## Non-blocking but should-do this week

- Add basic rate limiting on `/api/discuss` and `/api/generate` (currently relies on credit check only).
- First-run tour exists (`FirstRunTour.tsx`) — confirm it triggers for brand-new accounts only.
- The `RESET_BLANK_CHECK` warning — track down the unknown message handler and either implement or stop emitting.
- Add a status page or at minimum a "report a bug" link in `SiteHeader`.

---

## Go-live checklist (recommended order, ~half a day of work)

```text
1. Fix the 3 RLS-no-policy tables                   (30 min)
2. Add SET search_path = public to 5 functions      (15 min)
3. Audit + revoke EXECUTE on internal-only          (45 min)
   SECURITY DEFINER functions
4. Verify storage bucket policy intent              (15 min)
5. Live-test <lov-add-secret> + auto-suggest        (30 min)
6. Live-test Paystack production callback           (20 min)
7. Remove stale tailwind.config.ts reference        (10 min)
8. Final security re-scan + linter pass             (10 min)
9. Smoke test: signup → build → publish → bill      (30 min)
10. Flip publish + announce                         (—)
```

---

## My honest recommendation

Spend **today** on items 1–8, do the smoke test (item 9) tomorrow morning, **launch tomorrow** instead of tonight. The cost of one extra day is small; the cost of leaking data via an over-permissive SECURITY DEFINER on day one would be much larger.

If you're determined to go today, the absolute minimum is items **1, 2, 4, and 9**. Items 3 and 5 can wait a few days if you accept the risk.

Tell me which path you want — full overnight cleanup, or minimum-viable launch tonight — and I'll execute.
