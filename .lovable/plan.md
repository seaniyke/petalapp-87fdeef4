## You're right — I had this completely wrong

I was telling Petal AI to recommend **"Lovable Cloud"** to your users. That's a competitor's brand bleeding into your product. Petal has **its own cloud services** (Petal Cloud) and **its own AI gateway** (Petal AI Gateway), and your users should never see the word "Lovable" in any AI response.

Two real leaks made it into prompts that go to your end-users' AI:

1. **Discuss-mode prompt** (`src/routes/api/discuss.ts`) — written by me last turn — says "Lovable Cloud" 5+ times.
2. **Build-mode prompt** (`src/server/generate.server.ts`) — says "Lovable AI Gateway" twice (lines 108, 213).

Everywhere else, "Lovable" only appears in code comments (not sent to the AI) — those are safe to leave.

## The fix

### 1. `src/routes/api/discuss.ts` — Discuss-mode system prompt

Replace every "Lovable Cloud" → **"Petal Cloud"**, and tighten the brand rules so the model can never substitute Lovable, Supabase, Firebase, or any other third-party name.

The capabilities section becomes:

- **Petal Cloud** — Petal's managed backend (user accounts with email + Google sign-in, Postgres database, file storage, serverless functions). One click to enable inside Petal. The user does NOT install Supabase, Firebase, or any third-party backend.
- **Petal AI Gateway** — call modern AI models without bringing an API key.
- Custom domains, publishing, SEO, analytics, email, payments — all native Petal features.

Brand rules become hard prohibitions:

- ALWAYS call the backend **"Petal Cloud"** or just **"the backend"**. NEVER say "Lovable", "Lovable Cloud", "Supabase", "Firebase", or any other vendor name.
- NEVER tell the user to "install" a backend or sign up for another platform. The correct phrasing is "I'll turn on **Petal Cloud** for you" (or "Petal Cloud is already on, we're good to go").
- NEVER mention dashboards, project refs, API keys, or any internal plumbing.

The live status block becomes:

- Backend attached → "**Petal Cloud is ON for this project** … never mention Lovable, Supabase, Firebase, project refs, dashboards, or API keys."
- Backend not attached → "**Petal Cloud is NOT yet on for this project** … I'll turn on Petal Cloud for you, one click inside Petal, no third-party account needed."

### 2. `src/server/generate.server.ts` — Build-mode system prompt

Two surgical edits:

- Line 108: "Lovable AI Gateway" → **"Petal AI Gateway"**
- Line 213: "Lovable AI Gateway" → **"Petal AI Gateway"**

### 3. Sweep for any remaining brand leaks in AI-bound text

After the edits, run a final `rg "Lovable"` scoped to prompt strings (excluding code comments and import paths) to confirm zero leaks before handing back to you.

## What I'm NOT changing

- Code comments that mention "Lovable" for developer context (not sent to the AI) — left alone, they're internal documentation.
- Import paths and package names like `@/integrations/supabase/*` — those are real file paths, the AI never sees them as brand text.
- Petal's *own* internal docs / billing copy aimed at *you* (the workspace owner) — out of scope here; this plan is strictly about what end-users' AI says back to them.

## Why this happened

The original Discuss prompt had no awareness of Petal's native capabilities at all, so the model fell back on its training data and recommended Supabase. When I patched it, I reflexively used "Lovable Cloud" wording from internal docs instead of **Petal Cloud**, which is your actual product. That was the wrong instinct and I should have caught it. This plan corrects it everywhere it touches end-user output.

Approve and I'll apply all three edits in one pass and verify the sweep is clean.
