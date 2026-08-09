/**
 * W2 — semantic severity judgement.
 *
 * Regexes decided, until now, whether a browser-check finding takes a preview
 * offline. They are blunt in both directions: a harmless favicon 404 matches
 * /HTTP 4\d\d/ and rolls back a healthy build, while a genuinely dead primary
 * CTA phrased in an unexpected way slips through as "advisory".
 *
 * This module asks a model to read each finding the way a reviewer would and
 * label it. The regex partition stays as the deterministic prior: the judge
 * may only *reclassify* findings, and any failure (no key, bad JSON, timeout)
 * falls straight back to the regex verdict. Severity is never decided by an
 * absent model.
 */
import { partitionVerificationDefects } from "@/lib/verification-report";
import { aiChatCompletions } from "@/server/ai-provider.server";

const MODEL = "google/gemini-2.5-flash";
const MAX_DEFECTS = 24;
const TIMEOUT_MS = 20_000;

export type DefectSeverity = "blocking" | "visual" | "advisory" | "noise";

export interface JudgedDefects {
  blocking: string[];
  visual: string[];
  advisory: string[];
  /** Findings the judge identified as checker artefacts, dropped entirely. */
  noise: string[];
  /** True when a model actually produced the verdict. */
  judged: boolean;
  reasons: Record<string, string>;
}

const RULES = `You are Petal's release reviewer. You are given findings from an automated browser check of a freshly generated web app, plus the user's request.
Label each finding with exactly one severity:

- "blocking": the app is genuinely broken for a normal user — blank/erroring page, uncaught runtime error, a primary navigation link or form that does nothing, the main requested feature missing or non-functional, an HTTP 5xx on a real page.
- "visual": the page works but looks wrong — overlap, clipping, unreadable contrast, cramped mobile layout, overflow.
- "advisory": real but minor — a missing favicon, a 404 on a decorative asset, a slow request, a console warning, a secondary nicety.
- "noise": the finding describes the checker itself, not the app — invented user journeys whose element never existed, probe/instrumentation failures, CDN propagation errors (502/503/504/52x) on a URL that is otherwise serving.

Be conservative in BOTH directions: do not call a cosmetic nit blocking, and do not excuse a dead primary action as advisory.

Respond with JSON only:
{"verdicts":[{"i":<index of the finding>,"severity":"blocking|visual|advisory|noise","why":"<max 15 words>"}]}
Include every index exactly once.`;

function safeParse(content: string): { i: unknown; severity: unknown; why: unknown }[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as { verdicts?: unknown };
    return Array.isArray(parsed?.verdicts)
      ? (parsed.verdicts as { i: unknown; severity: unknown; why: unknown }[])
      : [];
  } catch {
    return [];
  }
}

function fallback(defects: unknown): JudgedDefects {
  const p = partitionVerificationDefects(defects);
  return { ...p, noise: [], judged: false, reasons: {} };
}

/**
 * Classify browser-check findings by severity. Never throws; degrades to the
 * deterministic regex partition.
 */
export async function judgeDefects(args: {
  defects: unknown;
  /** What the user asked for this turn, so the judge can spot a missing feature. */
  intent?: string | null;
  projectId?: string | null;
  userId?: string | null;
}): Promise<JudgedDefects> {
  const prior = partitionVerificationDefects(args.defects);
  const all = [...prior.blocking, ...prior.visual, ...prior.advisory];
  if (all.length === 0) return { ...prior, noise: [], judged: false, reasons: {} };
  if (all.length > MAX_DEFECTS) return fallback(args.defects);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const listing = all.map((d, i) => `${i}. ${d}`).join("\n");
    const res = await aiChatCompletions({
      feature: "design",
      budgetAware: true,
      body: {
        model: MODEL,
        temperature: 0,
        max_tokens: 800,
        messages: [
          { role: "system", content: RULES },
          {
            role: "user",
            content: [
              args.intent ? `User request: ${args.intent.slice(0, 1200)}` : "User request: unknown.",
              "",
              "Findings:",
              listing,
            ].join("\n"),
          },
        ],
      },
      signal: controller.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "defect-judge",
      },
    });
    if (!res.ok) return fallback(args.defects);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const verdicts = safeParse(json.choices?.[0]?.message?.content ?? "");
    if (verdicts.length === 0) return fallback(args.defects);

    const out: JudgedDefects = {
      blocking: [],
      visual: [],
      advisory: [],
      noise: [],
      judged: true,
      reasons: {},
    };
    const seen = new Set<number>();
    for (const v of verdicts) {
      const i = typeof v?.i === "number" ? v.i : Number(v?.i);
      if (!Number.isInteger(i) || i < 0 || i >= all.length || seen.has(i)) continue;
      const severity = String(v?.severity ?? "").toLowerCase() as DefectSeverity;
      if (!["blocking", "visual", "advisory", "noise"].includes(severity)) continue;
      seen.add(i);
      const defect = all[i]!;
      out[severity].push(defect);
      const why = typeof v?.why === "string" ? v.why.trim().slice(0, 120) : "";
      if (why) out.reasons[defect] = why;
    }
    // Anything the judge skipped keeps its deterministic verdict.
    for (let i = 0; i < all.length; i += 1) {
      if (seen.has(i)) continue;
      const defect = all[i]!;
      if (prior.blocking.includes(defect)) out.blocking.push(defect);
      else if (prior.visual.includes(defect)) out.visual.push(defect);
      else out.advisory.push(defect);
    }
    return out;
  } catch {
    return fallback(args.defects);
  } finally {
    clearTimeout(timer);
  }
}
