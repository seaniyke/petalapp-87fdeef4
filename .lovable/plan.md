## Builder audit — Petal vs the top 5 AI app builders

Benchmarked against **Lovable, Bolt.new, v0 (Vercel), Replit Agent, Base44** (with Cursor as a code-fidelity reference). I read every relevant file under `src/server/`, `src/routes/api/generate.ts`, `src/routes/api/discuss.ts`, the WebContainer preview, and the builder UI. Petal is already strong on several axes — but four areas are clearly behind the field, and that's what this plan ships.

### What Petal already does well (do not touch)

- **Multi-tier safety pipeline**: triage → design director → smart-router model pick → stream-time autofixer → local verifier → continuation-on-truncation → post-stream autofix → Replit-style verifier → image resolver → self-check → memory writer. This is genuinely state-of-the-art; Lovable/Bolt do not publicly run this many gates.
- **Smart router with telemetry** (`src/server/smart-router.server.ts`) picks model per (feature, phase) from historical success — Base44/Lovable expose this as a manual dropdown only.
- **Project memory**, **design director**, **prerequisite gating** (10 categories of intent detection), **integration auto-suggest** with secret requests — at par or ahead.
- **Phase classifier + per-phase model tier**, **petal-image://** placeholder pipeline, **build → auto-fix loop** (2 free attempts on Petal's tab) — solid.

### Gaps vs competitors (ranked by impact on "power of the AI")


| #   | Capability                                                                                    | Petal today                                                                                                                                                                           | Top competitors                                                                                             | Gap                                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | **Agentic tool-loop** (multi-turn: read → think → write → verify → write again, autonomously) | Single tool call per turn (`write_project` or `patch_files`), then deterministic verifier passes                                                                                      | Replit Agent + Bolt + Cursor run a real ReAct loop with `read_file`, `search`, `write`, `run_command` tools | **Big** — limits power on multi-step refactors                                                             |
| 2   | **Visual edit ↔ source mapping**                                                              | Element picker exists in `webcontainer.ts` and posts `data-source-file` / `data-source-line` to chat — but the kit never **emits** those attributes, so the metadata is always `null` | Lovable, v0, Bolt all support click-to-edit with file pinpointing                                           | **Big** — picker is shipped but blind                                                                      |
| 3   | **Console / runtime error → "Fix with AI" loop**                                              | Build failures auto-fix; in-preview runtime errors are NOT surfaced as a fix button                                                                                                   | Bolt and Lovable both watch the iframe console and offer a one-click fix                                    | **Medium**                                                                                                 |
| 4   | **Reasoning model toggle**                                                                    | `pickSmartModel` picks pro for heavy keywords; no explicit "deep think" / extended-reasoning option exposed                                                                           | Replit Agent and Cursor expose an explicit "high effort" mode                                               | **Medium**                                                                                                 |
| 5   | **Inline diff preview before apply**                                                          | Patches apply directly; revert is per-message after the fact                                                                                                                          | v0 and Cursor show a diff + "accept/reject" before writing                                                  | **Small** (Petal's instant-apply is intentional, but a "preview changes" toggle would help on big patches) |
| 6   | **Long-context / repo search tool**                                                           | Full file context is dumped into every prompt                                                                                                                                         | Bolt/Replit give the agent a `search_files` tool so it can pull only what it needs                          | **Small now, big once apps get >40 files**                                                                 |


### What we ship in this plan

Six focused upgrades, ordered by leverage. Each is independently shippable and testable.

#### 1. Source-mapped visual editor (Pass A)

The picker already round-trips `data-source-file` / `data-source-line` to the chat composer — but no JSX emits them. Add a Vite plugin to the in-browser preview that injects `data-source-file="src/pages/Home.tsx"` / `data-source-line="42"` onto every JSX opener. When a user picks an element and types "make this red", Petal now gets `Source file: src/pages/Home.tsx:42` and can patch the **exact** node — not guess.

- Add `vite-plugin-petal-source` (tiny Babel/SWC visitor or runtime esbuild transform) injected in `scaffold-kit.ts`.
- Strip the attribute in production builds (only injected when `import.meta.env.DEV`).
- Keep the picker UI exactly as it is.

#### 2. Console-to-fix bridge

WebContainerPreview already proxies the iframe's console. Add a postMessage channel for `window.onerror` / `unhandledrejection`, surface a non-blocking toast in the builder ("React error in `Home.tsx` — fix with AI"), and pre-fill an autofix prompt with the stack frame + file. Reuse the existing `isAutoFix` free-charge path.

- New file: `src/lib/runtime-error-bridge.ts` (injected the same way the picker is).
- Builder shows a small banner above the composer with one button: **Fix this**.
- Free fix attempt counter shared with the build-failure auto-fix budget.

#### 3. Agentic tool loop for "deep" turns

Today `/api/generate` makes ONE model call and trusts whatever comes out. For non-trivial turns (phase = `feature` / `refactor`, or files > 12), upgrade to a bounded ReAct loop with three tools: `read_file(path)`, `search_files(query)`, and `patch_files(ops)`. Cap at 6 tool calls per turn, hard timeout at 90s, falls back to today's single-shot path if the loop errors.

- New file: `src/server/agent-loop.server.ts`.
- Routed by phase classifier — keep the fast single-shot path for `ui_tweak` / `new_component`.
- Stream tool calls as `{type:"tool_call", name, args}` SSE events so the UI can show "Reading `Header.tsx`…" in the activity card.
- Existing verifier/autofix tiers run unchanged after the loop.

#### 4. Reasoning effort surfacing

Add a third option to the existing model preset dropdown: **Fast / Smart / Deep think**. "Deep think" passes `reasoning: { effort: "high" }` to gpt-5 / gemini-2.5-pro, lets users opt into the highest-quality output for hard refactors.

- One field added to `Body.model` type (`"fast" | "smart" | "best" | "deep"`).
- `aiChatCompletions` already passes the body through; extend `resolveModel` and add the reasoning flag.

#### 5. Inline diff preview for big patches

When a `patch_files` op set touches >3 files OR rewrites a file >100 lines, hold the apply step and emit a `pending_diff` SSE event. UI renders a sheet listing changed files with accept-all / reject buttons. Auto-applies after 8 seconds if the user does nothing (so small power-users aren't slowed down).

- Build on top of existing `applyOps` — gate it behind a feature flag in `labs-flags`.

#### 6. Repo-search tool (foundation for #3)

Add `searchProjectFiles({ projectId, query, kind })` server function that does a fast ripgrep-equivalent over the project's files (already loaded into memory in the request). Used by #3's loop, also surfaceable in Discuss mode so Petal can answer "where is the cart total computed?" by citing files.

### Out of scope (acknowledged, not shipped here)

- **Branching / git checkpoints**: project_versions already gives revert. A full "branch this build" is a bigger UX shift — separate plan.
- **Multi-modal chat (video / Figma import)**: Petal handles image attachments. Figma import is its own ingest pipeline.
- **Background long-running agents** (Replit's "Agent runs while you sleep"): worth doing once #3 is stable; would build on the same loop primitive.

### Technical notes

- **Files added**: `src/server/agent-loop.server.ts`, `src/server/repo-search.server.ts`, `src/lib/runtime-error-bridge.ts`, a Vite plugin file under `scaffold-kit` for source attributes, a small `RuntimeErrorBanner.tsx` in components.
- **Files edited**: `src/routes/api/generate.ts` (route deep turns to the agent loop), `src/server/scaffold-kit.ts` (inject the new dev-only plugin and runtime-error script), `src/components/WebContainerPreview.tsx` (forward error postMessages), `src/routes/builder.tsx` (banner + diff sheet + Deep model option), `src/server/generate.server.ts` (extend tool list).
- **Telemetry**: every new path logs to the existing smart-router stats so we can A/B agent-loop vs single-shot on real traffic.
- **Backwards compatibility**: every gate is feature-flagged; existing turns still hit the proven single-shot path until we confirm wins.

### Order of work (single PR per item, in this order)

1. Source-mapped picker (highest UX win, smallest risk)
2. Reasoning effort toggle (1 file, 30 min)
3. Console-to-fix bridge
4. Repo-search server function
5. Agent loop (uses #4)
6. Inline diff preview (labs flag)

Approve and I'll ship #1 + #2 first so you have something visible immediately, then move down the list.