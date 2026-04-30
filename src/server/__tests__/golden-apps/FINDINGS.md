# Findings — verifier brittleness surfaced by the golden-app suite

The suite is doing its job. On its very first run it surfaced **three**
false-positive failure modes in `local-verifier.ts` that would also
fire on legitimate user-generated apps. None block the suite itself,
but every one is a real Track A roadmap item — each represents a class
of valid app that today's pipeline would reject or auto-"fix" into a
worse state.

## 1. Tag-balance check treats `interface Foo { … }` and `type Foo = { … }` as JSX

Reproducer (any of these):
```ts
interface Todo { id: string; }
type TodoItem = { id: string; };
```
Verifier output: `<Todo>: 1 open vs 0 close` + `undefined component(s): Todo`.

Root cause: the JSX tag-open regex doesn't exclude TypeScript
declarations whose name starts with a capital. **Critical**, because
PascalCase types are the TypeScript norm.

## 2. Self-closing JSX tags are counted as "open" with no close

Reproducer:
```tsx
<Input value={x} />
```
Verifier output: `<Input>: 1 open vs 0 close`.

Root cause: the regex doesn't recognize `/>` as a self-closer. **The
single most damaging bug** — every shadcn primitive is used self-
closing. Today this triggers an autofix loop on most generations.

## 3. `missing-dep` against framework packages with no `package.json` in scope

Reproducer: a generated file imports `@tanstack/react-router` while
the AI only emits `src/routes/index.tsx` (no `package.json` in the
write set).

Fix: a `SCAFFOLD_DEPS` allow-list for known-installed framework deps,
applied when no `package.json` is present in the file set.

## Why the `todo` fixture works around all three

The fixture uses native `<input>`/`<button>` elements (sidesteps #2),
an inline object type (sidesteps #1), and ships a `package.json`
(sidesteps #3). It represents a **passing baseline**, not "what the
verifier should accept" — the moment any of the three bugs is fixed,
the fixture should be rewritten to use the more idiomatic shape.
