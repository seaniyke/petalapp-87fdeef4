/**
 * Client helper for /api/coach.
 *
 * One call per coach turn. Returns the parsed turn result so the IdeaCoach
 * component can either render the next question or hand the assembled prompt
 * back to the composer.
 */
import { supabase } from "@/integrations/supabase/client";
import { throwIfCreditsExhausted } from "@/lib/friendly-errors";
import type { CoachExchange, CoachTurnOutput } from "@/server/idea-coach.server";

export type CoachTurnReply = CoachTurnOutput & {
  turn: number;
  maxTurns: number;
  costCharged: number;
};

export async function requestCoachTurn(
  body: { turn: number; history: CoachExchange[]; userInput: string },
  signal?: AbortSignal,
): Promise<CoachTurnReply> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to use Idea Coach.");

  const resp = await fetch("/api/coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throwIfCreditsExhausted(resp, text);
    const err = new Error(text || `Request failed (${resp.status})`) as Error & {
      status?: number;
    };
    err.status = resp.status;
    throw err;
  }
  return (await resp.json()) as CoachTurnReply;
}

export type { CoachExchange } from "@/server/idea-coach.server";
