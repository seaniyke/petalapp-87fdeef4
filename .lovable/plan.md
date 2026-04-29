## Goal

Make the 180-line / 6KB cap a **real server-side gate**, not a prompt suggestion. And — exactly as you described — when a turn is too big to land cleanly in one go, stop at a safe boundary and surface a **"Continue building"** handoff instead of letting the model truncate.

You're 100% right that this is the *causal* fix. Truncation isn't a model bug, it's the model trying to write 600-line files in one shot. Cap the file, cap the turn, and offer a clean continuation — same pattern Lovable uses.

## Two layers, both needed

```text
Layer A (file-level):  hard cap per file        → reject + force a split
Layer B (turn-level):  too many oversize files  → stop early, offer "Continue"
```

Layer A keeps any single file healthy. Layer B keeps any single *turn* healthy.

---

## Layer A — Server-side per-file cap

### Where it runs

New tier in `src/routes/api/generate.ts`, inserted **immediately after the stream completes and `applyOps` has merged the file map**, BEFORE the styles validator and regex autofixer (so we never spend autofix budget on an oversize file we're about to reject).

```text
stream → applyOps → [NEW] file-budget gate → styles validator → regex autofix → …
```

### Constants

```ts
// src/server/file-budget.server.ts
export const MAX_FILE_LINES = 180;
export const MAX_FILE_BYTES = 6 * 1024;
// Hard ceiling — anything beyond this is rejected outright (truncation risk
// is too high to even attempt a recovery).
export const HARD_REJECT_LINES = 280;
```

### Behavior — three buckets

For each *changed* `.ts/.tsx/.jsx/.js` file under `src/` (skip the same scaffold paths as the verifiers):

| Bucket | Condition | Action |
|---|---|---|
| **Healthy** | ≤ 180 lines AND ≤ 6 KB | pass through |
| **Oversize** | 181-280 lines OR 6-10 KB | **emit a warning issue** into the autofix issue list with `kind: "oversize"` and let the existing post-stream-autofix pass try a split. Don't reject yet. |
| **Hard reject** | > 280 lines OR > 10 KB | **revert the file** to its prior content from the snapshot (or drop it if brand new) and emit a turn-level event telling the user "the page got too big — continuing in the next message." This routes into Layer B below. |

The middle bucket is important: a file at 195 lines is almost certainly fine — we just nudge the model to split next turn. Reverting a 195-line file would be more disruptive than helpful.

### New file: `src/server/file-budget.server.ts`

```ts
export type FileBudgetIssue = {
  path: string;
  lines: number;
  bytes: number;
  severity: "warn" | "reject";
};

export type FileBudgetVerdict = {
  warnings: FileBudgetIssue[];
  rejections: FileBudgetIssue[];
};

export function checkFileBudgets(
  files: { path: string; content: string }[],
  changedPaths: string[],
): FileBudgetVerdict;

/** Apply rejections to the file map: revert reverted files to their prior
 *  content, drop newly-added rejected files entirely. Returns the cleaned
 *  file list. */
export function enforceFileBudgets(
  nextFiles: { path: string; content: string }[],
  priorFiles: { path: string; content: string }[],
  rejections: FileBudgetIssue[],
): { path: string; content: string }[];
```

### Wire into the autofix issue list

When the file-budget pass emits **warnings**, pipe them into `combinedAutofixIssues` (already built post-esbuild) so the autofix model is asked to split them. Extend `LocalIssue["kind"]` with `"oversize"` and the autofix prompt already prints `${kind}: ${detail}` so the model gets:

```text
oversize: src/pages/Landing.tsx is 214 lines / 7.1 KB — split into <Hero />, <Features />, <CTA /> sub-components
```

### Timeline event

Add a new timeline step `file_budget` so users see it in the BuildActivityCard:

- **ok** — "All N files within size budget"
- **fixed** — "Flagged X file(s) as too large — repairing"
- **failed** — "Reverted Y oversized file(s) — continuing in next message" (only when Layer B fires)

---

## Layer B — Turn-level "Continue building" handoff

This is the part you specifically asked about. Two triggers, both lead to the same affordance:

### Trigger conditions

1. **Layer A produced ≥1 hard rejection** (the model genuinely tried to over-emit), OR
2. **The continuation pass ran but couldn't finish** all truncated files in one repair round (means we hit the model's output ceiling), OR
3. **The model emitted ≥ N=8 changed app files in this turn** (heuristic — beyond this, the next turn is statistically more likely to truncate).

If any trigger fires, we **don't** keep retrying. We accept the partial-but-clean state and ship a handoff.

### Server-side: new SSE event

Extend `StreamEvent` with:

```ts
| {
    type: "continuation_handoff";
    /** Why we're suggesting a continuation. */
    reason: "oversize_files" | "incomplete_turn" | "large_changeset";
    /** ≤ 80-char human message shown in chat. */
    message: string;
    /** Pre-filled prompt the user can send with one click. */
    suggestedPrompt: string;
  }
```

Emit this exactly once per turn, after all repair tiers have run, just before the final `done` event.

Example payload:

```json
{
  "type": "continuation_handoff",
  "reason": "oversize_files",
  "message": "Your landing page got large — let's finish it in the next message so nothing breaks.",
  "suggestedPrompt": "Continue building the landing page — break Hero, Features, and CTA into their own components."
}
```

### Client-side: chip in the chat

Reuse the existing chip styling from `EnableBackendSuggestionChip` / `NextStepsCard` to render a **"Continue building"** chip at the bottom of the assistant message that triggered it:

```text
┌──────────────────────────────────────────────────────────┐
│ ✨ Your landing page got large — let's finish it in the  │
│    next message so nothing breaks.                       │
│                                       [ Continue → ]     │
└──────────────────────────────────────────────────────────┘
```

Click → fills the composer with `suggestedPrompt` and auto-submits (or just fills, if you want the user to confirm — I'd default to "fill, don't submit" so the user stays in control). Clicking the chip dismisses it.

### Why this works

- Today the model tries to land everything in one turn → truncates → autofix scrambles.
- With this gate, the model gets implicit **"it's okay to stop here"** permission. Combined with the per-file cap, the system pressure is to split early instead of cramming.
- The user gets a one-click way to keep going — same UX as Lovable's "Continue building" affordance you mentioned.

---

## Files to change

**New:**
- `src/server/file-budget.server.ts` — pure helpers (`checkFileBudgets`, `enforceFileBudgets`).

**Edit:**
- `src/server/local-verifier.ts` — add `"oversize"` to `LocalIssue["kind"]`.
- `src/server/generate.server.ts` — extend `StreamEvent` with `continuation_handoff`; add `"file_budget"` to the timeline `step` union.
- `src/lib/stream.ts` — mirror the new `StreamEvent` shapes.
- `src/components/BuildActivityCard.tsx` — add `file_budget` label + icon.
- `src/routes/api/generate.ts` — insert Tier 2.4 (file-budget) between `applyOps` and the styles validator; emit the `continuation_handoff` event when triggers fire.
- `src/routes/builder.tsx` — handle the new `continuation_handoff` event; attach a `handoff` field to the relevant assistant message.
- **New** `src/components/ContinueBuildingChip.tsx` — the inline chip with the "Continue →" button (modeled on `EnableBackendSuggestionChip`).
- `src/routes/builder.tsx` — render `<ContinueBuildingChip>` under any assistant message that has a `handoff` payload.

No DB changes. No new dependencies.

## Out of scope (explicitly NOT this turn)

- Auto-splitting files on the **server** (i.e. without a model call). Splitting JSX safely needs a parser-aware refactor; we'd risk producing worse code than the model. We let the autofix model handle warnings, and Layer B catches the rest.
- Token-budget tracking (counting model output bytes mid-stream). Worth doing later, but Layer A + B together solve ~95% of what truncation costs us today.

## Success criteria

- A turn that produces a 320-line `App.tsx` is rejected, the prior `App.tsx` is preserved, and the user sees a "Continue building" chip with a sensible prefilled prompt.
- A turn with two 200-line files passes through but the next turn (when the user accepts the chip or asks naturally) splits them — visible in the timeline.
- Healthy turns show `file_budget: All N files within size budget` and add < 5ms total cost.
- No build is ever shipped containing a file > 280 lines.
