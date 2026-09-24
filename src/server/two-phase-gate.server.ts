/**
 * Two-phase generation gate (smart variant).
 *
 * Goal: on a user's very first turn, never let Kimble write backend code
 * (auth, RLS, server fns, supabase wiring) IN THE SAME TURN as the
 * frontend scaffold. The frontend ships first; backend is proposed via
 * suggestions and only generated on the *next* turn after the user opts in.
 *
 * Smart variant: skip the gate when the user explicitly asks for a
 * full-stack build ("with auth", "include backend", "full saas", etc.).
 * They told us they want it all in one shot — respect that.
 *
 * The gate is a no-op when:
 *   - the project already has files (not turn 1)
 *   - the project already has a backend connected (we're past phase 1)
 *   - the user explicitly asked for backend in their prompt
 *   - the user's prompt doesn't imply backend at all (nothing to defer)
 */

import { detectBackendIntent } from "@/lib/backend-intent";

const EXPLICIT_FULLSTACK_RE =
  /\b(?:full[- ]?stack|full[- ]?saas|with (?:auth|backend|database|db|supabase)|including (?:auth|backend|database)|include (?:auth|backend|database)|build (?:the )?(?:whole|entire) (?:thing|app|stack)|end[- ]?to[- ]?end)\b/i;

export type BackendGateDecision = {
  /** When true, strip backend work from this turn and propose it via suggestions. */
  gated: boolean;
  /** Chips to render on the assistant message so the user can confirm next-turn backend. */
  suggestions: string[];
  /** Human-readable reason (telemetry / logging). */
  reason: string;
};

export function decideBackendGate(args: {
  isInitial: boolean;
  hasBackendConnected: boolean;
  userPrompt: string;
}): BackendGateDecision {
  if (!args.isInitial) {
    return { gated: false, suggestions: [], reason: "not_initial_turn" };
  }
  if (args.hasBackendConnected) {
    return { gated: false, suggestions: [], reason: "backend_already_connected" };
  }
  if (EXPLICIT_FULLSTACK_RE.test(args.userPrompt)) {
    return { gated: false, suggestions: [], reason: "user_asked_fullstack_explicitly" };
  }
  const intent = detectBackendIntent(args.userPrompt);
  if (!intent.detected) {
    return { gated: false, suggestions: [], reason: "no_backend_intent" };
  }

  // User intent is the highest authority. Backend intent detected in the
  // user's OWN words is a request, not an accident, so it is never deferred
  // to a second turn. The gate stays in the codebase only to record that the
  // decision was made deliberately.
  return {
    gated: false,
    suggestions: [],
    reason: `user_intent_first:${intent.reason ?? "backend_intent"}`,
  };
}

/** System-prompt block that hard-blocks backend code emission for this turn. */
export function renderBackendGateBlock(): string {
  return `\n\n### Two-phase build (HARD CONSTRAINT — this turn)\nThis is the user's FIRST turn. Build the frontend ONLY. You MUST NOT:\n- create or import a Supabase client, server function, RLS policy, or migration\n- write code under \`src/integrations/backend/*\`, \`src/server/*\`, or any \`*.functions.ts\` / \`*.server.ts\` file\n- wire auth flows, login forms that POST to a backend, or database CRUD\n- assume any table or auth user exists\n\nIf the user's idea implies persistence (accounts, saved data, payments, file upload, email), build the complete requested UI with concise realistic local data. Do not add extra sections or verbose seed content merely to simulate a backend. End your summary with one short line: "I'll wire up the backend next — pick what to add from the suggestions below." Kimble will surface the suggestion chips automatically.\n`;
}

