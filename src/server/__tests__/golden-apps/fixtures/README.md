# Recorded fixtures

Each subdirectory matches an app ID in `prompts.ts` and contains
`files.json` — the recorded output of running the pipeline against that
prompt. Shape:

```json
{
  "files": [
    { "path": "src/routes/index.tsx", "content": "..." }
  ],
  "changedPaths": ["src/routes/index.tsx"]
}
```

If `changedPaths` is omitted, every file is treated as changed.

## When to refresh a fixture

Refresh **only when a pipeline change is intentional** and you want the
new output to become the new baseline. Workflow:

1. Run the live pipeline for the app you're refreshing (currently a
   manual step — point the generator at the prompt from
   `prompts.ts`).
2. Save the resulting file tree as `files.json` in this folder.
3. Run `bun src/server/__tests__/golden-apps/run.ts --app=<id>`
   and confirm the gates pass.
4. Commit the fixture together with the pipeline change.

We do not auto-record on every CI run because each refresh costs real
Lovable AI tokens and needs human review of the output. A future
`--record` flag may automate this once we have credit budgeting in
place.

## Why we don't call the live model in CI

See the comment at the top of `replay.ts`. Short version: cost,
determinism, and env coupling. Replay catches the regressions that
matter (verifier, scaffold, esbuild, types). Model quality is reviewed
when we update prompts.
