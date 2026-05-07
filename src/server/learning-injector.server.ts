/**
 * Self-learning prompt injector.
 *
 * Reads the most recent daily digest from `petal_self_learning_digests` and
 * renders a compact "Lessons learned" block to append to the generate
 * system prompt. This is the missing feedback loop: the digest cron writes
 * top failure signatures + recommendations to the database every day, but
 * until now nothing read them back into the prompt — so Petal kept making
 * the same mistakes the digest had already flagged.
 *
 * Behavior:
 *  - One-shot per cold worker, cached in-memory for 30 minutes. The digest
 *    only changes once a day; re-querying on every turn is wasted latency.
 *  - Empty / missing digest → empty string. Never throws.
 *  - Caps the number of items so the prompt stays small.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface CachedBlock {
  text: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let cached: CachedBlock | null = null;

interface DigestRow {
  period_date: string;
  recommendations: unknown;
  top_failure_signatures: unknown;
}

interface FailureSig {
  signature?: string;
  count?: number;
  sampleMessage?: string;
}

export async function renderLearningBlock(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.text;

  let text = "";
  try {
    const { data } = await supabaseAdmin
      .from("petal_self_learning_digests" as never)
      .select("period_date, recommendations, top_failure_signatures")
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle<DigestRow>();

    if (data) {
      const recs = Array.isArray(data.recommendations)
        ? (data.recommendations as string[]).slice(0, 4)
        : [];
      const sigs = Array.isArray(data.top_failure_signatures)
        ? (data.top_failure_signatures as FailureSig[]).slice(0, 5)
        : [];

      const lines: string[] = [];
      if (sigs.length > 0) {
        lines.push("Recent failure signatures (avoid repeating these):");
        for (const s of sigs) {
          const sig = (s.signature ?? "").toString().slice(0, 100);
          if (!sig) continue;
          const count = typeof s.count === "number" ? s.count : 0;
          lines.push(`- ${sig}${count > 1 ? ` (×${count})` : ""}`);
        }
      }
      if (recs.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("Operator notes from yesterday's quality digest:");
        for (const r of recs) lines.push(`- ${String(r).slice(0, 280)}`);
      }
      if (lines.length > 0) {
        text = `\n\n[Lessons learned — last digest ${data.period_date}]\nThese are real failure modes Petal hit recently. Read them, and do NOT reproduce them this turn.\n${lines.join("\n")}`;
      }
    }
  } catch (e) {
    console.warn("[learning-injector] skipped:", e);
  }

  cached = { text, expiresAt: Date.now() + CACHE_TTL_MS };
  return text;
}

/** Test-only: clear the in-memory cache. */
export function _resetLearningCache(): void {
  cached = null;
}
