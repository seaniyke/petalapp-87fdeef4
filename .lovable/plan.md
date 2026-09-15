# Never forget: make Petal's memory guaranteed, not best-effort

## What exists today

Petal's continuity across turns already rests on six server-side layers: the project's actual files, the project understanding (PIC + PRD, versioned with history), key/value project memory, per-edit history with change sets and undo pointers, conversation focus, and the full chat transcript. Nothing lives in the browser.

## The gaps

1. **Memory writes can vanish.** The memory writer runs fire-and-forget after the reply is sent (`void updateProjectMemory(...)` in generate.ts). If the worker ends when the response ends, that turn's lessons never reach the database.
2. **Facts are silently dropped.** Memory is capped at 30 keys; overflow deletes the oldest-updated rows with no record they ever existed.
3. **The writer under-records by design.** "An empty plan is a great answer" means many stable facts (names, preferences, repeated requirements) are never stored in the first place.

## The fix

### 1. Durable memory outbox
Before the turn finishes, persist the writer's *input* (user message, reply summary) onto the turn record (a `pending_memory` jsonb column on `turns`, or reuse `project_turn_completion`). The existing turn-resume cron already sweeps unfinished work every 5 minutes — it gains a step: process pending memory writes, mark done. Fire-and-forget becomes write-then-process, so a dead worker can't take the memory with it. The post-turn inline attempt stays for speed; the outbox is the guarantee.

### 2. Nothing is ever deleted
When the 30-key cap trims, merge trimmed facts into the rolling `notes` digest entry (existing suggested key) instead of deleting them. Cap the digest length; keep it append-and-condense, never drop.

### 3. Less conservative writer, same cost
Adjust the writer's instructions: record any *stable* fact the user stated or confirmed (names, audience, tone, hard requirements, rejections) — empty plans only for pure greetings/status chatter. Same cheap model, same tool, same 6-upsert/3-delete limits. No new AI spend per turn.

### 4. Memory honoured, not just stored
The edit audit (change-set completeness check) already lists what must land. Extend it: when memory carries `must_have` or `dont_do` entries, treat violations of them as audit findings — so remembered constraints are enforced, not just recalled.

## What does not change

- No redesign, no rebuild, no architecture replacement — this extends the existing memory module, generate flow, and resume cron.
- No new AI model spend beyond the single cheap writer call that already exists.
- No pricing, billing, deployment, or UI changes. The one schema addition is a nullable column on an existing table.
- The PIC, PRD, edit history, focus, and chat layers stay exactly as they are.

## Verification

- Unit tests: outbox write happens before turn end; cron processes pending entries; trim merges into digest instead of deleting; writer prompt change still returns valid merge plans; dont_do violations surface in the audit.
- Type check + full test suite.
- One live turn in the preview: state a fact ("our brand colour is forest green, never use purple"), confirm it's stored, then a later edit and confirm the constraint is honoured and appears in the audit if violated.
