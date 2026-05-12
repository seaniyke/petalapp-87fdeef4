/**
 * Game intent detector. Mirrors mobile-intent / payment-intent.
 *
 * Fires when the user wants Petal to build a game (any genre). Classifies
 * the genre when possible and notes whether the prompt asks for multiplayer,
 * realtime, physics, or 3D so the game-guidance block can recommend the
 * right libraries (Phaser vs React+Zustand vs three.js, etc.).
 *
 * Pure regex. Conservative — won't match "puzzle piece" in a non-game
 * context. Returns isGame=false unless at least one strong signal hits.
 */

export type GameGenre =
  | "arcade"
  | "puzzle"
  | "platformer"
  | "runner"
  | "shooter"
  | "card"
  | "board"
  | "trivia"
  | "rpg"
  | "tycoon"
  | "idle"
  | "physics"
  | "rhythm"
  | "io-multiplayer"
  | "3d"
  | "generic";

export type GameIntent = {
  isGame: boolean;
  genre: GameGenre;
  multiplayer: boolean;
  realtime: boolean;
  needsPhysics: boolean;
  needs3D: boolean;
  /** First matched signal — surfaced in the prompt block for transparency. */
  reason?: string;
};

const STRONG_SIGNALS: RegExp[] = [
  /\b(?:build|make|create|design)\s+(?:a |an )?(?:simple |fun |little |mini[- ]?)?(?:game|games)\b/i,
  /\b(?:video |arcade |mobile |browser |web )?game\b/i,
  /\bgameplay\b/i,
  /\b(?:player|enemies|enemy|boss\s+fight|sprite|pixel\s+art)\b/i,
  /\b(?:high[- ]?score|leaderboard|score\s+screen|game\s+over|new\s+high\s+score)\b/i,
  /\b(?:level\s+up|level\s+\d|world\s+\d|stage\s+\d)\b/i,
  /\b(?:endless\s+runner|platformer|tower\s+defense|match[- ]?3|battle\s+royale|tycoon|idle\s+game|clicker\s+game|rhythm\s+game|trivia\s+game|quiz\s+battle|word\s+puzzle|puzzle\s+game|card\s+game|board\s+game|rpg|shooter|arcade\s+game)\b/i,
  /\b(?:phaser|three\.?js|@react-three\/fiber|matter[- ]?js|pixi\.?js|howler|colyseus|partykit\s+game)\b/i,
  /\bwordle[- ]?(?:like|style|clone)\b/i,
  /\b(?:flappy|tetris|snake|2048|pong|breakout|asteroids|pacman)\s+(?:like|style|clone)\b/i,
];

const GENRE_RULES: Array<{ genre: GameGenre; match: RegExp; weight?: number }> = [
  { genre: "runner", match: /\b(?:endless\s+runner|infinite\s+runner|temple\s+run|subway\s+surfers|escape\s+(?:your\s+)?(?:boss|the))\b/i, weight: 3 },
  { genre: "platformer", match: /\b(?:platformer|side[- ]?scroller|jump\s+and\s+run|mario[- ]?like)\b/i, weight: 3 },
  { genre: "shooter", match: /\b(?:shooter|shoot[- ]?em[- ]?up|space\s+invaders|asteroids|fps|first[- ]?person\s+shooter|twin[- ]?stick)\b/i, weight: 3 },
  { genre: "tycoon", match: /\b(?:tycoon|management\s+sim|business\s+sim|empire\s+game)\b/i, weight: 3 },
  { genre: "idle", match: /\b(?:idle\s+game|clicker\s+game|cookie[- ]?clicker|incremental\s+game)\b/i, weight: 3 },
  { genre: "rhythm", match: /\b(?:rhythm\s+game|guitar\s+hero|beat\s+saber|tap\s+to\s+the\s+beat)\b/i, weight: 3 },
  { genre: "io-multiplayer", match: /\b(?:agar\.?io|slither\.?io|\.io\s+game|battle\s+royale)\b/i, weight: 3 },
  { genre: "card", match: /\b(?:card\s+game|solitaire|hearts\s+game|poker\s+app|blackjack\s+game|deck[- ]?builder)\b/i, weight: 3 },
  { genre: "board", match: /\b(?:board\s+game|chess\s+app|checkers\s+app|tic[- ]?tac[- ]?toe|ludo|monopoly[- ]?like)\b/i, weight: 3 },
  { genre: "trivia", match: /\b(?:trivia\s+game|quiz\s+battle|trivia\s+night|quiz\s+show|kahoot[- ]?like)\b/i, weight: 3 },
  { genre: "puzzle", match: /\b(?:puzzle\s+game|word\s+puzzle|wordle|sudoku|match[- ]?3|2048|crossword\s+app)\b/i, weight: 3 },
  { genre: "rpg", match: /\b(?:rpg|role[- ]?playing\s+game|jrpg|turn[- ]?based\s+battle|dungeon\s+crawler)\b/i, weight: 3 },
  { genre: "physics", match: /\b(?:angry\s+birds[- ]?like|ragdoll|physics\s+sandbox|softbody)\b/i, weight: 2 },
  { genre: "3d", match: /\b(?:3d\s+(?:game|scene|world)|first[- ]?person|third[- ]?person|three\.?js|@react-three)\b/i, weight: 2 },
  { genre: "arcade", match: /\b(?:arcade\s+game|flappy|pong|breakout|snake|pacman)\b/i, weight: 2 },
];

const MULTIPLAYER_RE = /\b(?:multiplayer|with\s+friends?|invite\s+friends?|2[- ]?player|two[- ]?player|co[- ]?op|versus|head[- ]?to[- ]?head|matchmaking|leaderboard|global\s+ranking)\b/i;
const REALTIME_RE = /\b(?:realtime|real[- ]?time|live\s+(?:match|battle|game)|synchronou?s|presence|live\s+opponents?)\b/i;
const PHYSICS_RE = /\b(?:physics|gravity|ragdoll|bounce|collision|momentum|trajectory|projectile)\b/i;
const THREE_D_RE = /\b(?:3d\s+(?:game|scene|world|model)|first[- ]?person|third[- ]?person|three\.?js|@react-three|webgl\s+(?:scene|world))\b/i;

const MIN_LENGTH = 6;

export function detectGameIntent(text: string | null | undefined): GameIntent {
  const empty: GameIntent = {
    isGame: false,
    genre: "generic",
    multiplayer: false,
    realtime: false,
    needsPhysics: false,
    needs3D: false,
  };
  if (!text) return empty;
  const t = text.trim();
  if (t.length < MIN_LENGTH) return empty;

  let reason: string | undefined;
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) {
      reason = m[0].toLowerCase();
      break;
    }
  }
  if (!reason) return empty;

  let genre: GameGenre = "generic";
  let bestWeight = 0;
  for (const r of GENRE_RULES) {
    if (r.match.test(t)) {
      const w = r.weight ?? 1;
      if (w > bestWeight) {
        genre = r.genre;
        bestWeight = w;
      }
    }
  }

  return {
    isGame: true,
    genre,
    multiplayer: MULTIPLAYER_RE.test(t),
    realtime: REALTIME_RE.test(t),
    needsPhysics: PHYSICS_RE.test(t),
    needs3D: THREE_D_RE.test(t) || genre === "3d",
    reason,
  };
}
