# Remove the tap-prompts — Petal acts on intent instead

Today Petal notices what you asked for and then shows a small card you have to tap
("Enable storage", "Connect a domain", "Turn on payments"). That is the wrong
behaviour: if Petal already understood the request, it should just do it.

This plan removes every one of those cards and moves the same intent detection into
the build itself, so the work happens without a tap.

## What gets removed

All of these appear under the last chat message in the builder and disappear:

- Backend, email and payments ask-cards
- Connect a domain
- Add a page
- Turn on SEO
- Make it a mobile app
- Add analytics
- Add an AI feature
- Add file storage
- Add live updates
- Add scheduled jobs

Kept, because they are not feature suggestions:

- The cookie/consent notice (legally required)
- The low balance / paused notice (billing, and the paused one blocks real work)
- The build checklist and next-steps card that appear during and after a build

## What replaces them

The same detection code stays — it just drives action instead of a card.

1. **Petal turns things on by itself.** When a request needs the backend, file
   storage, live updates, scheduled jobs, an AI feature, analytics, SEO or an extra
   page, Petal enables it and builds it in the same turn. No card, no tap.
2. **Petal says what it did, in one line.** A short sentence in its reply
   ("I turned on the backend so accounts can be saved"), not a card.
3. **Money and outside accounts are the only pause.** Buying a web address,
   upgrading a plan, or connecting a payment account still needs you — Petal does
   everything it can up to that point, then says plainly in chat what it needs and
   opens the relevant screen only when you ask it to.

## Technical notes

- `src/routes/builder.tsx`: delete the ten chip render blocks (~4590–5060), their
  `dismissed*Chips` state, the related handlers and imports. Keep
  `RuntimeLowBalanceBanner`, `SuggestionChecklist`, `NextStepsCard`.
- Delete the now-unused components: `CapabilityAskInline`, `AddDomainSuggestionChip`,
  `AddPageSuggestionChip`, `EnableSeoSuggestionChip`, `EnableMobileSuggestionChip`,
  `EnableAnalyticsSuggestionChip`, `EnableAiFeatureSuggestionChip`,
  `EnableStorageSuggestionChip`, `EnableRealtimeSuggestionChip`,
  `EnableCronSuggestionChip`.
- Keep `src/lib/intent-registry.ts` and its shims untouched — detection moves
  server-side, not away.
- New `src/server/intent-actions.server.ts`: given the turn's prompt, run
  `detectIntents` and return the capabilities the turn implies. Called from
  `src/routes/api/generate.ts` before generation.
  - Backend/storage/realtime/cron/AI/analytics imply "backend required": if the
    project has no backend and the user is on a paid plan, call
    `POST /api/backend?action=enable-managed` (or `enable-shared`) server-side and
    wait for it before the build starts.
  - Not on a paid plan, or the intent is a domain purchase or a payment provider:
    do not open anything. Append a one-line note to the assistant reply stating what
    is needed. The existing settings screens remain reachable from the menu.
  - The resolved capability list is added to the generation prompt so the build
    actually implements the feature (tables, upload UI, cron route, etc.).
- The auto-enable path is guarded by a flag in `completion-flags.server.ts`, failing
  open to "do nothing extra" so a bad detection can never block a build.
- Verify with Playwright: send a prompt that used to raise a chip (e.g. "let users
  upload a profile photo") and confirm no card renders and the capability is enabled.
