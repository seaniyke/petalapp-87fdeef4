# Audit: Kimble's 80 archetypes vs Webby templates and design systems

Investigation only. Nothing has been changed. The last section is the proposed next step, for approval.

## 1. What the 80 archetypes are
A hidden list in `src/server/templates.server.ts` (`TEMPLATES`, 80 `TemplateKey` entries, e.g. `dashboard-app`, `saas-landing`). Each entry has four things:
- a description
- a route list
- starter-kit block names
- feature bullets
- keyword patterns

The file header still says "16 internal app templates"; that is out of date.

## 2. Why they are in Kimble
They were Kimble's own page-plan hints ("this looks like a dashboard app, so here are its likely pages and blocks"). They date from before the product planner (`intent-contract.ts`) existed. They have nothing to do with Webby.

## 3. Are they used?
Yes, on every first build.
- `pickTemplateForBrief()` (templates.server.ts:754) scores the request against the keyword patterns. It is the fallback.
- The main path is `composeAppBlueprint()` (app-composer.server.ts:130). It prefers a second, smaller list of 18 archetypes (`system-catalog.server.ts`) and merges that list's extra routes with the template's routes.
- `design-director.server.ts:285` also records a template key. It is only passed back into the app composer; it does not choose colours or fonts.
- `generation-quality-gate.server.ts` reads `TEMPLATES` for checks after the build. It has no effect on routing.

## 4. Where they enter generation
Two places, both in `src/routes/api/generate.ts`:
1. **The AI instructions.** `renderBlueprintBlock()` (app-composer.server.ts:189) writes "Scaffold these routes (use these exact paths) — build no other pages", followed by the template's routes, blocks and features.
2. **The list of required pages.** Lines 3547–3587 push the same routes into `plannedRoutes`. `requestedRoutesFor()` (build-state.ts:27) turns that list into the required pages that the readiness check enforces, unless the user named pages themselves.

## 5. Interaction with Webby templates
Webby has no page-structure template picker in Kimble. The only Webby parts are the knowledge files, and "Webby" in `agent-knowledge/index.ts` only filters Webby-only tool sections. So there is no overlap and no conflict here.

## 6. Interaction with Webby design systems
None. Package and theme selection (`design-systems/authority.ts`, `loader.ts`, `apply.ts`, `retheme.ts`) looks only at the request text through `classifyAppShape()`. It never reads an archetype. The archetypes carry no colours or fonts. Their only visual link is naming starter-kit blocks, and those take their styling from the selected package.

## 7. Interaction with Webby knowledge and skills
None. `conditionalSkills()` (first-build-context.ts:134) looks only at the site type and the product surface (website, app, or both).

## 8. Conflict: YES, one, and it is structural

## 9. The exact conflict and how serious it is
**Two sources of truth decide the page list.**
- **Product planner (`intent-contract.ts` FAMILIES):** when a domain matches (healthcare, education, HR, CRM, inventory, projects, delivery, restaurant, commerce), it wins. `divergentPages()` removes the template's routes, the template text is replaced, and duplicate sub-pages like `/dashboard/items` are removed (generate.ts:3601–3633).
- **No domain matches:** that clean-up never runs (it is guarded by `intentContract.pages.length`). The archetype's route list then goes straight into the AI instructions and into the required pages. For example, `dashboard-app` requires `/dashboard/items`, `/dashboard/settings` and `/auth/sign-in`.

**What happens as a result:**
- The AI is told to build pages the user never asked for.
- If it builds them under a different name, or combines them, the readiness check reports "missing requested pages" and the build fails.
- This is exactly what failed the live delivery build before delivery became a recognised domain.

**Severity: high for launch.** Any product outside the nine domains can fail this way, and the risk grows each time an archetype is added.

**A smaller issue:** the template block says "never adds pages". The blueprint block says "Scaffold these routes — build no other pages". The AI is getting two opposite instructions.

## 10. Where they sit together safely
- Colours, fonts and design packages
- Webby knowledge and skills
- Any build where the product planner recognises the domain

## 11. Keep, modify, isolate or remove?
**Isolate. Don't remove.** The kit-block and feature hints are still the main quality lever for products the planner doesn't know. Removing them would make those builds plainer. The route list is the only harmful part.

## 12. Recommended action before launch (for approval)
One small change. It does not touch billing, edit scope, the example-file fix, design packages or knowledge.
1. **Archetype routes become suggestions, never requirements.** Stop adding archetype or blueprint routes to `plannedRoutes`. Required pages then come only from:
   - pages the user named
   - the product planner's pages
   - the pages the product structure always needs (Home and Sign in when there's a public side)
2. **One message to the AI.** Replace "use these exact paths — build no other pages" with the same scope rule the template block already uses: the listed pages are optional patterns, and the AI builds only what was asked.
3. **Tests:**
   - a generic "admin dashboard" request no longer requires `/dashboard/items` or `/dashboard/settings`
   - a request in a recognised domain (hospital, delivery) is unchanged
   - pages the user named are still required
4. Rebuild the build-server package and bump its version. Then re-run the live delivery build, with its sign-in and saved-data tests, after you publish.

## Technical details
- Files to edit: `src/routes/api/generate.ts` (the push at ~3587) and `src/server/app-composer.server.ts` (`renderBlueprintBlock` wording). Add one test file and register it in `vitest.config.ts`.
- Not changed: `TEMPLATES` data, `system-catalog`, `intent-contract` families, the design-system modules, `first-build-context`.
- Record the rule in `AGENTS.md`: archetype routes are advisory; required routes come only from the user's own words, the intent contract and the product structure.
