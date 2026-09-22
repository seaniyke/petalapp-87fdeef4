/**
 * Intent → action.
 *
 * Kimble used to detect what a user asked for and then render a card they had
 * to tap ("Enable storage", "Turn on the backend", "Connect a domain"). The
 * cards are gone. The same detection now runs here, server-side, and Kimble
 * simply does the work as part of the turn.
 *
 * Two rules:
 *  1. Anything Kimble can do on its own, it does — including attaching the
 *     free shared backend when the request needs data, accounts, uploads,
 *     live updates or scheduled work.
 *  2. Anything that costs money or needs an outside account (buying a web
 *     address, a paid plan, a payment provider) is never started silently.
 *     Kimble notes it in one plain line and keeps building everything else.
 *
 * Fail-open by construction: every step is best-effort and any failure
 * degrades to today's behaviour (no auto-enable, no extra prompt text).
 */

import { detectIntents, type SimpleIntentId } from "@/lib/intent-registry";
import {
  detectSurfaceIntent,
  renderSurfaceBlock,
  type SurfaceId,
} from "@/lib/kimble-surfaces";

/** Capabilities that require a database / server before they can work. */
const BACKEND_IMPLYING: SimpleIntentId[] = [
  "backend",
  "storage",
  "realtime",
  "cron",
  "aiFeature",
];

/** Capabilities Kimble cannot start alone — money or an outside account. */
const NEEDS_THE_USER: SimpleIntentId[] = ["domain", "payment"];

const CAPABILITY_BRIEF: Partial<Record<SimpleIntentId, string>> = {
  storage:
    "File uploads: build the real upload UI and persist the stored file reference — no fake file pickers.",
  realtime:
    "Live updates: the relevant views must refresh as data changes, not only on reload.",
  cron: "Scheduled work: add the server route that performs it and note when it should run.",
  aiFeature:
    "AI feature: call the AI through a server route; never put a key in browser code.",
  analytics: "Analytics: record the events the feature needs rather than stubbing them.",
  seo: "SEO: give every page its own title, description and social preview tags.",
  addPage: "The request implies at least one additional page — create the route, do not stub a link.",
  mobile: "The request mentions phones — the layout must work at 390px wide.",
  email: "Email: wire the send through a server route; never from browser code.",
};

function flagEnabled(): boolean {
  const raw = (process.env["PETAL_INTENT_ACTIONS"] ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "off", "false", "no", "disabled"].includes(raw);
}

export interface ResolveIntentActionsArgs {
  projectId?: string | null;
  prompt: string;
  /** True when a BYO or managed backend is already attached. */
  hasBackend: boolean;
  /** True when the free shared backend is already attached. */
  hasSharedBackend: boolean;
}

export interface ResolvedIntentActions {
  /** Everything the turn implies. */
  intents: SimpleIntentId[];
  /** True when this call attached the free shared backend just now. */
  enabledSharedBackend: boolean;
  /** Extra instructions appended to the generation prompt. Empty when none. */
  promptBlock: string;
  /**
   * One plain sentence for the user about anything Kimble could not start on
   * its own. Null when there is nothing to say.
   */
  userNote: string | null;
  /**
   * The part of Kimble itself the user is asking for ("I want a domain",
   * "who signed up?"). The builder opens it. Null when the turn is only about
   * building the app, which is the common case.
   */
  surface: SurfaceId | null;
}

const EMPTY: ResolvedIntentActions = {
  intents: [],
  enabledSharedBackend: false,
  promptBlock: "",
  userNote: null,
  surface: null,
};

export async function resolveIntentActions(
  args: ResolveIntentActionsArgs,
): Promise<ResolvedIntentActions> {
  if (!flagEnabled()) return EMPTY;

  // Product intent — a separate read from the app-building one below, and the
  // only one that can fire on a message with no build intent at all.
  let surfaceBlock = "";
  let surface: SurfaceId | null = null;
  try {
    const signal = detectSurfaceIntent(args.prompt);
    if (signal) {
      surface = signal.surface.id;
      surfaceBlock = renderSurfaceBlock(signal);
    }
  } catch {
    /* fail open — the turn behaves exactly as it does today */
  }

  let intents: SimpleIntentId[] = [];
  try {
    intents = detectIntents(args.prompt, null);
  } catch {
    return { ...EMPTY, surface, promptBlock: surfaceBlock };
  }
  if (intents.length === 0) return { ...EMPTY, surface, promptBlock: surfaceBlock };

  const needsBackend = intents.some((i) => BACKEND_IMPLYING.includes(i));
  let enabledSharedBackend = false;

  // Attach the free shared backend rather than asking. It costs nothing, has
  // no plan gate, and is exactly what the old "Enable backend" card did after
  // a tap.
  if (
    needsBackend &&
    args.projectId &&
    !args.hasBackend &&
    !args.hasSharedBackend
  ) {
    try {
      const { enableSharedBackend } = await import("@/server/shared-backend.server");
      await enableSharedBackend(args.projectId);
      enabledSharedBackend = true;
      console.log(`[intent-actions] shared backend auto-enabled for ${args.projectId}`);
    } catch (e) {
      console.warn(
        "[intent-actions] shared backend auto-enable failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // File uploads and direct SQL genuinely need a real database. Note the
  // need; the growth watcher moves the app onto its own database on its next
  // sweep. Provisioning takes minutes, so it never blocks this turn.
  if (args.projectId && intents.includes("storage")) {
    try {
      const { requestCapabilityUpgrade } = await import("@/server/backend-autoscale.server");
      await requestCapabilityUpgrade(args.projectId, "storage");
    } catch (e) {
      console.warn(
        "[intent-actions] capability upgrade request failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  const briefs = intents
    .map((i) => CAPABILITY_BRIEF[i])
    .filter((b): b is string => Boolean(b));

  const blocked = intents.filter((i) => NEEDS_THE_USER.includes(i));

  const lines: string[] = [];
  if (briefs.length > 0 || enabledSharedBackend) {
    lines.push("## CAPABILITIES THIS REQUEST IMPLIES (implement them, do not suggest them)");
    if (enabledSharedBackend) {
      lines.push(
        "A backend was just attached for this request. Use it for real persistence and accounts — no local-only state standing in for saved data.",
      );
    }
    for (const b of briefs) lines.push(`- ${b}`);
    lines.push(
      "Never end your reply by asking the user to enable, turn on or connect any of the above. Build it.",
    );
  }

  if (blocked.includes("domain")) {
    lines.push(
      "The user mentioned a custom web address. Build everything else; mention in one sentence that buying or connecting the address is the one step they have to do themselves.",
    );
  }
  if (blocked.includes("payment")) {
    lines.push(
      "The user mentioned taking payments. Build the checkout screens and data model; mention in one sentence that connecting the payment account is the one step they have to do themselves.",
    );
  }

  const userNote = blocked.includes("domain")
    ? "Buying or connecting a web address is the one part I can't do for you."
    : blocked.includes("payment")
      ? "Connecting a payment account is the one part I can't do for you."
      : null;

  return {
    intents,
    enabledSharedBackend,
    promptBlock: lines.length > 0 ? `\n\n${lines.join("\n")}\n` : "",
    userNote,
  };
}
