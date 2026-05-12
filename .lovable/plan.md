## Goal

Make Petal noticeably better at building games of any kind without adding a "Games" UI section. Mirror the Layer K (mobile) pattern: detect game intent → inject a focused system-prompt block that teaches the LLM the right libraries, loop architecture, asset pipeline, persistence, and pitfalls. Plus broaden the integration resolver to know game-relevant npm packages so the model can reach for them.

## Research summary (what works in browser/Capacitor games today)

A Petal-built game has to run in the same Vite + React + TanStack Start sandbox we already ship. That constrains the toolbelt to libraries that are pure-JS/WebGL, have small bundles, and play well with React's render lifecycle:

- **2D arcade / casual / hyper-casual** → Phaser 3 (full game engine, scenes, physics, input), or raw `<canvas>` + `requestAnimationFrame` for very small games. Phaser stays mounted in a single React component via `useEffect` + `new Phaser.Game(config)`; React handles HUD/menus, Phaser handles the canvas.
- **Card / board / turn-based / puzzle / trivia** → no engine needed. Plain React + Zustand/`useReducer` for state, framer-motion for card animations. This is the cheapest, fastest path and what most "games" actually are.
- **Physics-driven (ragdoll, sandbox, escape-the-boss runner)** → matter-js (2D rigid body) or planck.js. Pair with Phaser or raw canvas.
- **3D / pseudo-3D** → three.js + @react-three/fiber + @react-three/drei. Drei gives camera controls, loaders, helpers; fiber lets the rest of the React app stay normal.
- **Endless runner / platformer specifically** → Phaser arcade physics is the right fit (matches the ad's "Escape Your Boss" example).
- **Multiplayer realtime** → either Supabase Realtime (broadcast channels for presence + state diffs) for low-stakes turn-based, or partykit/colyseus when authoritative server state is needed.
- **Audio** → howler.js (sprite sheets for SFX, looping music, ducking).
- **Tilemaps / level editors** → Tiled JSON loaded by Phaser, or hand-rolled grid for puzzles.
- **Persistence + leaderboards** → Lovable Cloud (Postgres + RLS): `scores` table keyed by `user_id`, `game_slug`, `score`, `created_at`. Public read policy, authenticated insert. We already do this pattern for everything else.
- **Mobile** → already covered by Layer K. Game-guidance block tells the model to honor safe-area, lock orientation when needed, and use Capacitor Haptics for hit feedback.

Common pitfalls the model gets wrong without guidance:
- Putting Phaser scene state in React state → triggers re-renders mid-frame.
- Not pausing the loop on `visibilitychange` → battery drain + de-sync.
- Loading huge sprite sheets at module scope → blocks first paint.
- Using `setInterval` instead of `requestAnimationFrame` → stutter on throttled tabs.
- Storing scores client-only → not a "real" leaderboard, no anti-cheat surface.
- Ignoring DPR on canvas → blurry on retina/mobile.

## What to build

Three small additions, all in the prompt-intelligence layer. Zero changes to UI surface, zero changes to billing/credit code.

### 1. `src/lib/game-intent.ts` (new — pure regex)

Mirror `mobile-intent.ts`. Detect game intent from the latest user turn and classify the genre when possible. Return:

```ts
type GameIntent = {
  isGame: boolean;
  genre:
    | "arcade" | "puzzle" | "platformer" | "runner" | "shooter"
    | "card" | "board" | "trivia" | "rpg" | "tycoon" | "idle"
    | "physics" | "rhythm" | "io-multiplayer" | "3d" | "generic";
  multiplayer: boolean;        // "multiplayer", "with friends", "leaderboard"
  realtime: boolean;           // "realtime", "live", "co-op"
  needsPhysics: boolean;       // "gravity", "ragdoll", "bounce", "collisions"
  needs3D: boolean;            // "3d", "first person", "third person"
};
```

Trigger words: `game | play | gameplay | level | score | leaderboard | multiplayer | runner | endless | tycoon | idle | platformer | tower defense | match-3 | trivia | quiz battle | shooter | arcade | puzzle | rpg | enemies | character | sprite | pixel art | physics | gravity | ragdoll | first person | 3d`. Conservative — don't match "puzzle piece" in non-game context.

### 2. `src/server/integrations/game-guidance.server.ts` (new — pure function)

Same shape as `mobile-guidance.server.ts`. Exports `renderGameGuidanceBlock(text: string): string`. Returns "" when `detectGameIntent()` says not a game; otherwise returns a `## Game build guidance` block that teaches:

- **Library choice by genre**, with the genre detector's hint:
  - Card/board/trivia/puzzle/idle/tycoon → plain React + Zustand + framer-motion. No engine.
  - Arcade/runner/platformer/shooter → Phaser 3 (`bun add phaser`).
  - Physics-heavy → Phaser + matter-js, or matter-js standalone on canvas.
  - 3D → three.js + @react-three/fiber + @react-three/drei.
  - Audio → howler.js, lazy-loaded.
  - Realtime multiplayer → Supabase Realtime broadcast for presence/turn-based; partykit only if user explicitly asks.
- **React+Phaser bridge pattern** (canonical snippet): mount Phaser inside a `useEffect`, store the `Phaser.Game` in a ref, never bind scene fields to React state, expose a thin event bus (`game.events.emit('score', n)`) that React subscribes to for the HUD.
- **Game loop hygiene**: always `requestAnimationFrame`, pause on `document.hidden`, fixed timestep for physics, decouple render from update.
- **Canvas DPR**: scale by `window.devicePixelRatio`, set CSS size separately from buffer size.
- **Asset pipeline**: put sprites/audio in `src/assets/game/`, import as ES modules so Vite hashes them. Lazy-load heavy assets per scene, never at module top-level.
- **Persistence + leaderboard** (when `multiplayer || /score|leaderboard|highscore/`):
  - Cloud table `game_scores(id, user_id, game_slug, score, meta jsonb, created_at)`.
  - RLS: public read, authenticated insert, `score >= 0` check, `user_id = auth.uid()`.
  - Top-N query via SQL function ordered by `score desc, created_at asc`.
  - Tell the model to scaffold this when intent matches.
- **Mobile/touch controls**: virtual joystick for runners/platformers (nipplejs or hand-rolled), tap zones for one-button games. Cross-reference Layer K (Capacitor Haptics on hit).
- **Anti-cheat surface (light)**: server-validated score envelope (max plausible per second), don't trust raw client scores. One paragraph, not a lecture.
- **Stop conditions**:
  - If user asks for **Unity / Unreal / Godot / native console** → stop and tell them Petal targets web + Capacitor; Phaser is the closest equivalent.
  - If user asks for **MMO / 1000+ concurrent players** → stop and ask them to confirm; Petal's stack works for casual realtime, not authoritative MMO servers.

### 3. Wire it up

- `src/routes/api/generate.ts` — after `mobileBlock` is computed, dynamically import `game-guidance.server.ts` and append `gameBlock` into the same system prompt concatenation (lines ~1313–1345).
- `src/lib/integration-request-intent.ts` — extend `KNOWN` with: `phaser`, `three`, `three.js`, `@react-three/fiber`, `@react-three/drei`, `matter-js`, `planck`, `pixi.js`, `howler`, `nipplejs`, `colyseus`, `partykit`, `gsap`. Lets the user say "use phaser" or "add howler" and have the resolver pull the npm brief automatically (already wired through `doc-resolver`).
- `src/lib/app-shape-classifier.ts` — add `"game"` to `ShapeCategory` and a small classifier rule (presence of game keywords + `score|level|player`). Game shape suggests: `landing` (optional), `auth` (only if leaderboard), `dashboard`-as-game-screen, Cloud features `database` + `auth` when multiplayer/leaderboard. This makes the existing shape block already in the prompt pick the right scaffold.
- `src/lib/start-ideas.ts` — add 3 new game starters alongside the existing trivia entry: an endless runner, a one-button arcade, and a 3D mini-scene. These already feed the landing's idea chips without needing a new section.

## What we explicitly are NOT doing

- No new "Games" landing section, no game-specific tab/route, no template gallery.
- No Unity/Unreal/Godot pipeline, no native console builds, no asset-store integration.
- No changes to billing, credits, or wallet code.
- No new dependencies installed pre-emptively — the guidance tells the model to install Phaser/three/etc. on demand inside the user's project, same way other libs already get pulled.

## Files touched

- New: `src/lib/game-intent.ts`
- New: `src/server/integrations/game-guidance.server.ts`
- Edit: `src/routes/api/generate.ts` (one import + one block concat, ~6 lines)
- Edit: `src/lib/integration-request-intent.ts` (extend `KNOWN` array)
- Edit: `src/lib/app-shape-classifier.ts` (add `"game"` category + rule)
- Edit: `src/lib/start-ideas.ts` (3 new starter ideas)

## Verification

- Spot-check: prompt "build an endless runner where you escape your boss, with a leaderboard" → generate.ts logs should show game intent fired, guidance block injected, app-shape includes `game` + `auth` + `database`.
- Prompt "make a trivia quiz with 10 questions and a daily score" → guidance suggests plain React (no Phaser), leaderboard table scaffolded.
- Prompt "build me a 3D first-person walking sim of a museum" → guidance suggests three.js + fiber + drei, no Phaser.
- Negative: "puzzle for my dashboard onboarding" → game intent does NOT fire (no `play|level|score`).

## Open question for you

Should the guidance block also tell the model to scaffold a tiny **`/leaderboard` route** automatically whenever leaderboard intent is detected (top-10 list + your-rank chip), or leave that for the user to ask? Default in this plan: yes, scaffold it — leaderboards are the single biggest "feels real" lever for a game.
