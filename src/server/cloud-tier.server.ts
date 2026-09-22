/**
 * Kimble Cloud — the single place that decides which tier a project needs.
 *
 * Kimble Cloud is one product with three tiers. The user never picks one;
 * Kimble reads what the app actually does and chooses.
 *
 *   kimble          shared database, auth, REST      default for every app
 *   kimble_plus     the app's own Postgres, storage  growth or SQL/storage/realtime
 *   kimble_compute  isolated container               long-running / custom runtime work
 *
 * The read is deterministic — no extra AI call. It looks at the app's own
 * description and at what the generated code asks for, then maps that onto a
 * tier. Being wrong is cheap in one direction only, so the rule is:
 * never pick a higher tier on a weak signal.
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SHARED_LIMITS } from "@/server/shared-backend.server";

export type CloudTier = "kimble" | "kimble_plus" | "kimble_compute";

export const TIER_LABEL: Record<CloudTier, string> = {
  kimble: "Kimble",
  kimble_plus: "Kimble +",
  kimble_compute: "Kimble Compute",
};

export type TierSignal = {
  tier: CloudTier;
  /** Plain-language reason, safe to show the owner. */
  reason: string;
  /** The phrases that triggered it — for logs and the admin view. */
  matched: string[];
};

/* ------------------------------------------------------------------ *
 * Intent read — what the app says it does
 * ------------------------------------------------------------------ */

/** Work that genuinely needs a server we control: long jobs, sockets,
 *  native binaries, scheduled processing, heavy media. */
const COMPUTE_PATTERNS: [RegExp, string][] = [
  [/\bffmpeg\b|\btranscode|\bvideo (?:processing|encoding|conversion)/i, "video processing"],
  [/\bimage (?:processing|resizing) (?:pipeline|service)\b|\bsharp\b|\bimagemagick\b/i, "image processing"],
  [/\bwebsocket|\bsocket\.io\b|\blive (?:cursor|collaboration)\b/i, "websockets"],
  [/\bbackground (?:job|worker|queue)\b|\bjob queue\b|\bbullmq\b|\bcelery\b/i, "background jobs"],
  [/\bweb ?scrap(?:er|ing)\b|\bcrawler\b|\bheadless (?:chrome|browser)\b|\bpuppeteer\b|\bplaywright\b/i, "scraping"],
  [/\blong[- ]running\b|\bbatch process(?:ing|or)\b|\bmachine learning\b|\btrain (?:a )?model\b/i, "long-running work"],
  [/\bpython (?:service|backend|script)\b|\bgo (?:service|binary)\b|\bcustom server\b|\bexpress server\b/i, "custom server runtime"],
  [/\bgit (?:clone|server)\b|\bdocker\b|\bshell command|\bsubprocess\b/i, "system-level work"],
  [/\bpdf (?:generation|rendering)\b|\bheadless pdf\b/i, "document rendering"],
];

/** Things the shared tier structurally cannot do. */
const PLUS_PATTERNS: [RegExp, string][] = [
  [/\bfile upload|\bupload (?:images?|files?|documents?|photos?)\b|\bstorage bucket\b/i, "file storage"],
  [/\braw sql\b|\bsql quer(?:y|ies)\b|\bjoin(?:s|ed)? across\b|\bdatabase view\b|\bstored procedure\b/i, "SQL access"],
  [/\brealtime\b|\breal[- ]time (?:chat|updates|sync)\b|\blive updates\b|\bsubscriptions?\b/i, "realtime updates"],
  [/\bfull[- ]text search\b|\bvector search\b|\bembeddings?\b/i, "advanced search"],
  [/\bmulti[- ]tenant\b|\brow level security\b|\bteam workspaces?\b/i, "tenant isolation"],
];

function scan(text: string, patterns: [RegExp, string][]): string[] {
  const hits: string[] = [];
  for (const [re, label] of patterns) if (re.test(text)) hits.push(label);
  return hits;
}

/**
 * Read the tier a description implies. Pure — safe to unit test and to call
 * during generation with the app spec, the user's prompt, or both.
 */
export function detectTierFromIntent(text: string): TierSignal {
  const haystack = (text ?? "").slice(0, 20_000);
  const compute = scan(haystack, COMPUTE_PATTERNS);
  if (compute.length) {
    return {
      tier: "kimble_compute",
      reason: `This app needs its own server for ${compute.join(", ")}.`,
      matched: compute,
    };
  }
  const plus = scan(haystack, PLUS_PATTERNS);
  if (plus.length) {
    return {
      tier: "kimble_plus",
      reason: `This app needs its own database for ${plus.join(", ")}.`,
      matched: plus,
    };
  }
  return {
    tier: "kimble",
    reason: "Database, sign-in and an API are all this app needs.",
    matched: [],
  };
}

/** Highest of two tiers — a project never silently drops down. */
const ORDER: CloudTier[] = ["kimble", "kimble_plus", "kimble_compute"];
export function highestTier(a: CloudTier, b: CloudTier): CloudTier {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/* ------------------------------------------------------------------ *
 * Live read — what the project actually is right now
 * ------------------------------------------------------------------ */

export type ResolvedTier = TierSignal & {
  /** The tier the project is running on today. */
  current: CloudTier;
  /** True when `tier` is above `current` and an upgrade is warranted. */
  needsUpgrade: boolean;
  rows: number;
  users: number;
};

/**
 * The single answer to "what does this project need?".
 *
 * Combines three inputs, taking the highest:
 *   - what the app described at generation time (stored on the project),
 *   - how big it has actually grown on the shared tier,
 *   - whether it already has a dedicated database or a compute container.
 *
 * Never throws: on any read failure it reports the safe default so nothing
 * upstream is blocked.
 */
export async function resolveCloudTier(projectId: string): Promise<ResolvedTier> {
  const safe: ResolvedTier = {
    tier: "kimble",
    current: "kimble",
    needsUpgrade: false,
    reason: "Database, sign-in and an API are all this app needs.",
    matched: [],
    rows: 0,
    users: 0,
  };
  try {
    const [{ data: project }, { data: compute }, { data: backend }, { count: rows }, { count: users }] =
      await Promise.all([
        supabaseAdmin
          .from("projects")
          .select("cloud_tier_intent")
          .eq("id", projectId)
          .maybeSingle(),
        supabaseAdmin
          .from("project_compute")
          .select("status")
          .eq("project_id", projectId)
          .maybeSingle(),
        supabaseAdmin
          .from("project_backends")
          .select("provider, status")
          .eq("project_id", projectId)
          .maybeSingle(),
        supabaseAdmin
          .from("shared_app_records")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
        supabaseAdmin
          .from("shared_app_users")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
      ]);

    const rowCount = rows ?? 0;
    const userCount = users ?? 0;

    let current: CloudTier = "kimble";
    if (backend?.provider === "managed_petal" && backend.status === "ready") {
      current = "kimble_plus";
    }
    if (compute && compute.status !== "deleted") current = "kimble_compute";

    const intentRaw = (project as { cloud_tier_intent?: string } | null)?.cloud_tier_intent;
    let wanted: CloudTier = (ORDER as string[]).includes(intentRaw ?? "")
      ? (intentRaw as CloudTier)
      : "kimble";
    let reason =
      wanted === "kimble"
        ? safe.reason
        : `This app was built needing ${TIER_LABEL[wanted].toLowerCase()}.`;
    const matched: string[] = [];

    // Growth on the shared tier is its own signal.
    if (rowCount >= SHARED_LIMITS.maxRowsPerProject * 0.8) {
      wanted = highestTier(wanted, "kimble_plus");
      reason = "This app has outgrown the shared database.";
      matched.push("rows");
    }
    if (userCount >= 50) {
      wanted = highestTier(wanted, "kimble_plus");
      reason = "This app has enough signed-up users to need its own database.";
      matched.push("users");
    }

    return {
      tier: highestTier(wanted, current),
      current,
      needsUpgrade: ORDER.indexOf(wanted) > ORDER.indexOf(current),
      reason,
      matched,
      rows: rowCount,
      users: userCount,
    };
  } catch (err) {
    console.warn("[cloud-tier] resolve failed, defaulting to shared", projectId, err);
    return safe;
  }
}

/** Record what a newly generated app said it needs. Best effort. */
export async function recordTierIntent(projectId: string, text: string): Promise<TierSignal> {
  const signal = detectTierFromIntent(text);
  try {
    await supabaseAdmin
      .from("projects")
      .update({ cloud_tier_intent: signal.tier } as never)
      .eq("id", projectId);
  } catch (err) {
    console.warn("[cloud-tier] intent write failed", projectId, err);
  }
  return signal;
}
