# Phase 1 — Token Optimization (Cost + Speed, Zero Quality Risk)

This is the safe, high-ROI slice of the original prompt. It does NOT change models, does NOT change which files are sent, does NOT cap output size, and does NOT touch the generator's behavior. It only reshapes *how* we send context so OpenRouter/Anthropic/Gemini can cache it, and it gives us the metrics to prove the wins (and detect regressions later).

Expected impact (typical chat-iteration session):
- 30–50% cost cut from prompt caching alone (static prefix billed at ~10–25% rate on cache hits across OpenAI/Anthropic/Gemini).
- Lower TTFB on chat edits because cached prefixes skip prefill.
- Full visibility into tokens / cost / cache-hit per request.

Out of scope (deferred until we have metrics to justify them): file targeting, history summarization, model routing, Claude-as-repair-only, 1–2 file output cap, incremental generation.

---

## 1. Restructure the prompt into STATIC PREFIX + DYNAMIC SUFFIX

In `src/routes/api/generate.ts` (and the discuss pipeline), split the assembled prompt into two clean halves:

**Static prefix (identical across requests for the same project + target):**
1. System instructions (Petal core rules, design quality block, build-target hard-constraint block)
2. Project architecture summary (see §2)
3. File tree (paths only, no contents)
4. Dependency map (`package.json` deps + versions)

**Dynamic suffix (changes every turn):**
1. Recent chat turns
2. Current user request
3. The specific files the existing pipeline already chose to include
4. Any tool-call results / repair context

Rules:
- The static prefix must be **byte-for-byte identical** across consecutive requests in a session. No timestamps, no random ordering, no per-request IDs interpolated into it.
- Order matters for caching: prefix first, suffix last. Never interleave.

## 2. Lightweight project memory (architecture summary)

Persist a small JSON blob per project (new table `project_memory` or a column on `projects` — pick whichever is one migration):

```
{
  routes: string[],          // from src/routes/ scan
  components: string[],      // top-level src/components/ entries
  dependencies: Record<string,string>, // from package.json
  designTokens: string,      // extracted from src/styles.css :root block
  buildTarget: 'web'|'mobile'|'backend'|'extension'|'web-mobile'
}
```

- Built once at project create, refreshed when `package.json`, `src/styles.css`, `src/routes/`, or `src/components/` change (debounced — recompute on save, not on every keystroke).
- Serialized into the static prefix as a compact markdown block.
- Replaces ad-hoc "here's your file tree" blocks that currently get re-stringified per request.

This is the "architecture memory separate from chat history" piece from the original prompt — kept minimal so we don't over-engineer.

## 3. Wire provider-specific cache hints

OpenRouter passes through to the underlying provider. Add cache markers on the static prefix only:

- **Anthropic (Claude):** add `cache_control: { type: "ephemeral" }` on the final system block of the static prefix.
- **Gemini (via OpenRouter):** Gemini auto-caches on prefix match for prompts >1024 tokens — guaranteed by keeping the prefix stable (no extra header needed, but verify with a logged response).
- **OpenAI:** auto prompt-caching on prefix match ≥1024 tokens — same requirement: stable prefix.

Add a thin `attachCacheHints(messages, model)` helper so this lives in one place.

## 4. Metrics (so we can prove it works, and catch regressions)

New table `generation_metrics` (or extend existing logs if present):

```
request_id, project_id, user_id, created_at,
model, stage,                       // 'plan' | 'generate' | 'repair' | 'discuss'
prompt_tokens, completion_tokens,
cached_prompt_tokens,               // from provider response when available
cost_usd,                           // computed from per-model price table
context_chars, files_sent,
duration_ms, status                 // 'ok'|'error'|'aborted'
```

- Populated server-side from the OpenRouter response (`usage` + `usage.prompt_tokens_details.cached_tokens` for OpenAI/Anthropic; Gemini exposes `cachedContentTokenCount`).
- Tiny admin route `/api/admin/metrics/summary` returning rolling 24h aggregates: avg cost/request, cache-hit %, p50/p95 latency, per-model split.
- No UI yet — psql / a single read-only page is fine.

## 5. Verification

Before/after on the same scripted scenario:
1. Create a fresh project, send 5 sequential small edits ("change heading color", "rename button", etc.).
2. Compare total `prompt_tokens` vs `cached_prompt_tokens` across the 5 requests.
3. Success criterion: ≥60% of prefix tokens cached on requests 2–5 for at least one provider; total $ for the session down ≥30% vs current baseline.

If we don't see the cache hits, the prefix isn't stable — fix that before moving on. No further phases until this works.

---

## Technical notes

- `src/routes/api/generate.ts` is 3,287 lines and already has multiple model constants (`MODEL_FAST`, `MODEL_BEST`, `MODEL_VISION`, structured-retry tier) — leave those alone in Phase 1.
- Static prefix assembly should be a new `buildStaticPrefix(project, target)` function with a content hash logged per request so we can spot accidental drift.
- Cost table: keep a single `MODEL_PRICES` map (input / cached-input / output ¢ per 1M tokens) updated from OpenRouter's published pricing.
- Migration runs through the standard supabase migration tool.
- No edits to the generator's output behavior, no changes to which files the existing pipeline selects, no model swaps. Anything that could change generation quality is deferred.

## What we are explicitly NOT doing in Phase 1

- File targeting / "only send affected files"
- Chat history summarization
- Model routing (Flash Lite for classify, Claude for repair-only, etc.)
- 1–2 file output cap
- Incremental file-by-file generation

These remain on the table for Phase 2, but only after Phase 1 metrics show where the remaining cost actually is. We're not guessing.
