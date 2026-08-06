# Petal Phase 1 — Builder UX & Design Foundation Roadmap

Source of truth: `docs/petal-builder-ux-audit-v1.md` (25 issues, 25 quick wins, 10 blockers) and `docs/petal-design-bible.md` (20 sections).
Date: 2026-08-06. Status: **Sprints 1–4 shipped. Sprint 5 (H4, L1, L2, L3, L6) remains.**

Definition of done for Phase 1: one builder UI · one design language · one interaction language · one loading system · one notification system · one error system.

---

## 1. Scoring method

**Severity**
- **Critical** — user loses work, loses money, or is shown something broken with no way out.
- **High** — daily friction, or a visible inconsistency a competitor doesn't have.
- **Medium** — noticeable to an attentive user; erodes trust slowly.
- **Low** — polish; invisible until everything above is fixed.

**Effort** — S ≤ 2h · M ≤ 1 day · L ≤ 3 days · XL > 3 days.

---

## 2. Every recommendation, categorized

### 2.1 Critical (7)

| ID | Item | Effort | Depends on |
|---|---|---|---|
| C1 | Auto-scroll bottom-proximity gate + "jump to latest" pill (`builder.tsx:1476`) | S | — |
| C2 | Visible Stop-generation button wired to the existing abort path | M | — |
| C3 | Preview: detect cross-origin frame refusal via the server-side probe, render a reason card + "Open in new tab" | M | F1 (preview state machine) |
| C4 | Dev-server stderr crash → structured error state, not raw log lines (`webcontainer.ts:704`) | M | F1 |
| C5 | Kill all raw technical strings reaching users: `PublishSheet` banner + 4 `toast.error(e.message)` fallbacks route through `toFriendlyError` | S | F3 (error contract) |
| C6 | Discuss-mode failures use `PetalErrorCard`, not a bare toast | S | F3 |
| C7 | `friendly-errors.ts:83-131` — copy promises auto-retry while the button demands manual; make `actionKind` and copy agree | S | F3 |

### 2.2 High (9)

| ID | Item | Effort | Depends on |
|---|---|---|---|
| H1 | Single build-status source `useBuildStatusLabel()`; `BuildActivityCard`, `PublishSheet` pill, header button all consume it | M | F2 (status hook) |
| H2 | Copy button on code blocks (`MarkdownMessage`) | S | — |
| H3 | Copy button on assistant messages | S | — |
| H4 | Per-message regenerate + edit-and-resubmit | L | C2 |
| H5 | Mobile touch targets → 44px (send, voice, attach, mode pill, header icons) | S | F4 (Button size contract) |
| H6 | Add `sm:`/`lg:` steps; fix the 768px iPad case where preview column < tablet preset | M | F4 |
| H7 | `HistoryPanel` single controlled mount | S | — |
| H8 | `WebsiteInfoSheet` single controlled mount | S | — |
| H9 | Action registry: one definition per builder action, rendered by both desktop chrome and `BuilderActionsSheet`; closes the 9 duplicated pairs and the desktop/mobile parity gap | L | F5 |

### 2.3 Medium (9)

| ID | Item | Effort | Depends on |
|---|---|---|---|
| M1 | Lazy-mount the 20 unconditional sheets behind their open flags | M | H9 |
| M2 | Collapse `SharePopover` / `SharePreviewDialog` into one share surface | M | H9 |
| M3 | `ReadinessBadge` reachable on mobile via the action sheet | S | H9 |
| M4 | Notification channel contract: delete toast-plus-card duplicates (save failure, low balance) | S | F3 |
| M5 | One low-balance owner — banner *or* error card, never both | S | F3 |
| M6 | Composer: real auto-grow handler + `enterKeyHint="send"` | S | — |
| M7 | Snack preview retry; disclose placeholder substitution inline | M | F1 |
| M8 | Elapsed timer on the deploy phase past 30s | S | F2 |
| M9 | Merge duplicate "Code"/"Files" rows in the action sheet | S | H9 |

### 2.4 Low (6)

| ID | Item | Effort |
|---|---|---|
| L1 | Skeletons for the known-shape surfaces currently using `animate-spin` | L |
| L2 | Dark-mode highlight.js theme swap | S |
| L3 | `aria-label` on the 5 unlabeled icon buttons; real `alt` on the avatar | S |
| L4 | `safe-left` / `safe-right` utilities applied to builder chrome | S |
| L5 | Document + enforce the z-index contract (10/20/30/40/50) | S |
| L6 | Lint rules: no hardcoded colours, no deprecated radii, no raw `<button>` without focus ring | M |

---

## 3. Foundations (must land before the items that depend on them)

These are not user-visible on their own. They are the "operating system" the audit asks for.

| ID | Foundation | Effort | Unlocks |
|---|---|---|---|
| **F1** | **Preview state machine** — one reducer with explicit states (`booting · showing-last-deployed · live · refused · crashed · timed-out`), each with a timeout and a declared reason. | L | C3, C4, M7 |
| **F2** | **`useBuildStatusLabel()`** — single hook owning the 7 build states and their wording. | M | H1, M8 |
| **F3** | **Error contract** — every failure produces `{ headline, cause?, technical?, actionKind }` via `toFriendlyError`; `PetalErrorCard` is the only renderer. | M | C5, C6, C7, M4, M5 |
| **F4** | **Design token enforcement** — 3 radii, 3 shadows, sanctioned type scale, `Button` sizes incl. 44px touch variant. | M | H5, H6, L6 |
| **F5** | **Builder action registry** — one array of `{ id, label, icon, run, surfaces }`. | M | H9, M1, M2, M3, M9 |

---

## 4. Dependency graph

```text
F3 error contract ──► C5, C6, C7, M4, M5
F2 status hook   ──► H1, M8
F1 preview FSM   ──► C3, C4, M7
F4 tokens        ──► H5, H6, L6
F5 action registry ─► H9 ──► M1, M2, M3, M9
C2 stop          ──► H4 regenerate / edit-resubmit
(independent)    ──► C1, H2, H3, H7, H8, M6, L2, L3, L4
```

Nothing in Low blocks anything. Anything unblocked can be parallelized.

---

## 5. Sprint plan

**Sprint 1 — Honesty (Critical path).** F3, then C5 C6 C7 C1 C2. Plus H2 H3 M6 (independent, cheap).
Exit: no raw error string can reach a user; the user can always stop and always scroll.

**Sprint 2 — One status, one preview.** F2 → H1 M8. F1 → C3 C4 M7.
Exit: build status has exactly one wording; every preview failure names a reason and offers an action.

**Sprint 3 — One chrome.** F5 → H9 M1 M2 M3 M9, plus H7 H8.
Exit: every action defined once; desktop/mobile parity is structural; ≤ 5 top-level header affordances.

**Sprint 4 — One design language.** F4 → H5 H6 L4 L5, plus the radius/shadow/type migration.
Exit: Design Bible §2–§6 passes a repo-wide grep.

**Sprint 5 — Polish & guardrails.** H4, L1, L2, L3, L6.
Exit: chat has full table-stakes; lint prevents regression.

---

## 6. Exit criteria for Phase 1

| Target | Measured by |
|---|---|
| One builder UI | Zero duplicated mounts; ≤ 5 header affordances; action registry is the only definition site |
| One design language | Grep finds 0 hardcoded colours, ≤ 3 radius forms, ≤ 3 shadow tokens, 0 off-scale type in app UI |
| One interaction language | Every icon control labelled; every interactive element has a focus ring; 44px targets below `lg` |
| One loading system | Every known-shape surface uses a skeleton; no bare full-screen spinner on a primary surface |
| One notification system | No event renders in two channels; ≤ 1 banner on screen |
| One error system | `PetalErrorCard` is the only failure renderer; `toFriendlyError` the only producer |
| Score movement | Overall UX 68 → ≥ 85; Builder simplicity 55 → ≥ 80; Mobile 58 → ≥ 80 |

---

*Version 1.0 — 2026-08-06. Phases 2–5 are governed by the AI Generation Bible, Frontend Quality Bible, Backend Quality Bible, Product Principles, and the Engineering Playbook.*
