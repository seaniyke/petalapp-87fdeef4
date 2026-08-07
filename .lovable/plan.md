# Petal Quality Push: better apps, calmer chat

Two tracks, both driven by what the last 21 days of real build telemetry show.

## What the data actually says

Pulled from the pipeline tables (last 21 days):

- **`apply_ops` failed 10 times, and every single failure was `index.html`** — either "AI replace snippet did not match index.html" or "matched more than once". Six of those happened today alone. This is Petal's #1 broken-build cause right now.
- **`local_verify` failed on 23 of 29 turns (79%)**. Failure kinds: `missing-sibling` (a file imports something that was never written), `scope` (the edit touched files the request never mentioned), plus `jsx` / `braces` / `unterminated-string`.
- **`post_build_charge_failed` × 27** — settlement errors after a build, the biggest single entry in `pipeline_failures`.
- **`No result returned.` × 14** — a model call returned nothing and the turn had no graceful story for it.
- Repair ledger: **442 pre-build repairs applied**, zero post-build entries — Petal fixes a lot silently but the user never learns anything from it.
- Turn health is fine today (31 succeeded / 2 failed / 1 aborted). The 97 "stale" aborts are a historic backfill, not a live loop.

So: the app-quality problem is concentrated in **edit application and self-consistency**, not in the model's taste. And the chat problem is that all of the above happens invisibly.

---

## Track A — Quality of generated projects

**A1. Stop hand-editing `index.html` (fixes the top failure)**
`index.html` is machine-owned: the preview guard, the Petal badge, the favicon/brand injector and the shell restorer all rewrite it after generation. The model is editing a version of the file that no longer exists, so its snippets miss or match twice. Make `index.html` a protected path for `replace` ops, and route every legitimate need (title, meta description, fonts, favicon, theme-color) through a small structured "document head" intent that a deterministic writer applies. Model asks for `title: "…"`, Petal edits the DOM.

**A2. Kill ambiguous snippet matching**
When a replace snippet matches more than once, don't fail the whole op — disambiguate with surrounding context, and if still ambiguous, fall back to the anchored/AST edit path already in the codebase before declaring failure. An op that cannot be applied should degrade to a targeted rewrite, never to "all_ops_failed".

**A3. Close the `missing-sibling` gap**
The most common verifier complaint is an import with no file behind it. Add a pre-emit reachability check: every relative import in a changed file must resolve to a file that exists or is being written in the same turn. If not, generate the sibling in the same pass instead of shipping a broken graph and repairing later.

**A4. Enforce scope**
`scope` issues mean Petal edited files the user never asked about. Tighten the edit-scope guard from a warning into a gate for one-line/targeted requests: unrelated files get dropped from the op set and reported, not silently written.

**A5. Raise the visual floor**
The existing frontend/layout/anti-sameness passes fire but only warn. Promote the highest-signal ones to blocking for first builds: no see-through overlays, no unordered floating panels, real empty states, one `h1`, a real brand mark, and a complete landing structure. A first build that fails these should be repaired before the user ever sees it.

**A6. A real post-build check**
Nothing is written to the repair ledger post-build. After the build goes green, run the existing Playwright verifier on the home route and one deep route, record console errors and a screenshot, and feed failures back into the repair loop instead of into the user's lap.

---

## Track B — Chat and turn experience

**B1. Honest, moving status**
Replace the current spray of one-off status strings with a fixed, ordered phase model (Understanding → Planning → Writing → Checking → Building → Live), each with elapsed time and the current file/step underneath. The user should always know which of six things is happening and roughly how long it has taken.

**B2. Quiet by default, deep on demand**
Collapse tool steps, repairs and verifier chatter into a single "what Petal did" rollup per turn, expandable. Only genuinely blocking problems get a card. No duplicate error cards, no contradictory "shipping it" next to a failure.

**B3. Tell the user what got repaired**
442 silent repairs is a trust asset being thrown away. End every turn with a short, plain-language changelog: what changed, what was auto-fixed, what was skipped and why.

**B4. Real control mid-build**
Stop that actually cancels and refunds the unspent portion; a follow-up typed mid-build queues visibly with an option to "apply after this" or "cancel and use this instead".

**B5. Never end a turn with nothing**
`No result returned.` and post-charge failures must produce a specific, actionable message and a one-tap retry that does not re-charge — never a silent stop or a generic error.

**B6. Follow-through**
After a successful turn: what changed, a link that opens the exact page affected, and two or three concrete next steps drawn from the project's real gaps rather than a generic checklist.

---

## Order of work

1. A1 + A2 — the index.html and snippet-matching failures (biggest, most measurable win)
2. A3 + A4 — missing siblings and scope creep
3. B1 + B2 + B3 — phase model, noise collapse, repair changelog
4. B4 + B5 — stop/queue/refund and the never-empty-turn contract
5. A5 + A6 — visual floor promotion and post-build browser verification
6. B6 — follow-through and next steps

Each step ships with regression tests in `src/server/__tests__/` and a re-read of the same telemetry so we can prove the failure counts actually dropped.
