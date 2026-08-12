# Track 3 and Builder Reliability Fixes

## Goal
Make Petal infer complete product behavior from short prompts, prevent the `actor.avatarUrl` render crash at its source, and accept substantially longer build instructions without showing the current “message too long” card.

## Implementation

### 1. Deepen the product/spec brain
- Extend the internal PRD from coarse page labels into an executable product contract: inferred entities, field shapes, relationships, roles, permissions, lifecycle/statuses, CRUD operations, and required UI states.
- Add archetype defaults for workflow apps, marketplaces, social products, storefronts, AI tools, and utilities so Petal infers standard behavior even when the user only names the product category.
- Infer persistence and authentication from product semantics—not only explicit words. Multi-user/private/workspace products get accounts and ownership; local single-user utilities remain client-side unless saving/sync is implied.
- Require primary entities to ship list/search/filter/detail/create/edit/delete-confirm flows, with relationship navigation and realistic seeded data.
- Make empty, loading, error, validation, pending, success, permission-denied, and destructive-confirmation states machine-checkable PRD requirements rather than prompt advice.
- Feed the enriched contract into planning, template/archetype reconciliation, generation, critic repair, and acceptance checks so later stages cannot silently omit inferred requirements.
- Add golden tests across representative products (CRM, inventory, booking, marketplace, social feed, storefront, calculator) and iteration tests that preserve the established contract.

### 2. Fix the `actor.avatarUrl` crash at the root
- Repair the scaffold-owned `ActivityFeed` contract so malformed or partially loaded items are normalized before rendering; actor name/avatar access will come from a guaranteed normalized actor object rather than unchecked nested input.
- Preserve valid feed rows while safely rejecting structurally unusable rows, and provide deterministic fallback identity for rows missing optional actor metadata.
- Extend render-risk verification to detect unsafe nested object access inside mapped collections, not only optional top-level props.
- Add regression tests using the exact missing-`actor` shape so generated apps cannot pass verification with this white-screen failure again.

### 3. Support long prompts end to end
- Replace the current 8,000-character generation cap with a shared, substantially larger prompt limit sized for detailed product briefs, and use the same constant across generation, PRD inference, triage, discussion, and client validation.
- Preserve the full latest user instruction for intent/spec extraction while relying on the existing context-budget layer to compact older history; do not silently truncate the active request.
- Keep a high emergency payload ceiling for abuse/memory protection, but return a precise inline validation response only at that exceptional ceiling—not the current generic error card.
- Remove the obsolete “split it into smaller asks” friendly-error mapping so accepted long prompts never produce the referenced banner.
- Add boundary tests for prompts above 8,000 characters, at the new limit, and beyond the emergency ceiling, plus a first-send/iteration regression to verify the complete text reaches generation unchanged.

## Verification
- Run the focused PRD, render-risk, scaffold-kit, friendly-error, and generation request tests.
- Run the full project test suite through the harness.
- Exercise a long multi-feature prompt and a feed item without `actor` in the preview/build pipeline; confirm generation starts on first send and the app renders without an error card.
