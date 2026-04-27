## Goal
Move Petal from "single-page tool builder" to "competitive general-purpose app builder" by closing the highest-leverage gaps vs Lovable, Bolt, and v0. Tackled in priority order — each phase ships independently and the user can stop after any one.

---

### Phase 1 — Vision input (biggest UX gap, ~half a day)
The composer already collects image attachments (`src/routes/index.tsx`, `src/routes/builder.tsx`) but they are dropped on the floor. Wire them through end-to-end.

- **`src/lib/stream.ts` & `src/lib/discuss.ts`**: extend the request body with `attachments: { mimeType: string; dataUrl: string }[]`. Convert files to base64 data URLs client-side (cap at 4 images, 4 MB each).
- **`src/routes/api/generate.ts` & `src/routes/api/discuss.ts`**: when attachments exist, build the latest user message in OpenAI multimodal format (`content: [{ type: "text", text }, { type: "image_url", image_url: { url } }]`) and force the model to `google/gemini-2.5-pro` (vision-capable) regardless of preset. Fall back to text-only if model rejects.
- **`src/routes/builder.tsx`**: pipe attachments from the composer + queue items into `streamGenerate`/`requestDiscussion`. Show thumbnails in the chat history so the user remembers what they sent.
- **System prompt addendum**: "If images are attached, treat them as design references — match layout, color, typography, and spacing as closely as kit components allow."

Result: users can paste a screenshot of any app/Figma and Petal recreates it.

---

### Phase 2 — Build-error auto-fix loop (kills the #1 frustration, ~half a day)
Today when the Cloudflare build fails (`src/routes/api/public/builds/callback.ts`), the user sees a red error and has to manually prompt "fix it". Lovable and Bolt automatically retry.

- New server action `autoFixBuild(projectId, buildId, errorLog)` triggered when a build callback arrives with `status: "failed"`.
- Sends a synthetic system message to `/api/generate` with the failing files + truncated error log + instruction "Fix this build error. Patch only the files needed."
- Caps at **2 auto-retry attempts** per user turn to prevent infinite loops / runaway spend.
- Surfaces in `BuildActivityCard` as "Petal is fixing a build error… (attempt 1/2)" so the user sees what's happening.

Result: most Tailwind/TS typos self-heal silently before the user notices.

---

### Phase 3 — Add 6 critical kit components (~half a day)
Adds these to `src/server/scaffold-kit.ts` so the AI can compose richer apps:
1. **Command / CommandPalette** (cmdk) — required for any search-driven UI
2. **Calendar / DatePicker** (react-day-picker, already in deps)
3. **Combobox** (Command + Popover composition)
4. **Form** (react-hook-form + zod resolver wrapper)
5. **Drawer** (vaul) — mobile-friendly Sheet
6. **Chart** (recharts wrapper with theming)

Update `SYSTEM_PROMPT_INITIAL` and `SYSTEM_PROMPT_PATCH` to list them. Add 2-3 new entries to `examples-pack.ts` showing typical usage (search-everywhere palette, form with zod validation, sales chart card).

Result: AI stops hand-rolling broken date pickers and search boxes.

---

### Phase 4 — AI image generation for placeholders (~3 hours)
Right now the AI uses `https://images.unsplash.com/...` random photos that often 404 or look generic. Lovable uses Gemini/Imagen for hero images.

- New server endpoint `/api/generate-image` calling `google/gemini-3-pro-image-preview` via the existing Lovable AI gateway (no new key needed — already supported).
- Add a tool function `generate_image(prompt, aspect_ratio)` available during `write_project` / `patch_files` calls. AI emits placeholder URLs like `petal://img/hero-1`; server resolves them to data URLs or uploads to a `project-assets` Supabase bucket and rewrites paths in emitted files.
- Update system prompt: "For hero/feature illustrations, call generate_image instead of using stock URLs."

Result: every generated app gets cohesive on-brand imagery.

---

### Phase 5 — Multi-page apps via React Router (~1 day, larger lift)
Single `src/App.tsx` is the hard ceiling on app sophistication. Add a router to the scaffold so the AI can build blogs, marketplaces, admin + user portals.

- Inject `react-router-dom` v6 into scaffold, plus `src/router.tsx` and an updated `src/main.tsx` wrapping `<RouterProvider>`.
- Convention: pages live at `src/pages/<name>.tsx` and are auto-registered by a generated `src/pages.gen.ts` that the scaffold maintains (similar to TanStack's flat routing).
- Update both system prompts with the routing convention + a new rule: "When the user asks for multiple pages, create files under `src/pages/`. The router auto-picks them up."
- Add example: `examples/multi-page-blog.tsx` showing layout + nested routes.

Result: Petal can build real multi-page products, not just single-screen tools.

---

### Out of scope for this plan (separate future work)
- **Element picker reliability** — current `WebContainerPreview` picker is shaky; needs its own debugging pass.
- **RAG / large-codebase support** — only matters once apps regularly exceed 30 files; revisit after Phase 5.
- **Voice input, generated tests, one-click connectors** — lower ROI right now.
- **Managed Supabase auto-provisioning** — separate billing/infra workstream.

---

### Recommended order
**Phase 1 (vision) → Phase 2 (auto-fix) → Phase 3 (kit) → Phase 4 (images) → Phase 5 (router)**

Phases 1, 2, 3 each take ≤ half a day and deliver the biggest perceived quality jumps. Phase 5 is the largest lift and should only happen once the first three are stable.

Want me to start with Phase 1 (vision input), or pick a different order?