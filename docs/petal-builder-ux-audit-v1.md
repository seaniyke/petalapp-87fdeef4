# Petal Builder UX & Product Audit v1.0

Date: 2026-08-06 · Method: full read of `src/routes/builder.tsx` (5,594 lines), all builder-adjacent components, `src/styles.css`, and the non-builder journey routes, plus ripgrep census across 128 `.tsx` files. No code was changed.

Evidence rule: every claim below has a `file:line` anchor or a counted census. Anything not verifiable in code is marked *unverified*.

---

## 1. Executive summary

Petal is **functionally at parity** with Lovable/Bolt on the things that are hard — instant CDN preview while the sandbox boots, a humanized error layer with a two-tier technical disclosure, staged streaming labels, crash-detect with "Ask Petal to repair", auto-repair that doesn't charge, and a per-build timeline/changes drill-down. Those are genuinely competitive.

Where Petal is behind is **not capability, it is restraint and consistency**. Three specific structural problems account for most of the felt gap:

1. **The builder chrome is forked and duplicated.** The builder does not use `SiteHeader`/`MobileNavSheet` at all — it hand-rolls ~290 lines of header. Nine actions are reachable from two different surfaces, two components (`HistoryPanel`, `WebsiteInfoSheet`) are mounted twice with independent open-state, and 20 sheets/dialogs are mounted unconditionally on every builder render. Desktop shows ~9 top-level chrome affordances in a row; mobile's action sheet exposes *more* features than desktop's "More" menu.
2. **Status is narrated by three components at once.** During deploy, `BuildActivityCard`'s subcaption, `PublishSheet`'s header pill, and the header Publish button label all independently render the same `buildStatus` with different wording and no shared source.
3. **Chat table-stakes are missing.** No copy button on messages or code blocks, no per-message regenerate, no edit-and-resubmit, no stop-generation, and auto-scroll has no bottom-proximity check — it yanks the user back down mid-read on every state change (`builder.tsx:1476-1478`). This is the single highest-frequency irritation in the product.

Fix those three and Petal reads as a peer of Lovable. None of them require new capability — they are subtraction and consolidation.

---

## 2–7. Scores

| Dimension | Score | Basis |
|---|---:|---|
| **Overall UX** | **68 / 100** | Strong recovery/error/preview engineering; undermined by chrome duplication, status triplication, and missing chat basics. |
| **UI consistency** | **64 / 100** | 9 radius forms in active use, Tailwind shadow scale co-existing with 3 semantic `--shadow-*` tokens, 3 competing "big heading" mechanisms, 95 files using raw `<button>` vs 43 using `<Button>`. Colour tokens themselves are excellent (only 28 hardcoded-colour occurrences repo-wide). |
| **Builder simplicity** | **55 / 100** | ~53 interaction call-sites, ~20 mounted overlays, 9 duplicated action pairs, 15 separate `setSettingsOpen(true)` call-sites. Lowest score, and the right place to spend effort. |
| **Mobile experience** | **58 / 100** | Correct `100dvh` + `safe-top`/`safe-bottom`, but only one breakpoint (`md:`) governs the entire layout, primary touch targets are 32–36px (below 44px), the readiness checklist is desktop-only, and `⌘K` has no mobile equivalent. |
| **Accessibility** | **72 / 100** | Zero `<img>` missing `alt`, zero dialogs missing titles, 109 `aria-label` usages across 58 files. Deductions: 5 unlabeled `Button size="icon"`, hand-rolled `<button>`s (the majority) lack `focus-visible` styling, avatar uses `alt=""`, password-strength colours bypass tokens. |
| **Information architecture** | **60 / 100** | Feature set is coherent, but discovery is not: desktop cannot reach Analytics / Cloud / Payments / Connectors from header chrome, `ProjectSettingsSheet` is a catch-all with 15 entry points, and two share surfaces coexist with no explanation of the difference. |

---

## 8. Top 25 UX issues, ranked by severity

| # | Sev | Issue | Anchor |
|---|---|---|---|
| 1 | Critical | Auto-scroll has no bottom-proximity check; scrolling up mid-stream is undone on every `messages`/`busy` change. | `builder.tsx:1476-1478` |
| 2 | Critical | No stop/cancel generation. Composer only queues (`"Type to queue your next message…"`). User cannot abort a wrong build. | `builder.tsx:5130-5131` |
| 3 | Critical | Cross-origin X-Frame-Options refusal on the instant preview is undetectable by the `childElementCount` check; leaves a broken iframe with a "warming up" badge forever, no message, no retry. | `WebContainerPreview.tsx:418-436` |
| 4 | Critical | Dev-server crash that logs to stderr without rejecting never becomes a structured error state — only raw log lines. | `webcontainer.ts:704-722` |
| 5 | High | Three simultaneous, independently-worded readouts of the same deploy status. | `BuildActivityCard.tsx:192-199`, `PublishSheet.tsx:549-554`, `builder.tsx:3691-3697` |
| 6 | High | `PublishSheet` shows a raw last-log-line error banner for the same build that `PetalErrorCard` is humanizing elsewhere. | `PublishSheet.tsx:860-867` |
| 7 | High | Discuss-mode failures get a bare `toast.error(e.message)` while build failures get the full friendly-error card — same class of failure, two tiers of care. | `builder.tsx:2880` |
| 8 | High | No copy button on code blocks or messages anywhere. | `MarkdownMessage.tsx` (absent) |
| 9 | High | No per-message regenerate; only a `⌘K` palette item for the last prompt — undiscoverable, and dead on mobile. | `builder.tsx:3350-3357` |
| 10 | High | Primary mobile touch targets below 44px: send/voice 36px, attach 32px, mode pill 32px, header icons 36px. | `builder.tsx:5147,5172,5191,5201,3446` |
| 11 | High | Single `md:` breakpoint governs all layout. A 768px iPad gets the desktop grid, leaving a 408px preview column while the "Tablet" device preset is 820px — guaranteed overflow at the exact breakpoint. | `builder.tsx:3871,5292` |
| 12 | High | `HistoryPanel` mounted twice with two disconnected open-states. | `builder.tsx:3582-3589`, `:3801-3809` |
| 13 | High | `WebsiteInfoSheet` mounted twice with two independent `seoOpen` states. | `builder.tsx:3795-3800`, `ProjectSettingsSheet.tsx:353-359` |
| 14 | High | Friendly-error copy for `generation_incomplete` / `truncated_response` / `upstream_timeout` promises automatic retry while the button demands a manual one. | `friendly-errors.ts:83-131` |
| 15 | Med | Two share surfaces (`SharePopover`, `SharePreviewDialog`) with no UI explanation of the difference; mobile reaches only one. | `builder.tsx:3670-3681`, `:3601-3610` |
| 16 | Med | Desktop chrome cannot reach Analytics, Cloud, Agent integrations, Payments, Connectors — mobile can. | `builder.tsx:3636-3655` vs `BuilderActionsSheet.tsx:340-366` |
| 17 | Med | 20 sheets/dialogs mounted unconditionally on every builder render. | `builder.tsx:3724-3866` |
| 18 | Med | `ReadinessBadge` is `hidden md:inline-flex` — the entire launch checklist is invisible on phones. | `ReadinessBadge.tsx:93` |
| 19 | Med | Toast + persisted error card fire together for the same save failure. | `builder.tsx:2624-2632` |
| 20 | Med | `RuntimeLowBalanceBanner` and the `buy-credits` error card both own low-balance nagging. | `builder.tsx:3718` |
| 21 | Med | Textarea auto-grow is documented but no height-mutation handler exists — `rows={1}` + `max-h` + scroll only. | `builder.tsx:5112,5138-5139` |
| 22 | Med | No `enterKeyHint` on the composer; mobile soft keyboards give no send affordance. | `builder.tsx:5122-5128` |
| 23 | Med | Snack preview errors have no retry at all; missing entry files and binary assets are silently placeholder-patched. | `SnackPreview.tsx:55-97,173-180` |
| 24 | Low | Skeletons exist in only 3 non-admin surfaces against 172 `animate-spin` usages. | census |
| 25 | Low | `highlight.js/styles/github.css` is light-only; code blocks don't follow dark mode. | `MarkdownMessage.tsx:4` |

---

## 9. Top 25 quick wins (low effort, high impact)

1. Gate auto-scroll on `scrollHeight - scrollTop - clientHeight < 120`, add a "jump to latest" pill.
2. Add a hover copy button to `pre` in `MarkdownMessage`.
3. Add a hover copy button to assistant messages.
4. Wire the existing stop path to a visible Stop button while `busy`.
5. Route `PublishSheet`'s raw error banner through `toFriendlyError`.
6. Delete the redundant toast at `builder.tsx:2628`.
7. Send discuss-mode failures through `PetalErrorCard`.
8. Bump send / voice / attach to `h-11 w-11` on mobile only.
9. Add `enterKeyHint="send"` to the composer textarea.
10. Add a dark-mode highlight.js theme swap.
11. Give `HistoryPanel` a single controlled mount.
12. Give `WebsiteInfoSheet` a single controlled mount.
13. Add `aria-label` to the 5 `Button size="icon"` instances.
14. Give the profile avatar a real `alt`.
15. Replace the `PublishSheet` pill + header button label with one shared `useBuildStatusLabel()` output.
16. Add one line to `BuildActivityCard`: "You can keep chatting — preview updates when this finishes."
17. Show `ReadinessBadge` on mobile inside `BuilderActionsSheet`.
18. Merge the duplicate "Code" and "Files" rows in `BuilderActionsSheet` (identical handler).
19. Add a `sm:` step so 390px gets tighter padding than 430px.
20. Lazy-mount the 20 overlays behind their open flags.
21. Add a numeric elapsed timer to the deploy phase.
22. Add a retry button to the Snack error state.
23. Add `safe-left`/`safe-right` utilities and apply to builder chrome.
24. Reserve `z-40` for future fixed chrome; document the stacking contract.
25. Replace `alt=""` decorative-vs-content audit with a lint rule.

---

## 10. Top 10 launch blockers

1. Auto-scroll hijack (#1).
2. No stop-generation (#2).
3. Silent X-Frame-Options preview death (#3).
4. Silent dev-server crash (#4).
5. Raw technical strings reaching users in `PublishSheet` and four `toast.error` fallbacks (#6, #7).
6. Sub-44px primary touch targets on the two most-tapped mobile controls (#10).
7. Tablet overflow at exactly 768px (#11).
8. Auto-retry copy/behaviour mismatch — users are told Petal will retry, then asked to retry (#14).
9. Duplicate `HistoryPanel` / `WebsiteInfoSheet` state (can show stale or conflicting views) (#12, #13).
10. Desktop cannot reach five whole feature areas that mobile can (#16).

---

## 11. Screens/components to redesign

- **Builder header** — rebuild as three zones (identity · view switch · one primary action + one overflow). Target: 5 top-level affordances on desktop, down from ~9.
- **`BuilderActionsSheet`** — currently 17 rows; regroup into Ship / Build / Configure, drop the duplicate row.
- **`ProjectSettingsSheet`** — 15 entry points make it a junk drawer. Give it real tabs and deep-link targets instead of `settingsScrollTo`.
- **Assistant message block** — a single turn can stack plan + markdown + checklist + next-steps + N suggestion chips + recap. Cap at markdown + one action row; move the rest behind a "What's next" disclosure.
- **Mobile builder** — introduce a real bottom bar (Chat / Preview / Actions) instead of one round toggle plus a title button.

## 12. Components to remove

- The second `HistoryPanel` mount (`builder.tsx:3801-3809`).
- The second `WebsiteInfoSheet` mount (`ProjectSettingsSheet.tsx:353-359`).
- `PublishSheet`'s raw error banner (`:860-867`).
- The duplicate "Files" row in `BuilderActionsSheet`.
- The redundant toast at `builder.tsx:2628`.
- Either `RuntimeLowBalanceBanner` or the `buy-credits` card — not both.
- Dead comments documenting removed UI (`builder.tsx:3720,5221-5223,5235-5236`).
- `--radius-4xl`, and `--shadow-glow` / `--gradient-editorial` if confirmed unused.

## 13. Components to merge

- `SharePopover` + `SharePreviewDialog` → one Share sheet with two clearly-labelled modes.
- Header "More" (desktop) + `BuilderActionsSheet` "More" (mobile) → one action registry rendered in two containers, so feature parity is structural.
- Deploy status: card subcaption + sheet pill + header button label → one `useBuildStatusLabel()`.
- `ReadinessBadge` "Connect domain" + `SharePopover` + `PublishSheet` domain CTAs → one `openDomains()` action.
- `ProjectsDrawer` and `SiteHeader`/`MobileNavSheet` → one app-nav shell used by the builder too.

## 14. Missing features that would materially help

1. Stop generation.
2. Edit-and-resubmit a sent message.
3. Per-message regenerate.
4. Copy code / copy message.
5. Message-level thumbs up/down feeding the learning loop.
6. A visible "preview is showing the last deployed build" state during rebuilds.
7. Numeric progress/ETA on deploy.
8. Command palette on mobile.
9. A diff view in `BuildDetailsSheet` Changes tab (currently badges only).
10. Keyboard-shortcut cheatsheet.

---

## 15. Competitive read

| Area | Petal vs field |
|---|---|
| Instant preview while booting | **At parity** with Lovable; ahead of Bolt (which shows a cold boot). |
| Error humanization + technical disclosure | **Ahead** of Bolt and Replit AI; the two-tier `PetalErrorCard` is genuinely better than a raw log dump. |
| Auto-repair without charging | **Ahead** of everyone benchmarked. |
| Build transparency (timeline, changes, thought rollups) | **At parity** with Lovable. |
| Chat interaction basics (copy/regen/edit/stop/scroll) | **Behind all six.** This is the most visible gap. |
| Chrome restraint | **Behind** Lovable and v0; ahead of Replit AI. |
| Mobile builder | **Behind** Rork (mobile-native) and Lovable; ahead of Cursor (no mobile). |
| Design-token discipline | **Ahead** of Bolt; behind v0. |

---

## 16. Prioritized roadmap

**Sprint 1 — Stop the bleeding (chat + preview honesty).** Items #1–4, #6, #7 plus quick wins 1–10. This is where perceived quality lives.

**Sprint 2 — Collapse the chrome.** One action registry, one status source, single mounts for `HistoryPanel`/`WebsiteInfoSheet`, lazy overlays, desktop/mobile feature parity. Target: builder chrome down to 5 desktop affordances and one action sheet.

**Sprint 3 — Mobile as a first-class target.** 44px targets, a real bottom bar, `sm:`/`lg:` steps, tablet column fix, readiness on mobile, safe-area left/right.

**Sprint 4 — Consistency pass against the Design Bible.** Radius/shadow/heading normalization, skeletons replacing spinners on every primary surface, `focus-visible` on hand-rolled buttons, dark-mode code theme.

**Sprint 5 — Depth.** Diff view, message feedback loop, ETA modelling, mobile palette.

---

*Baseline established 2026-08-06. Compare every future builder milestone against this document and against `docs/petal-design-bible.md`.*
