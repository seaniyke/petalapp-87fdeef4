# Small changes: make them fast, and make them land on the right page

Two problems, one cause. A small request today goes through the same machinery as building a whole app: it is handed to the model with a wide view of the project, then finished with a full review — rebuild, open a real browser, walk pages at three screen sizes, grade the design with a second model, sometimes sign up a test user and run form flows, and occasionally start a quiet touch-up round on top.

That is why "add a back arrow to the sign-in page" takes a minute — and why it can come back having changed the landing page. Nothing today actually forces the edit to stay on the page you named: the instruction to stay small is written in the prompt as advice, and several later clean-up passes are free to rewrite other files. When the wrong file changes, we only mention it afterwards.

## Part 1 — Understand the request before touching anything

1. **Name the page first.** Before any editing starts, Kimble resolves the exact file(s) behind the words you used ("sign in page", "footer", "pricing"). If it can't confidently name them, it says so and asks one short question instead of guessing.
2. **Lock the edit to those files.** The resolved list becomes a hard boundary, not a suggestion. Any change outside it is rejected and re-attempted on the right file. Only genuine follow-on fixes (an import that would otherwise break) are allowed through.
3. **Don't let clean-up passes wander.** The automatic tidy-up, design-consistency and polish passes only run over the files this turn actually changed, never the whole project.
4. **Confirm the ask landed.** After the edit, check that the thing you asked for actually appears in the file you named. If it didn't, retry there — don't report success.
5. **Say what changed, honestly.** The result card lists the pages touched. If anything beyond your request changed, it's named plainly, not buried.

## Part 2 — Size the finishing review to the change

- **Tiny change** (a button, a label, a colour, a link, one small file): rebuild and load only the page that changed, once, at one screen size. Check only for real breakage — errors, a blank screen, a broken image. No design grading, no test sign-up, no form flows.
- **Normal change** (a section or a shared component): visit the affected pages at phone and desktop.
- **Big change** (new page, theme or layout files, many files, first build, publishing): the full review exactly as today.

Cosmetic design notes will no longer start an extra build round on a tiny change; they're saved and applied on the next substantial change or before publishing. The cheap safety net — type checking, compile checks, instant repairs — stays on for everything.

## Technical notes

- Promote target resolution to a required pre-step: combine `change-set.server.ts` surface vocabulary, route/file name matching, and the existing inspector agent into one resolver returning `targetPaths` plus a confidence value. Low confidence on a micro/targeted edit → ask one question (existing ask policy), don't build.
- Turn `renderScopeContractBlock` from prompt-only into enforcement: filter emitted ops against `targetPaths` (plus import-repair allowances) before they are applied; drop and re-prompt once with the rejected paths named. Keep `edit-scope-guard` disclosure as the backstop.
- Pass `changedPaths` into `autofixFiles`, `enforceDesignContract`, design-finisher and image-placeholder resolution on every non-initial turn (autofix and image resolution already accept a path filter — the other passes need the same).
- Add a per-item landing check: for each `ChangeSet` item, require diff evidence in a resolved target file; if absent, one targeted retry before the turn reports done.
- Add a `micro` tier to `computeVerifyScope` (`verify-scope.server.ts`): single route, single width, `skipFlows: true`, new `skipVisualScoring: true`. `buildVerifyPlan` omits `plan.auth` and `plan.flows` for micro and caps `plan.visual.routes` to one. `builds/callback.ts` skips `scoreVisualQA` and the craft-repair round for micro builds, parking craft notes for the next non-micro turn.
- Tests: resolver picks the right file for common phrasings; an op outside `targetPaths` is rejected; clean-up passes leave untouched files byte-identical; micro builds make no vision call and start no repair round.

## Expected effect

"Add a back button to the sign-in page" edits exactly one file, finishes in seconds, and never touches the landing page.
