# Golden-App Suite

End-to-end regression test for Petal's build pipeline.

Unlike `pipeline.test.ts` (which feeds frozen file fixtures into the verifier
for unit-level coverage), the golden suite runs the **full generation pipeline**
against a fixed set of natural-language prompts and grades the output:

1. Files were emitted (no truncation, no empty result)
2. Local verifier passed (esbuild + render-risk + RLS sanity)
3. esbuild bundles the project without error
4. tsc --noEmit on the changed files passes
5. (Optional) A smoke render via JSDOM does not throw

A per-app result is recorded with: pass / fail, which gate failed, token
usage, wall-clock, and a hash of the generated file tree. We compare against
a baseline manifest checked into the repo. **Any regression blocks release.**

This is the measurement system that lets us reason honestly about whether
pipeline changes (autofix consolidation, prompt tweaks, model swaps) make
things better or worse. Without it, every "improvement" is a guess.

## Apps in the suite

The 10 reference apps are listed in `prompts.ts`. Each is a single
natural-language prompt that an actual user would write — no scaffold hints,
no special instructions. They cover the pareto distribution of what people
build with us:

| # | App           | Primary surface tested                              |
|---|---------------|-----------------------------------------------------|
| 1 | Todo          | Basic CRUD, local state, list rendering             |
| 2 | Blog          | Multi-route, markdown, content                      |
| 3 | Chat          | Realtime, scrolling, optimistic UI                  |
| 4 | Dashboard     | Charts, layout, data viz                            |
| 5 | Marketplace   | Cards, filtering, detail routes                     |
| 6 | Auth + roles  | Cloud auth, user_roles table, RLS, has_role()       |
| 7 | File upload   | Cloud storage, file picker, bucket policies         |
| 8 | Realtime      | Cloud realtime subscriptions on a table             |
| 9 | Payments stub | Stripe enable flow, checkout button                 |
| 10| Email send    | Petal Email send, template, suppression handling    |

## Running

Locally (one app):
```bash
bun src/server/__tests__/golden-apps/run.ts --app=todo
```

All apps:
```bash
bun src/server/__tests__/golden-apps/run.ts
```

Update baseline (after intentional pipeline changes):
```bash
bun src/server/__tests__/golden-apps/run.ts --update-baseline
```

## What we deliberately do NOT test here

- Subjective UI quality. Use design review for that.
- Production deploys. The Railway builder has its own smoke tests.
- Cost. Token usage is recorded but not gated — model price changes upstream.
