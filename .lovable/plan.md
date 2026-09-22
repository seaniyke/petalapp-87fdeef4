# Small changes: fast, on the right page, and guided by focused expertise

Two problems, one cause. A small request today goes through the same machinery as building a whole app: it is handed to the model with a wide view of the project and one very large instruction set, then finished with a full review — rebuild, open a real browser, walk pages at three screen sizes, grade the design with a second model, sometimes sign up a test user and run form flows, and occasionally start a quiet touch-up round on top.

That is why "add a back arrow to the sign-in page" takes a minute — and why it can come back having changed the landing page. Nothing today actually forces the edit to stay on the page you named: staying small is written as advice inside the instructions, and several later clean-up passes are free to rewrite other files.

## Part 1 — Understand the request before touching anything

1. **Name the page first.** Before editing starts, Kimble resolves the exact file(s) behind the words you used ("sign in page", "footer", "pricing"). If it can't confidently name them, it asks one short question instead of guessing.
2. **Lock the edit to those files.** The resolved list becomes a hard boundary, not a suggestion. Changes outside it are rejected and retried on the right file; only genuine follow-on fixes (an import that would otherwise break) pass.
3. **Don't let clean-up passes wander.** Tidy-up, design-consistency and polish passes run only over the files this turn changed.
4. **Confirm the ask landed.** Check the requested change actually appears in the named file; retry there rather than reporting success.
5. **Say what changed, honestly.** The result names the pages touched, including anything beyond the request.

## Part 2 — Size the finishing review to the change

- **Tiny change** (a button, label, colour, link): rebuild and load only the changed page, once, at one screen size. Check only for real breakage. No design grading, no test sign-up, no form flows.
- **Normal change** (a section or shared component): the affected pages at phone and desktop.
- **Big change** (new page, theme/layout files, many files, first build, publishing): the full review as today.

Cosmetic design notes no longer start an extra round on a tiny change; they're saved for the next substantial change or for publishing. Type checking, compile checks and instant repairs stay on for everything.

## Part 3 — Focused expertise instead of one giant instruction set

From your pasted notes, the idea worth taking is the **skill system**: instead of one enormous instruction block sent on every request, keep a short core rulebook plus small, separate expertise files loaded only when the task needs them. This is also the cheapest fix for the "model returned nothing" failures — those came from oversized requests.

What we adopt:

- A short **core rulebook** (how to work, scope discipline, what never to do) on every request.
- **Expertise files** pulled in only when relevant: typography, colour, page composition, section patterns, motion, imagery, copy honesty, backend safety, SEO.
- A new **redesign safety** rulebook — change how something looks without touching logic, handlers, routing, data or sign-in. This is exactly the discipline missing in the bug you hit.
- **Hard rules vs preferences**, marked as such: never invent a testimonial or statistic, never break sign-in during a visual change, never ship unreadable contrast, never use imagery we don't have rights to — versus taste guidance that can bend.
- A **selection step**: the request's type picks the handful of relevant skills; everything else stays out of the request.

What we do not do: copy another product's instruction files wholesale, or rebuild things Kimble already has. The font, icon, header, illustration and picture registries, the design director, brand and composition contracts, memory, verification, visual QA and recovery all stay — the skills sit above them as the reasoning layer that says when and how to use them.

## Technical notes

- Target resolution becomes a required pre-step: combine `change-set.server.ts` surface vocabulary, route/file name matching and the inspector agent into one resolver returning `targetPaths` plus confidence. Low confidence on micro/targeted → one question via the existing ask policy, no build.
- `renderScopeContractBlock` becomes enforcement: filter emitted ops against `targetPaths` (plus import-repair allowances) before applying; drop and re-prompt once, naming rejected paths. `edit-scope-guard` disclosure stays as backstop.
- Pass `changedPaths` into `autofixFiles`, `enforceDesignContract`, design-finisher and image placeholder resolution on non-initial turns.
- Per-item landing check: each `ChangeSet` item needs diff evidence in a target file; one targeted retry otherwise.
- `micro` tier in `computeVerifyScope`: single route, single width, `skipFlows`, new `skipVisualScoring`. `buildVerifyPlan` drops `plan.auth`/`plan.flows` and caps visual routes to one; `builds/callback.ts` skips `scoreVisualQA` and the craft-repair round for micro, parking notes.
- Skills: `src/server/skills/<name>/skill.md` + optional JSON resources, an index with trigger conditions and hard/preference tagging, and a deterministic selector keyed off `edit-classifier` scope/dimensions plus domain packs. `dynamic-prompts.server.ts` composes core rulebook + selected skills; existing prompt-budget ceilings apply. Start with redesign-safety, page-composition, typography, imagery, copy-honesty — migrating text that already exists in `design-taste.server.ts` and the docs bibles rather than writing new doctrine.
- Tests: resolver targeting; op outside `targetPaths` rejected; untouched files byte-identical; micro build makes no vision call; skill selector returns only relevant skills and always includes hard rules.

## Expected effect

"Add a back button to the sign-in page" edits one file, finishes in seconds, leaves the landing page alone — and bigger requests arrive with the right expertise instead of everything at once.
