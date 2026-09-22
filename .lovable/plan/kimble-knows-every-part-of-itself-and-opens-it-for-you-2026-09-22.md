# Kimble knows every part of itself — and opens it for you

Today Kimble reads a message for *app-building* intent (needs a database, needs
uploads, mentions payments) and acts on it. It does not read a message for
*product* intent — "I want a domain", "where do my users sign in?", "how many
credits have I used?" — so it answers like an assistant describing a product
instead of the owner of it, and the user still has to hunt for the panel.

This makes Kimble know its whole surface area and open the right place itself.

## What changes for you

- Ask for anything Kimble offers and it takes you there. "I want kimble.cloud
  on this app" opens the domain area. "Who signed up?" opens your app's users.
  "How many credits do I have left?" opens credits. No hunting, no chips to tap.
- Kimble answers as the owner, in its own voice: "Opening your domains now —
  add the address and I'll handle the rest," not "Kimble supports custom
  domains; you can find them under settings."
- It never opens something you didn't ask for. Describing an app you want built
  ("a marketplace where people buy domains") builds the app — it does not open
  Kimble's own domain screen.
- Anything that costs money or needs your own account still stops at the door:
  Kimble opens the screen, explains the one step in a sentence, and never
  charges or connects anything on its own.

## The surface map

One table, used everywhere, listing every area Kimble can open and what it is
for:

```text
Domains         buy or connect a web address
Publish         put the app live, see the live link
Credits & plan  balance, top up, plan, where credits went
Cloud           database · users · storage · secrets · logs · AI usage
Payments        take money in the generated app
Integrations    Resend, Stripe, Paystack, Plausible, and the rest
Analytics       visitors and traffic
Website info    title, description, social preview
Mobile          build and download the iOS / Android app
History         every checkpoint, revert to any of them
Code & files    the actual source
Share           preview link and comments
Security        the project's security review
Settings        name, visibility, instructions, memory
```

Each row carries: what it is in plain words, the phrases that mean it, whether
it costs money, and the one function that opens it.

## How it works

### 1. One registry, one detector

`src/lib/kimble-surfaces.ts` holds the table above — id, label, plain-language
purpose, trigger patterns, money/account flag, and the builder action that
opens it. `detectSurfaceIntent(text)` is pure, deterministic and AI-free, and
returns at most one surface with the phrase that matched.

It only fires on a first-person request about *this* project — "I want", "where
is", "show me", "how do I", "open", "add a domain to this app". It deliberately
does not fire on build instructions, third-person description, or questions
about what Kimble can do in general. Existing app-building intent detection
(`intent-registry.ts`, `intent-actions.server.ts`) is untouched and keeps
running alongside it; this is a second, separate read.

### 2. Kimble speaks as the owner

Both the build path and the chat path get a short block naming the surface the
user is asking about, what it does, and the instruction to answer as its owner:
name the area, say what will happen, and state the one manual step when there
is one. Kimble's self-knowledge block gains the full table, so it can also
answer "can you do X?" correctly for every area — including the three Cloud
tiers — without inventing a panel.

### 3. The screen opens itself

A small event bus (`petal:open-surface`, mirroring the existing
`petal:service-enabled`) carries the surface id. The build stream gains one
event type, `open_surface`, emitted alongside the reply; the chat-only path
returns the same field.

The builder listens and opens the panel through the existing action registry
(`src/lib/builder-actions.tsx`), extended with the openers it does not have
yet — domains, mobile, credits, and the Cloud sub-views (users, database,
storage, secrets, logs, AI usage) so "who signed up?" lands on the right tab
rather than the panel's front door.

Rules the opener follows:
- One surface per turn, opened when the reply finishes — never mid-build and
  never while the user is typing.
- Nothing opens if a sheet or dialog is already open.
- Opening is silent and reversible: no charge, no provisioning, no writes.

### 4. Money and outside accounts

Unchanged in substance: buying a domain, upgrading a plan, connecting a payment
account. Kimble opens the screen and says the one thing the user must do, in a
sentence. It never completes the purchase or the connection.

## Technical notes

- New: `src/lib/kimble-surfaces.ts` (table + detector), `src/lib/surface-events.ts`
  (emit/subscribe), tests for the detector covering every surface plus the
  build-instruction false positives.
- Changed: `src/server/intent-actions.server.ts` returns the detected surface;
  `src/routes/api/generate.ts` emits `open_surface`; `src/routes/api/discuss.ts`
  returns it; `src/server/petal-capabilities.server.ts` gains the surface table
  and the owner-voice instruction; `src/routes/builder.tsx` subscribes and
  opens; `src/lib/builder-actions.tsx` gains the missing openers;
  `CloudPanelSheet` accepts an initial sub-view.
- Unchanged: existing app-building intent detection and auto-enable, the credit
  engine, the ask-policy (Kimble still asks at most one question and only when
  truly ambiguous), and every panel's own behaviour.
- Fail-open throughout: a detection or open failure leaves the reply exactly as
  it is today.

## Verification

Unit tests for the detector on every surface, plus the cases that must NOT
fire. Then a live pass in the builder: ask for a domain, ask who signed up, ask
about credits, and ask for an app that sells domains — the first three open the
right screen, the fourth builds and opens nothing.
