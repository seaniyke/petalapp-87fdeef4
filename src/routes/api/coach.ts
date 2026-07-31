/**
 * /api/coach — Idea Coach turn endpoint.
 *
 * One POST per coach turn. The client sends the running history and the user's
 * latest answer; we return either the next question + chip choices, or — if
 * the coach has enough — the final assembled build prompt the user can submit.
 *
 * Pricing: 0.5 credit per turn, charged AFTER the AI replies successfully
 * (mirrors /api/discuss and /api/generate). Hard-capped at 4 turns server-side
 * so worst-case spend per session is 2 credits.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { spendCredit, refundCredit } from "@/server/credits.server";
import {
  coachTurn,
  MAX_COACH_TURNS,
  type CoachExchange,
} from "@/server/idea-coach.server";

const COACH_TURN_COST = 0.5;

type Body = {
  /** 1-based turn number. */
  turn?: number;
  history?: CoachExchange[];
  userInput?: string;
};

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  return data.claims.sub;
}

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorize(request);
        if (authResult instanceof Response) return authResult;
        const userId = authResult;

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        const turn = Math.max(1, Math.min(MAX_COACH_TURNS, Number(body.turn) || 1));
        const history = Array.isArray(body.history)
          ? body.history
              .filter(
                (h): h is CoachExchange =>
                  !!h && typeof h.question === "string" && typeof h.answer === "string",
              )
              .slice(-MAX_COACH_TURNS)
          : [];
        const userInput = typeof body.userInput === "string" ? body.userInput.slice(0, 500) : "";

        // Pre-flight balance check. We charge 0.5 credit AFTER the AI replies.
        const reservation = await spendCredit({ userId, amount: COACH_TURN_COST, reason: "ai_coach_charge", metadata: { route: "/api/coach", turn, reserved: true } });
        if (!reservation.ok) {
          if (reservation.reason === "insufficient_credits") {
            return new Response(
              "Coach needs ½ credit to keep going. Top up in Settings → Plans & Credits.",
              { status: 402 },
            );
          }
          return new Response("Could not verify credit balance. Try again.", { status: 500 });
        }

        let result;
        try {
          result = await coachTurn({ turn, history, userInput });
        } catch (e) {
          await refundCredit({ userId, ledgerId: reservation.ledgerId, reason: "coach_failed" });
          const status = (e as { status?: number }).status;
          if (status === 429) {
            return new Response("Coach is a bit busy. Try again in a moment.", { status: 429 });
          }
          if (status === 402) {
            return new Response(
              "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
              { status: 402 },
            );
          }
          console.error("[coach] upstream error", e);
          return new Response("Coach is having trouble right now. Try again.", { status: 502 });
        }

        // Charge ONCE, after success. Fractional 0.5 — wallet ledger is numeric(10,2).
        return Response.json({
          ...result,
          turn,
          maxTurns: MAX_COACH_TURNS,
          costCharged: COACH_TURN_COST,
        });
      },
    },
  },
});
