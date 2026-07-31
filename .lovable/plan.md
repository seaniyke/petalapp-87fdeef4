# Petal Agent Tools: inspection, codemods, and subagents

Give Petal the two things competitors have that Petal doesn't: an **execution surface** (real commands over the project files) and **subagents** (cheap read-only investigators that produce a diagnosis before the expensive model edits anything).

## Why this matters

Today Petal fixes code one way: send the model some files, get whole files back, apply them. That's why a stray `\n` needed a hand-written repair pass, and why big projects blow the context budget — the model can never *look around*, it can only be shown things.

Everything below is additive. The existing repair passes, verifiers, and bounded agent loop stay exactly as they are; the new tools give the model a cheaper, more precise path before those fallbacks kick in.

## What gets built

### 1. Execution surface (builder side)

Petal's app runs on Cloudflare Workers, which has no processes — no `rg`, no `python3`, no `cd`. The Railway builder is real Node and already materializes every project to disk for each build. That's where commands belong.

New endpoint on the builder: `POST /exec`. Same HMAC signing as `/build`. Takes the project files plus a list of commands, materializes to a temp dir, runs them, returns stdout/stderr/exit code and any files that changed.

Hard limits, non-negotiable:

```text
allowlist      ls, cat, rg, sed -n, node, python3   (no network, no installs)
timeout        20s per command, 60s per session
output cap     32 KB per command, truncated with a marker
writes         only inside the session temp dir
concurrency    separate slot pool from builds, so inspection never starves a deploy
```

Two run modes:
- **inspect** — read-only, nothing written back. Used by subagents.
- **codemod** — a `node`/`python3` script may rewrite files; changed files come back and go through the normal repair + verifier gates before anything is saved.

### 2. Tools the model can call

Petal's model calls already support tool-calling; today only one tool is wired. Add a small, sharp set:

| Tool | Purpose |
| --- | --- |
| `list_dir` | See the file tree without paying for its contents |
| `read_file` | Read one file (or a line range) on demand |
| `search_files` | ripgrep across the project |
| `run_script` | Write a Node/Python codemod for repetitive mechanical edits |
| `run_check` | Re-run the local + esbuild verifiers and read the errors |

`run_script` and `run_check` are the ones that change outcomes: a rename across 40 files becomes one script instead of 40 file rewrites, and the model can confirm its own fix worked before the turn ends.

### 3. Subagents

An **Inspector** subagent: read-only tools, cheap model (the existing budget tier), its own context. Given a symptom — a build error, a vague user report — it explores and returns a short diagnosis naming files and line numbers. Only that diagnosis enters the main turn's context, not the fifty files it read.

Where it runs:
- Before an auto-fix, when the build error doesn't map cleanly to a file.
- Before a targeted edit, when the edit-intent resolver finds no confident anchor.
- On demand, when the user asks a question about their project rather than requesting a change.

Bounded like everything else: 8 tool calls, 45s, one subagent per turn.

### 4. Timeline

Tool calls stream into the existing build timeline as their own rows, the way the reference screenshots show: `Searched for "createCheckout" — 3 matches`, `Ran script — updated 12 files`, `Inspected cron auth`. Expandable to the actual command and its output. This reuses the `BuildDetailsSheet` timeline that already exists.

## Billing

Unchanged rules, applied to the new surface:
- Tool calls inside a user-initiated turn fold into that turn's single charge, same as the agent-loop cycles do now.
- Inspector subagents run on the budget model tier and are folded in the same way.
- Auto-fix turns for Petal's own broken builds stay free.
- `/exec` compute is Petal's cost, not metered to the user.

## Order of work

1. Builder `/exec` endpoint with the allowlist, timeouts, and its own slot pool.
2. Worker-side client for it, plus the tool definitions and the tool-call loop.
3. Inspector subagent and the three places it gets invoked.
4. Timeline rows for tool calls.
5. Fold `run_check` into the existing agent loop so cycles converge on verified evidence instead of a re-scan.

Steps 1–2 are the foundation and are worth shipping alone; 3–5 build on them.

## Technical notes

- `/exec` reuses `builder/src/signing.ts` and the `materializeProject` / `cleanupProject` helpers already in `builder/src/fs-helpers.ts`.
- Commands run with `spawn` and no shell, argv arrays only, so there is no shell injection surface. The allowlist is checked against argv[0] after normalization.
- The session temp dir is created under the builder's existing build root and removed in a `finally`, same as `runBuild`.
- Tool results are capped and summarized before entering model context; raw output goes to the timeline only.
- Files returned from a codemod run through `runAllRepairs` and both verifiers before being written to the project — a script can never bypass the safety gates.
- Petal's Cloudflare Worker never gains process access; all execution stays behind the signed builder boundary.
