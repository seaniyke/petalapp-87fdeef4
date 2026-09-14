# Making Petal reliable at editing an app you already have

The goal from your brief: someone says "make the landing page feel more premium — darken the hero, change the headline, replace the image, bigger CTA, smaller navbar, softer pricing cards, don't touch the functionality" and Petal does *all* of it, touches nothing else, then proves it on the running app.

## What Petal already does well (audited today)

Most of the brief already exists and should not be rebuilt:

- Intent and scope classification per turn (cheap model can widen scope, never shrink it).
- Target finding from plain language: quoted copy, section words ("hero", "footer"), page names, matched against the real files; an inspector agent greps the project when that finds nothing.
- Blast-radius awareness — the files that import or are imported by the target come along.
- Global vs local handling, with whole-app pinning for "across every page" asks.
- A scope guard that flags when a small request produced a huge rewrite.
- Persistent project understanding (purpose, design system, routes, shared components, memory) reused between turns.
- A user-authored "never touch these" file (PETAL.md).
- Cost-aware model choice per turn.
- Post-deploy browser checks and visual QA on every turn, including edits.

## The real gaps

1. **No completeness audit.** Petal is *told* to do every clause; nothing afterwards checks it did. A five-part request that lands three parts is reported as success.
2. **"Don't change X" is not recorded.** Negative constraints only survive as prose inside the prompt; nothing enforces them.
3. **No conversation focus.** "Make the button white too" after "make the hero darker" has no memory of the hero — only the newest message is sent.
4. **Petal can't see what you're looking at.** The page you're on and the element you clicked never reach the edit.
5. **The Test Lab never actually runs.** The planner, browser driver, result store and readiness gate were all built, but nothing in the live pipeline starts a test run — the build callback reads test cases nothing writes. So "the change is really there in the running app" is currently unproven for edits.
6. **No per-edit history or targeted rollback.** A bad edit can only be undone wholesale.

## The plan

### Phase 1 — Change set and completeness
Turn each message into an explicit list of requested changes (clause splitting plus the existing cheap classifier), each with its target and kind (look, wording, behaviour, data). After the edit lands, compare the change set against what actually changed. Anything unaddressed triggers one more focused pass inside the existing repair budget; if it still doesn't land, Petal says which part it couldn't do instead of claiming success.

### Phase 2 — Preserve what wasn't asked for
Extract "but keep…", "without changing…", "only the…" into recorded preservation targets that sit alongside the change set. Edits touching a preserved target are dropped and reported, reusing the existing scope guard rather than a new mechanism.

### Phase 3 — Conversation focus
Keep a small per-project focus (last section and files edited, last page discussed). Pronouns and bare references resolve against it; a clear new subject ("now fix checkout") replaces it. Stale focus expires so it can never silently misdirect a later edit.

### Phase 4 — What you're looking at
Pass the page currently open in the preview with every edit, and the clicked element when one is selected, so "make this bigger" works without naming anything.

### Phase 5 — Turn the Test Lab on, risk-based
Wire the existing planner/browser/results into the live build callback, and scope it to the edit: only the pages the edit touched, plus the must-work checks that were already passing. Cosmetic edits get screenshots and layout checks, not backend tests; sign-in or data edits get the backend checks. Before/after screenshots of the affected page, with the AI look only where the change was visual.

### Phase 6 — Edit history and precise rollback
Record each edit: the request, the change set, the files, the tests, the outcome, the version to return to. Undo one edit without discarding the others.

### Phase 7 — Prove it
The ten acceptance cases from your brief become automated tests (single edit, multi-edit, global vs local, preservation, multi-layer feature, conversational follow-up, topic change, broad redesign, four unrelated changes), plus real end-to-end edits against a live generated app.

## Technical notes

- All work extends `src/routes/api/generate.ts` and its existing helpers; no rewrite of the builder, the build service, deployment, or the UI.
- New modules: `change-set.server.ts` (extraction), `edit-audit.server.ts` (post-turn completeness), `edit-focus.server.ts` (conversation focus). Preservation extends `preservation-rules.ts` and `edit-scope-guard.server.ts`. Test Lab execution wires `test-plan/test-results/browse-client` into `api/builds/trigger.ts` and the build callback — those modules already exist and are unit-tested.
- Storage: change set, preservation targets, audit result and rollback pointer stored on the existing turn record; a small edit-history table only if the turn record can't carry it.
- Cost: extraction rides the existing cheap classifier call rather than adding one; completeness audit is deterministic first, cheap model only when the diff is ambiguous; AI screenshot review only for failed visual checks. No pricing change.
- Each phase ends with type check, the full suite (429 tests today), then a real edit through the live pipeline.

## Needs your approval

- Phase 5 makes every edit turn run browser checks, adding runtime per turn (bounded, and skipped for chat-only turns). No price change.
- Nothing here changes billing, deployment or existing generated apps.
