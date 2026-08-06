# Petal Product Principles

Petal's constitution. Twenty rules. Every engineer, every prompt, every future feature answers to them.

When two principles conflict, the lower number wins.

Version 1.0 — 2026-08-06.

---

**1. Never overwrite working code.**
An edit changes what was asked and nothing else. Regenerating a working file to change a heading is a defect. If a rewrite is genuinely required, say so before doing it.

**2. Never show a broken preview.**
If the current build isn't viewable, show the last good one and label it. A blank frame, a refused iframe, or a spinner with no end is never an acceptable resting state.

**3. Never generate a placeholder.**
No lorem ipsum, no "TODO", no dead buttons, no `#` links, no coming-soon pages. If Petal can't build it now, it says so instead of faking it.

**4. Always produce a runnable first version.**
The first artifact of every project runs. Scope shrinks before runnability does.

**5. Verify before preview.**
Nothing reaches the user's eyes that hasn't compiled. Validation is not optional and is never skipped to save time or money.

**6. Repair before failing.**
Every recoverable failure gets bounded, automatic repair — deterministic first, AI second — before the user is told anything went wrong.

**7. Prefer deterministic fixes over AI retries.**
A known error shape gets a codemod, not a model call. Every new recurring error becomes a codemod.

**8. Preserve user intent.**
What the user asked for is built at the scope they meant. Not narrowed, not widened, not transformed. Disagreement is voiced in one sentence, then the ask is honoured.

**9. Never surprise the user.**
No unrequested rewrites, no silent scope changes, no features they didn't ask for, no charges they didn't expect, no state that changes while they're reading.

**10. Chat is never blocked.**
No build state, no error, no billing condition disables the composer.

**11. Automatic rollback on failed edits.**
A failed edit restores the previous state and reports exactly what was reverted. The user never has to clean up after Petal.

**12. One fact, one surface.**
A given piece of state — build status, balance, an error — is rendered by exactly one component at a time. Duplicated narration is a bug.

**13. Never fail silently.**
Every async path has a timeout, a plain-English message, and either a retry or a stated reason retry won't help.

**14. Plain English first, technical on demand.**
Users see human language. Stack traces live behind a disclosure, always with a copy button. Raw error strings never reach a toast.

**15. Charge once, charge honestly.**
One user-initiated turn, one charge. Repairs, retries, and internal passes are Petal's cost. Unrecoverable failures refund automatically.

**16. Landing page before dashboard, when it's ambiguous.**
Ship the thing that can be shown to someone else first.

**17. Mobile is a target, not a fallback.**
Every feature ships with a phone affordance or it doesn't ship. Parity between desktop and mobile is structural, not manual.

**18. Subtract before adding.**
If a new control duplicates an existing one, merge it. A second entry point for an existing action is a regression.

**19. Every generated app has a real identity.**
A real name, a real logo, real copy. Never a disclaimer banner about being a demo.

**20. Say what it is.**
Petal, Petal Cloud, Petal AI. Sentence case, second person, present tense. No apologizing twice for the same failure, no exclamation marks, no hype.

---

## How to use this

- **Reviewing a PR?** If it violates a principle, it doesn't merge — regardless of how good the feature is.
- **Writing a prompt for the generator?** These are constraints, not suggestions.
- **Arguing about a decision?** Cite the number.
- **Want to break one?** Amend the document first, publicly, with the reason. Silent exceptions are how products rot.

*Version 1.0 — 2026-08-06.*
