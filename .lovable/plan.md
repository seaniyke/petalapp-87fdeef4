# Phase 7 — Tailwind token sweep

## Goal

Kill the silent "invisible component" failure mode where generated `.tsx` uses a Tailwind utility like `bg-brand`, `text-accent-2`, `border-ring-strong`, or `bg-[hsl(var(--surface-elevated))]` but the underlying CSS token was never added to `src/styles.css`. Tailwind v4 emits nothing for unknown tokens, so the element renders transparent/borderless and the page looks half-broken.

This is a deterministic, pure repair pass — same shape as Phases 4–6 (`ProjectFile[] → ProjectFile[]`, no I/O, sub-5ms per file, wired into `runAllRepairs`).

## New file: `src/server/tailwind-token-sweep.server.ts`

### Step 1 — Parse `src/styles.css`

Extract two sets:
- **Raw vars**: every `--name: value` declared in any `:root`, `.dark`, or top-level rule. These back arbitrary-value classes like `bg-[hsl(var(--name))]`.
- **Theme vars**: every `--color-X`, `--font-X`, `--radius-X`, `--shadow-X` inside `@theme` / `@theme inline` blocks. These back the named utilities (`bg-X`, `text-X`, `font-X`, `rounded-X`, `shadow-X`).

Derive the **known utility token set** = strip `--color-` / `--font-` / etc. prefixes from theme vars.

### Step 2 — Scan `.tsx` / `.jsx` for token references

Two patterns:
1. **Named utility**: regex over `className="…"` / `className={…}` / `cn(…)` / `clsx(…)` string literals. Match `(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|placeholder|accent|caret|shadow)-([a-z][a-z0-9-]*)` and `font-([a-z][a-z0-9-]*)`. Filter out Tailwind built-ins (red-500, white, black, transparent, current, inherit, primary-only-when-defined, etc.) — keep a denylist of always-valid Tailwind core tokens so we only flag custom/semantic ones.
2. **Arbitrary value**: match `\[[^\]]*var\(--([a-z][a-z0-9-]*)\)[^\]]*\]`.

### Step 3 — Diff and repair

For each referenced token NOT in the known set:

- **Named utility** unknown token → inject `--color-<name>: <derived>;` into `@theme inline` block (creating one if missing), AND inject `--<name>: <derived value>;` into both `:root` and `.dark` blocks.
- **Arbitrary var** unknown raw var → inject `--<name>: <derived>;` into `:root` and `.dark`.

**Derived value strategy** (no model call):
- If the token name contains `foreground` / `text` / `fg` → derive from `--foreground` (or a contrasting fallback).
- If it contains `muted` / `subtle` / `soft` → derive from `--muted` / `--muted-foreground`.
- If it contains `accent` / `brand` / `primary` / `cta` → derive from `--primary`.
- If it contains `border` / `ring` / `outline` / `divide` → derive from `--border`.
- If it contains `surface` / `card` / `panel` / `elevated` → derive from `--card` / `--background`.
- If it contains `destructive` / `danger` / `error` → derive from `--destructive`.
- Else → fall back to `--foreground` (visible) for text-family, `--muted` for everything else.

Derivation is a `var(--existing-token)` reference, so theme switches still work.

### Step 4 — Result + notes

Return `{ files, notes, addedTokens, addedThemeMappings }` and add to `runAllRepairs` as **step 7**, AFTER bare-import-resolver (Tailwind classes don't appear in import graph, so order vs other passes is independent — placing last keeps the cycle predictable).

## Safety rules

- Only edit `src/styles.css`. Never edit a `.tsx` (don't rewrite the model's class names — they were a deliberate signal).
- Do not touch existing tokens. Only **add** missing ones.
- If `src/styles.css` is missing entirely, skip silently (other passes handle that).
- Skip tokens that look like Tailwind core (numbered scale `gray-500`, opacity `white/50`, etc.).
- Skip dynamic class fragments where the value side is a JS expression — we only see string literals.

## Edge cases handled

- `bg-brand/40` → token is `brand`, opacity modifier is fine.
- `text-accent-foreground` → multi-segment token, treat the whole thing as one name.
- `bg-[hsl(var(--surface))]` → raw var path, inject only the raw var.
- Class lists assembled with `cn("bg-card", isOpen && "bg-card-hover")` → both literals are captured.
- Tokens already in `@theme` (not `@theme inline`) — recognize both block styles.

## Integration

- New file: `src/server/tailwind-token-sweep.server.ts` exporting `sweepTailwindTokens(files: ProjectFile[]): { files, notes, addedTokens, addedThemeMappings }`.
- Edit `src/server/repair-all.server.ts`: import + run as step 7, append notes.
- Edit `.lovable/plan.md`: mark Phase 7 ✅ shipped, document the derivation strategy.

## Out of scope (deferred)

- Tailwind config v3 fallback (project is v4 — see `tailwind4-authoring`).
- Font tokens beyond detection (`font-display` etc. get a stub var; we don't auto-inject `<link>` tags — that's the responsibility of the model when it picks a custom font).
- `@source inline()` safelist generation for runtime-assembled classes — Phase 7 only repairs literal references.

Exit criterion: zero "invisible block" white-screens caused by missing semantic tokens in generated apps.