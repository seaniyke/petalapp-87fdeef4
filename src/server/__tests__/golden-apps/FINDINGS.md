# Findings — verifier brittleness surfaced by the golden-app suite

The suite did its job. On its very first run it surfaced **three**
false-positive failure modes in `local-verifier.ts` that would also
fire on legitimate user-generated apps. **All three are now fixed**
with regression tests in `src/server/__tests__/local-verifier.test.ts`.

This file remains as a record of what we found and how we fixed it.

## 1. Tag-balance check treated `useState<Todo>(…)` and similar TS generics as JSX ✅ FIXED

Reproducer:
```ts
const [items, setItems] = useState<Todo>(initial);
const map = new Map<string, Todo>();
```
Old verifier output: `<Todo>: 1 open vs 0 close` + `undefined component(s): Todo`.

Root cause: `<Identifier>` is ambiguous between JSX and TS generics. The
old regex couldn't distinguish them.

**Fix:** rewrote `jsxTagBalance` and `findUndefinedComponents` to look
at the character preceding `<`. If it's an identifier-char, `]`, or
`)`, the `<` opens a TS generic and is skipped. JSX is preceded by
`(`, `{`, `,`, `=`, `?`, `:`, `>`, whitespace at start-of-line, etc.

## 2. Self-closing JSX with `=>` arrow-fn props was miscounted ✅ FIXED

Reproducer:
```tsx
<Input value={x} onChange={(e) => setX(e.target.value)} />
```
Old verifier output: unbalanced `<Input>` because the regex `[^<>]*\/>`
stopped at the `>` inside `=>`.

Root cause: regex-based attribute parsing can't model `{}`-balanced
expression containers.

**Fix:** rewrote `jsxTagBalance` as a small character-by-character
walker that tracks `{}` depth so attribute expressions can hold any
chars. Self-closing tags (`/>`) and balanced tags (`<X>…</X>`) are now
identified accurately.

## 3. `missing-dep` against framework packages with no `package.json` in scope ✅ FIXED

Reproducer: a generated file imports `@tanstack/react-router` while
the AI only emits `src/routes/index.tsx` (no `package.json` in the
write set).

**Fix:** `findUnresolvedImports` now keeps a `SCAFFOLD_DEPS` allow-list
of known-installed framework packages (`@tanstack/react-router`,
`@tanstack/react-start`, `@supabase/supabase-js`, `zod`, `clsx`,
`tailwind-merge`, `lucide-react`, `framer-motion`, `sonner`,
`date-fns`, common `@radix-ui/*`). The allow-list is consulted **only
when no `package.json` is present in the write set** — when the AI
emits one, we trust its dependency list and surface real
`missing-dep` issues.

## Regression tests

See `src/server/__tests__/local-verifier.test.ts` for the targeted
assertions covering each scenario, including a sanity test that a
genuinely unbalanced JSX file still fails. Run with:

```
bun src/server/__tests__/local-verifier.test.ts
```

All 7 assertions pass; the existing pipeline test suite (17 fixtures)
remains green.

## Next move for the todo fixture

The current `fixtures/todo/files.json` was deliberately written to
sidestep all three bugs (native `<input>`, inline types, ships
`package.json`). Now that the verifier is correct, the fixture should
be rewritten to use idiomatic shadcn primitives (`<Input />`,
`<Button />`), a `Todo` interface, and **omit** `package.json` — that
is the realistic shape of a single-route generation, and we want the
suite to certify the verifier accepts it.
