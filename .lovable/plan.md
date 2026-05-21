## 0. Terminology fix first: "Lovable Cloud/AI" → "Petal Cloud/AI" (UI + plan wording)

Petal's backend + AI gateway are Petal-branded products. Any UI string that still says "Lovable Cloud" or "Lovable AI" leaks the wrong brand to users. (Internal tool-knowledge / docs prompts can keep saying "Lovable" — those are tooling, not UI.)

User-visible strings to update (verified via `rg`):
- `src/routes/admin.index.tsx:343` — "Route each AI feature to Lovable AI or OpenRouter…" → "…to Petal AI or OpenRouter…"
- `src/routes/admin.ai-providers.tsx:11, 136, 222` — "Locked to Lovable AI" / `${"Lovable AI"}` labels → "Petal AI"
- `src/components/EnableAiFeatureSuggestionChip.tsx:3` — comment + any rendered copy → "Petal AI Gateway"
- `src/lib/start-ideas.ts:161, 790, 797` — example prompts referencing "Lovable AI" → "Petal AI"
- `src/lib/themes-and-snippets.ts:227, 229` — "Lovable AI Gateway" → "Petal AI Gateway"
- Any other hit from `rg -n "Lovable Cloud|Lovable AI" src` that renders to chat, sheets, headers, badges, tooltips, toasts, or seeded prompts.

Out of scope for this rename:
- Server-side files used only as model prompts to the agent tooling (e.g. `src/server/petal-capabilities.server.ts`, `generate.server.ts` system text aimed at the AI itself, `__tests__/` fixtures, `ai-provider.server.ts` internal comments). These shape the agent's behavior, not user UI.
- `src/integrations/lovable/` (auto-generated SDK path) — must not be edited.

I will also restate the rest of the plan using **Petal Cloud** and **Petal AI Gateway** consistently.

---

## 1. Hide Templates / Industry packs / Themes & snippets from user-facing nav

These exist so Petal can match user intent to a template, pack, or snippet during generation — not as destinations. Other AI builders keep these internal. Routes stay (Petal still uses them via `industry-packs.ts`, `themes-and-snippets.ts`, `qa-harness.ts`); only the visible links are removed.

Edits:
- `src/components/MobileNavSheet.tsx` — remove the three `<RowLink>` entries (Templates, Industry packs, Themes & snippets). Keep Home, My projects, Gallery, New project.
- `src/components/SiteHeader.tsx` — remove Templates / Packs / Themes links in BOTH the signed-out and signed-in desktop nav clusters.
- `src/components/CommandPalette.tsx` — drop any palette entries pointing to `/templates`, `/packs`, `/themes`.
- Leave `src/routes/templates.tsx`, `packs.tsx`, `packs.$slug.tsx`, `themes.tsx` in place — reachable by direct URL for admin/debug; continue feeding Petal's intent layer.

## 2. Targeted edits without rewriting the whole file

Goal: "change the hero headline" patches one node, not the whole `index.tsx`.

In `src/routes/api/generate.ts` + `src/server/generate.server.ts`:
- Confirm the **search-replace / patch tool** is the default tool advertised in the system prompt for existing files, and **full-file rewrites are gated** behind "file is new" or "≥60% of lines change".
- Add a pre-flight classifier (reuse `quick-edit.ts`) that detects single-element edits (copy, color, prop tweak) and forces patch path with a 1-file scope cap.
- Add a guard that rejects a full-file rewrite when the diff would touch <20% of the file, and re-prompts the model to emit a patch.
- Log every "rewrite vs patch" decision to telemetry so we can measure and tune the ratio.

## 3. Long app-context memory (multi-turn, multi-session building)

Today Petal rebuilds context per turn from file tree + recent messages — long builds lose earlier decisions ("we picked terracotta", "auth uses magic links").

Plan (all on Petal Cloud + Petal AI Gateway — no external service needed):
- New table on **Petal Cloud**: `project_memory(project_id, kind, key, value, updated_at)` where `kind ∈ {decision, feature, constraint, dependency}`.
- After each successful turn, a small extractor on **Petal AI Gateway** (`google/gemini-3.1-flash-lite-preview`) reads the turn transcript and upserts new decisions/features/constraints.
- Every new turn prepends a compact "Project memory" block (~2k tokens cap) to the system prompt.
- Surface it in `ProjectSettingsSheet` as "What Petal remembers" so users can edit/forget items.

## 4. Stop "AI didn't return usable edits" at the source

We already removed the user-facing copy and re-routed the failing GPT-5 escalation. Remaining reliability work in `src/routes/api/generate.ts`:

a) **3-tier recovery ladder** (replace the current single retry/backup chain):
   primary model → structured-retry on Gemini 3 Pro → deterministic patch synthesizer (already exists — make it the always-on last resort).
   When the model emits a plan but no tool calls, re-prompt with the plan echoed back and "emit the patch tool now" instead of bailing.
   Treat every gateway HTTP 4xx/5xx as retryable on a different model, not a hard stop.

b) **Tool-call schema strictness:** validate every tool call with Zod before counting it as an edit. If invalid, repair-prompt once with the validator error — current code drops the whole turn.

c) **Telemetry-driven kill switch:** if a model's `no_edit_emitted` rate >5% over the last hour, auto-rotate it out of the primary slot (data already in `admin.failures` / `admin.pipeline.tsx`).

d) **User-visible contract:** if the ladder fully exhausts (target <0.1% of turns), Petal speaks naturally ("Let me try that differently — point me to the exact element?") and the turn is **not charged**. No red error card, ever.

## What we need externally

Nothing new. Everything runs on **Petal Cloud** + **Petal AI Gateway** + existing admin telemetry routes.

## Out of scope
- No changes to billing, auth, or publish flow.
- No removal of underlying templates/packs/themes routes — only menu entries.
- Server-side prompt files that talk to the agent itself keep their internal wording.
