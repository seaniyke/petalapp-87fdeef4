/**
 * Layer M — Game generation guidance.
 *
 * Petal can already build interactive web apps; what was missing was
 * generation-time knowledge for *games* specifically. The same Vite +
 * React + TanStack Start sandbox we ship to every project can host:
 *   - Phaser 3 for 2D arcade / runner / platformer / shooter
 *   - three.js + @react-three/fiber for 3D
 *   - matter-js for 2D physics
 *   - plain React + Zustand for card / board / trivia / puzzle / idle
 *   - Supabase Realtime for casual multiplayer
 *
 * This module produces a system-prompt block (only when game intent is
 * detected) that tells the model which library to reach for, how to
 * bridge Phaser/three with React safely, how to handle the loop, assets,
 * leaderboards, mobile controls, and what not to do (Unity / Unreal /
 * authoritative MMO servers).
 *
 * Pure function. No IO. Safe in client or server.
 */

import { detectGameIntent, type GameGenre } from "@/lib/game-intent";

function libraryRecommendation(genre: GameGenre, needs3D: boolean, needsPhysics: boolean): string {
  if (needs3D || genre === "3d") {
    return [
      "**Stack:** three.js + @react-three/fiber + @react-three/drei.",
      "  - Install (PIN these versions — the scaffold ships React 18, and @react-three/fiber v9 requires React 19, which crashes at runtime with `function is not a constructor (evaluating 'new Um({})')`):",
      "    `bun add three@^0.170.0 @react-three/fiber@^8.17.10 @react-three/drei@^9.117.3 && bun add -d @types/three@^0.170.0`",
      "  - NEVER run `bun add three @react-three/fiber @react-three/drei` without version pins on this scaffold — it pulls fiber v9 and breaks the preview.",
      "  - Mount the `<Canvas>` once at the top of the game route. Keep React HUD outside the canvas.",
      "  - Use drei helpers (`OrbitControls`, `useGLTF`, `Environment`) — don't roll your own loaders.",
    ].join("\n");
  }
  if (genre === "card" || genre === "board" || genre === "trivia" || genre === "puzzle" || genre === "idle" || genre === "tycoon") {
    return [
      "**Stack:** plain React + Zustand (or `useReducer`) + framer-motion. NO game engine.",
      "  - This category is UI-state, not a render loop. Adding Phaser here is overkill and slower.",
      "  - Animate transitions with framer-motion's `<AnimatePresence>` for card flips, tile swaps, modal in/out.",
    ].join("\n");
  }
  if (genre === "runner" || genre === "platformer" || genre === "shooter" || genre === "arcade" || genre === "rhythm" || genre === "physics" || needsPhysics) {
    const physicsLine = needsPhysics || genre === "physics"
      ? "  - For rigid-body physics: enable Phaser arcade physics; if you need realistic 2D physics (ragdoll, soft constraints), add `matter-js` and use Phaser's matter integration.\n"
      : "";
    return [
      "**Stack:** Phaser 3.",
      "  - Install: `bun add phaser`.",
      "  - One Phaser game lives in one React component (`<GameCanvas />`) mounted via `useEffect`. Store the `Phaser.Game` in a ref so React never re-creates it on re-render.",
      physicsLine + "  - HUD (score, lives, pause button) stays in React. The Phaser scene emits events via `this.game.events.emit('hud:score', n)`; React subscribes once on mount.",
    ].join("\n");
  }
  if (genre === "rpg") {
    return [
      "**Stack:** Phaser 3 (top-down) for movement + tilemaps; React for menus, inventory, dialog UI.",
      "  - Install: `bun add phaser`. Use Tiled-format JSON tilemaps loaded via `this.load.tilemapTiledJSON`.",
      "  - Persist character state to Cloud (a `characters` table per user) so progress survives reload.",
    ].join("\n");
  }
  if (genre === "io-multiplayer") {
    return [
      "**Stack:** Phaser 3 (rendering) + Supabase Realtime broadcast (state sync). For authoritative multi-room servers, recommend partykit and stop to confirm before wiring it up.",
      "  - Install: `bun add phaser`. Use one Realtime channel per room; debounce broadcasts to ~20Hz.",
      "  - Never trust client-reported scores or positions for ranking — validate server-side.",
    ].join("\n");
  }
  return [
    "**Stack:** start with plain React + framer-motion. Add Phaser only if you need a continuous render loop (movement, collisions, sprites animating every frame).",
    "  - When in doubt, ask the user one clarifying question about the genre before installing a 2MB engine.",
  ].join("\n");
}

export function renderGameGuidanceBlock(text: string | null | undefined): string {
  const intent = detectGameIntent(text);
  if (!intent.isGame) return "";

  const wantsLeaderboard = /\b(leaderboard|high[- ]?score|global\s+ranking|top\s+\d+\s+players?)\b/i.test(text || "");
  const wantsLeaderboardOrMP = wantsLeaderboard || intent.multiplayer;

  const persistenceBlock = wantsLeaderboardOrMP
    ? `

**Leaderboard / score persistence (REQUIRED — user asked for it)**
Scaffold this as part of the build, don't wait to be asked again:

1. Lovable Cloud table:
\`\`\`sql
create table public.game_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_slug text not null,
  score integer not null check (score >= 0),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index game_scores_top_idx on public.game_scores (game_slug, score desc, created_at asc);
alter table public.game_scores enable row level security;
create policy "scores are public read"
  on public.game_scores for select using (true);
create policy "users insert their own scores"
  on public.game_scores for insert
  with check (auth.uid() = user_id);
\`\`\`

2. Top-N RPC:
\`\`\`sql
create or replace function public.top_scores(_game_slug text, _limit int default 10)
returns table (user_id uuid, score int, created_at timestamptz)
language sql stable as $$
  select user_id, score, created_at
  from public.game_scores
  where game_slug = _game_slug
  order by score desc, created_at asc
  limit _limit;
$$;
\`\`\`

3. Routes/components:
   - \`<Leaderboard gameSlug="..." />\` component reading top 10 + the current user's best.
   - A \`/leaderboard\` route (or modal) wired into the game over screen.
   - On game over: \`supabase.from('game_scores').insert({ game_slug, score, meta })\`.

4. **Light anti-cheat:** validate server-side that \`score\` is plausible for the elapsed game duration in \`meta.duration_ms\`. Reject obvious outliers; don't try to build full anti-cheat.`
    : "";

  const realtimeBlock = intent.realtime || intent.multiplayer
    ? `

**Realtime / multiplayer**
- Use Supabase Realtime broadcast channels for casual sync (presence, turn-based moves, lobby state). One channel per room.
- Throttle broadcasts to ≤ 20 messages/sec per client; batch position updates.
- Use \`presence\` for "who's in the room"; never poll.
- Authoritative state lives server-side for anything that affects ranking.
- For >50 concurrent players per room or strict authority, stop and ask the user before adding partykit/colyseus — that's a different infra footprint.`
    : "";

  const mobileBlock = `

**Mobile / touch controls**
- Detect touch with \`'ontouchstart' in window\` once on mount; render touch overlays only then.
- One-button games: full-screen tap zone with \`touch-action: manipulation\`.
- Runners/platformers: virtual joystick + jump button (\`bun add nipplejs\` or hand-roll). Position above the safe-area inset.
- Lock orientation when the game requires it: \`screen.orientation.lock('landscape').catch(() => {})\`.
- If Capacitor mobile guidance is also active in this prompt, use \`@capacitor/haptics\` for hit/score feedback.`;

  return `

### Game build detected (genre: \`${intent.genre}\`, signal: "${intent.reason}")
The user wants to build a game. Petal targets the **web (Vite + React)** and **Capacitor for mobile** — not Unity, Unreal, Godot, or native console SDKs. If the user explicitly asks for any of those, stop and explain that Petal builds web/Capacitor games and offer Phaser / three.js as the closest equivalent.

**Library choice for this prompt**
${libraryRecommendation(intent.genre, intent.needs3D, intent.needsPhysics)}

**Audio (when the game needs SFX or music)**
- Use \`howler.js\` (\`bun add howler\`). Lazy-load sprite sheets per scene, never at module top-level.
- Always provide a mute button. Respect \`prefers-reduced-motion\` for screen shake.

**Game loop hygiene (raw canvas / Phaser scenes alike)**
- Always \`requestAnimationFrame\`, never \`setInterval\`. Background tabs throttle rAF correctly; setInterval drifts.
- Pause the loop on \`document.visibilitychange\` when hidden.
- Use a fixed timestep (e.g. 1/60s) for physics/state; render is variable. Carry a delta accumulator.
- Decouple input handling from update — buffer inputs and consume them on the next tick.

**React + Phaser bridge (canonical, do not invent your own pattern)**
\`\`\`tsx
import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      backgroundColor: "#0b0b10",
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 600 } } },
      scene: [MainScene],
    });
    gameRef.current = game;
    const onScore = (n: number) => setScore(n);
    game.events.on("hud:score", onScore);
    return () => {
      game.events.off("hud:score", onScore);
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full h-[100dvh]">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-4 left-4 text-white font-mono">Score: {score}</div>
    </div>
  );
}
\`\`\`
- Never put scene state in React state.
- Never re-create the Phaser.Game on re-render — the ref + empty deps array protects you.

**Canvas / DPR**
- Set the canvas buffer to \`width * devicePixelRatio\` and use CSS to size it back down. Phaser's \`Scale.RESIZE\` handles this; raw canvas needs \`ctx.scale(dpr, dpr)\`.

**Asset pipeline**
- Put sprites/audio under \`src/assets/game/\`. Import as ES modules (\`import runnerSprite from "@/assets/game/runner.png"\`) so Vite hashes and caches them.
- Lazy-load heavy assets per scene with \`this.load.image(...)\` inside \`preload()\`.
- Generate placeholder art with the agent's image tools if the user hasn't supplied any — never block on art.

**3D specifics (only if you chose three.js)**
- One \`<Canvas>\`. Suspense around \`useGLTF\` calls. Dispose textures/geometries on unmount.
- Cap pixel ratio: \`<Canvas dpr={[1, 2]}>\` — full DPR on a phone melts the GPU.
- Use \`<Stats />\` from drei in dev only.${persistenceBlock}${realtimeBlock}${mobileBlock}

**Things to avoid**
- \`alert()\` / \`confirm()\` for game UI — use a Dialog so it works on mobile.
- Putting score state in localStorage as the *only* store when the user asked for a leaderboard.
- Hard-coding 60fps assumptions — always multiply by delta time.
- Loading 50MB sprite atlases at module scope.
- Building authoritative anti-cheat — keep it light, surface server-side plausibility checks only.
`;
}
