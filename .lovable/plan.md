# Hide the model picker — always route to Smart

## Why

Users shouldn't be picking AI models — they don't know which one is right, and exposing the choice creates decision friction (and, as you saw, awkward overlapping menus on mobile). The "Smart" preset already does the right thing: it picks `google/gemini-2.5-pro` for big/complex changes and `google/gemini-2.5-flash` for small ones, automatically (logic lives in `pickSmartModel()` in `src/routes/api/generate.ts`).

So the fix is to **lock the preset to "smart" permanently and remove the picker from the UI**. No backend changes needed — `/api/generate` already accepts and respects the preset.

## Changes

**File: `src/routes/builder.tsx`**

1. Remove the `modelPreset` state, the `useEffect` that persists it to localStorage, and the import of `Zap`/`Crown`/`Gauge`/`ChevronDown` icons (if not used elsewhere).
2. Hardcode `preset: "smart"` in the `streamGenerate` call(s) where `modelPreset` is currently passed.
3. Delete the entire DropdownMenu block (lines ~1135–1180) that renders the Smart/Fast/Best picker.
4. Keep the `Build / Discuss` toggle next to where the picker used to be — that one's a meaningful user choice and should stay.

**No other files need changes.** The backend (`src/routes/api/generate.ts`) already defaults to "smart" routing if no preset is sent, so this is purely a UI cleanup.

## What stays the same

- Smart auto-routing logic in `pickSmartModel()` — untouched.
- Build/Discuss mode toggle — untouched.
- Everything else in the builder UI — untouched.

## Out of scope (but worth a future conversation)

The bigger architectural question you raised — *should Petal pre-install Tailwind + shadcn in the scaffold so generated apps look as polished as Lovable's?* — is a separate, larger change that would touch `SYSTEM_PROMPT_INITIAL`, the scaffold's `package.json`, and `WebContainerPreview.tsx`. Worth doing, but as its own focused task once you decide.
