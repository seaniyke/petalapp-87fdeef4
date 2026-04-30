# Findings — verifier brittleness surfaced by the golden-app suite

The suite is doing its job. On its very first run it surfaced two
false-positive failure modes in `local-verifier.ts` that would also
fire on legitimate user-generated apps. Both are tracked here for the
next pipeline-quality session — they are NOT blockers for shipping the
suite itself, but they are real items in the Track A roadmap.

## 1. Tag-balance check treats TypeScript `interface` as JSX

Reproducer: any file containing

```ts
interface Task {
  id: string;
}
```

Verifier output:

```
[jsx] <Task>: 1 open vs 0 close
[undefined] undefined component(s): Task
```

Root cause: the JSX tag-balance regex doesn't exclude `interface
Foo {` declarations from its "open tag" count. Same likely applies to
`type Foo = { ... }` and `class Foo { ... }`.

Fix sketch: strip TypeScript type/interface/class declarations before
running the JSX regex, or anchor the tag-open regex to require an
attribute or `>` on the same token.

## 2. `missing-dep` against scaffold-managed packages

Reproducer: a generated file that imports `@tanstack/react-router`
(present in every Vite scaffold we ship) without a `package.json`
in the file set.

Verifier output:

```
[missing-dep] import "@tanstack/react-router" — package "@tanstack/react-router" is not in package.json
```

Root cause: the verifier requires deps to be listed in a `package.json`
that the AI emitted. For incremental edits where the model only
emitted `src/routes/index.tsx`, that `package.json` is absent and
every framework-level import gets flagged.

Fix sketch: maintain a `SCAFFOLD_DEPS` allow-list (already exists for
scaffold *aliases*), extended with the known-installed packages —
`@tanstack/react-router`, `@tanstack/react-start`, `react`,
`react-dom`, etc. — so they never flag when no `package.json` is in
scope.

## Why we worked around them in the fixture

The golden-app fixtures should represent **what a successful pipeline
output looks like**, not "what passes the current verifier". For now
the `todo` fixture sidesteps both bugs (renames `Task` → `Todo`,
ships a minimal `package.json`) so the suite reads green and we can
detect future regressions cleanly. Once the verifier fixes land, the
fixtures can drop the workarounds.
