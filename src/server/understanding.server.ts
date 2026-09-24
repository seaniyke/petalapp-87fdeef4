/**
 * Phase 1 — Semantic understanding.
 *
 * Kimble's pre-generation triage was lexical: regexes over the prompt decided
 * platform, backend needs and surfaces. That works for "build a landing page"
 * and fails for "a portal where parents pay school fees and see results",
 * which needs auth, roles, payments and two distinct surfaces but contains
 * none of the trigger words.
 *
 * This module runs one cheap model pass that reads the request the way a
 * product engineer would, and returns a structured `PicUnderstanding`.
 *
 * Contract:
 *  - forced tool call, strict schema, no prose,
 *  - fast/cheap model — this runs on every structural turn,
 *  - EVERY failure path returns the deterministic reading. It can never
 *    block or fail a build.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { resolveBuildTarget } from "@/lib/target-inference";
import { MAX_USER_PROMPT_CHARS } from "@/lib/prompt-limits";
import type { BuildTargetId } from "@/lib/build-targets";
import type { Confidence, PicUnderstanding } from "./pic/pic-types";

const MODEL = "deepseek/deepseek-v4-flash";

const PLATFORMS: BuildTargetId[] = ["web", "mobile", "web-mobile", "backend", "extension"];

const SYSTEM = `You are Kimble's product engineer. You read a build request and decide what is ACTUALLY being asked for, the way a senior engineer would before writing a line of code.

Rules:
- Read intent, not keywords. "Parents pay fees and see results" means auth, roles, payments and a database even though none of those words appear.
- Build the SMALLEST COMPLETE product that delivers the outcome. Never add auth, dashboards, admin or checkout the request does not require.
- A product that has customers AND operators needs both a marketing surface and an application surface. A single-purpose tool needs neither — it is one public page.
- Mark confidence honestly. "inferred" is the normal case; use "uncertain" only when a wrong guess would change the architecture.
- Only set needsClarification when a wrong guess would change the architecture AND the question is answerable in one line.
- firstVersion is what must exist for the product to be usable at all. Keep it under 8 items.

Reply only by calling record_understanding.`;

const CONFIDENCE_ENUM = ["confident", "inferred", "uncertain"];

const TOOL = {
  type: "function" as const,
  function: {
    name: "record_understanding",
    description: "Record the semantic reading of the build request.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence: what is being built." },
        productType: {
          type: "string",
          description: "e.g. saas, marketplace, fintech, landing-page, utility, content-site, social, game, api, internal-tool",
        },
        domain: { type: "string", description: "Human domain, e.g. 'school administration'." },
        targetUsers: { type: "array", items: { type: "string" } },
        userProblem: { type: "string" },
        platforms: { type: "array", items: { type: "string", enum: PLATFORMS } },
        marketingSurface: { type: "boolean" },
        applicationSurface: { type: "boolean" },
        adminSurface: { type: "boolean" },
        needsBackend: { type: "boolean" },
        needsAuth: { type: "boolean" },
        needsDatabase: { type: "boolean" },
        needsPayments: { type: "boolean" },
        needsRealtime: { type: "boolean" },
        needsStorage: { type: "boolean" },
        needsScheduledJobs: { type: "boolean" },
        needsExternalApis: { type: "boolean" },
        roles: { type: "array", items: { type: "string" } },
        firstVersion: { type: "array", items: { type: "string" } },
        outOfScope: { type: "array", items: { type: "string" } },
        platformConfidence: { type: "string", enum: CONFIDENCE_ENUM },
        backendConfidence: { type: "string", enum: CONFIDENCE_ENUM },
        authConfidence: { type: "string", enum: CONFIDENCE_ENUM },
        paymentsConfidence: { type: "string", enum: CONFIDENCE_ENUM },
        surfacesConfidence: { type: "string", enum: CONFIDENCE_ENUM },
        needsClarification: { type: "boolean" },
        clarifyingQuestion: { type: "string" },
      },
      required: [
        "summary",
        "productType",
        "domain",
        "userProblem",
        "platforms",
        "marketingSurface",
        "applicationSurface",
        "needsBackend",
        "needsAuth",
        "needsDatabase",
        "firstVersion",
      ],
      additionalProperties: false,
    },
  },
};

const PAYMENT_RE =
  /\b(pay|payment|checkout|subscription|billing|invoice|stripe|paystack|paddle|pricing tier|fees?|donat)/i;
const REALTIME_RE = /\b(real[- ]?time|live (chat|feed|updates?)|chat|messaging|presence|collaborat)/i;
const STORAGE_RE = /\b(upload|file|photo|image gallery|document|attachment|avatar|pdf)/i;
const CRON_RE = /\b(cron|scheduled?|daily digest|reminder|recurring|nightly|weekly report)/i;
const API_RE = /\b(api|webhook|integrat|third[- ]party|sync with|import from)/i;
const MARKETING_RE = /\b(landing|marketing|website|homepage|waitlist|portfolio|blog|brochure)/i;
const APP_RE =
  /\b(dashboard|portal|app|admin|manage|track|crm|workspace|account|inventory|booking|order)/i;
const ADMIN_RE = /\b(admin|moderat|back[- ]?office|staff|operator|approve|review queue)/i;

/** Rules-only reading. Always available, always safe. */
export function deterministicUnderstanding(brief: string): PicUnderstanding {
  const text = (brief ?? "").trim();
  const prd = deterministicPrd(text);
  const target = resolveBuildTarget(null, text);

  const needsPayments = PAYMENT_RE.test(text);
  const needsRealtime = REALTIME_RE.test(text);
  const needsStorage = STORAGE_RE.test(text);
  const needsAuth = prd.needsAuth || needsPayments;
  const needsDatabase = prd.needsPersistence || needsAuth || needsPayments;

  const application = APP_RE.test(text) || needsAuth || prd.productType === "workflow-app";
  const marketing = MARKETING_RE.test(text) || (!application && prd.productType !== "utility");

  return {
    summary: prd.purpose,
    productType: prd.productType,
    domain: prd.domain,
    targetUsers: prd.targetUser ? [prd.targetUser] : [],
    userProblem: prd.primaryOutcome,
    platforms: [target.target],
    surfaces: {
      marketing: marketing || (!application && !marketing),
      application,
      admin: ADMIN_RE.test(text),
    },
    needsBackend: needsDatabase || needsAuth,
    needsAuth,
    needsDatabase,
    needsPayments,
    needsRealtime,
    needsStorage,
    needsScheduledJobs: CRON_RE.test(text),
    needsExternalApis: API_RE.test(text),
    roles: prd.roles ?? [],
    firstVersion: prd.requiredSurfaces.map(String),
    outOfScope: prd.outOfScope ?? [],
    confidence: {
      platform: target.source === "inferred" ? "inferred" : "confident",
      backend: "inferred",
      auth: "inferred",
      payments: needsPayments ? "inferred" : "confident",
      surfaces: "inferred",
    },
    needsClarification: false,
    source: "deterministic",
  };
}

function conf(v: unknown, fallback: Confidence): Confidence {
  return v === "confident" || v === "inferred" || v === "uncertain" ? v : fallback;
}

function strings(v: unknown, cap = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
}

/**
 * Model-backed semantic understanding. Never throws; falls back to rules.
 *
 * @param brief   The user's request (latest turn, plus any earlier context the
 *                caller wants to include).
 * @param opts.prior  Understanding from a previous turn, used as a prior so
 *                    follow-up turns refine rather than re-derive.
 */
export async function understandRequest(
  brief: string,
  opts: { userId?: string; projectId?: string | null; prior?: PicUnderstanding | null; signal?: AbortSignal } = {},
): Promise<PicUnderstanding> {
  const fallback = deterministicUnderstanding(brief);
  if (!process.env.OPENROUTER_API_KEY) return fallback;
  if ((brief ?? "").trim().length < 4) return fallback;

  try {
    const priorBlock = opts.prior
      ? `\n\nWhat Kimble already understood about this project (refine it, do not discard it):\n${JSON.stringify(
          {
            summary: opts.prior.summary,
            productType: opts.prior.productType,
            domain: opts.prior.domain,
            platforms: opts.prior.platforms,
            surfaces: opts.prior.surfaces,
            needsAuth: opts.prior.needsAuth,
            needsPayments: opts.prior.needsPayments,
            roles: opts.prior.roles,
          },
          null,
          1,
        )}`
      : "";

    const res = await aiChatCompletions({
      feature: "preflight",
      lockCallerModel: true,
      signal: opts.signal,
      meta: { userId: opts.userId, projectId: opts.projectId ?? null },
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Build request:\n"""${(brief ?? "").slice(0, MAX_USER_PROMPT_CHARS)}"""

Rules-based draft to correct:
${JSON.stringify(
  {
    productType: fallback.productType,
    domain: fallback.domain,
    platforms: fallback.platforms,
    surfaces: fallback.surfaces,
    needsAuth: fallback.needsAuth,
    needsDatabase: fallback.needsDatabase,
    needsPayments: fallback.needsPayments,
  },
  null,
  1,
)}${priorBlock}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "record_understanding" } },
        stream: false,
      },
    } as Parameters<typeof aiChatCompletions>[0]);

    if (!res.ok) return fallback;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return fallback;
    const raw = JSON.parse(args) as Record<string, unknown>;

    const platforms = strings(raw.platforms, 3).filter((p): p is BuildTargetId =>
      (PLATFORMS as string[]).includes(p),
    );

    const needsAuth = raw.needsAuth === true;
    const needsPayments = raw.needsPayments === true;
    const needsDatabase = raw.needsDatabase === true || needsAuth || needsPayments;

    return {
      summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : fallback.summary,
      productType:
        typeof raw.productType === "string" && raw.productType.trim()
          ? raw.productType.trim()
          : fallback.productType,
      domain: typeof raw.domain === "string" && raw.domain.trim() ? raw.domain.trim() : fallback.domain,
      targetUsers: strings(raw.targetUsers, 6).length ? strings(raw.targetUsers, 6) : fallback.targetUsers,
      userProblem:
        typeof raw.userProblem === "string" && raw.userProblem.trim()
          ? raw.userProblem.trim()
          : fallback.userProblem,
      platforms: platforms.length ? platforms : fallback.platforms,
      surfaces: {
        marketing: raw.marketingSurface === true,
        application: raw.applicationSurface === true,
        admin: raw.adminSurface === true,
      },
      needsBackend: raw.needsBackend === true || needsDatabase,
      needsAuth,
      needsDatabase,
      needsPayments,
      needsRealtime: raw.needsRealtime === true,
      needsStorage: raw.needsStorage === true,
      needsScheduledJobs: raw.needsScheduledJobs === true,
      needsExternalApis: raw.needsExternalApis === true,
      roles: strings(raw.roles, 8),
      firstVersion: strings(raw.firstVersion, 8).length ? strings(raw.firstVersion, 8) : fallback.firstVersion,
      outOfScope: strings(raw.outOfScope, 8),
      confidence: {
        platform: conf(raw.platformConfidence, "inferred"),
        backend: conf(raw.backendConfidence, "inferred"),
        auth: conf(raw.authConfidence, "inferred"),
        payments: conf(raw.paymentsConfidence, "inferred"),
        surfaces: conf(raw.surfacesConfidence, "inferred"),
      },
      needsClarification: raw.needsClarification === true && typeof raw.clarifyingQuestion === "string",
      clarifyingQuestion:
        typeof raw.clarifyingQuestion === "string" ? raw.clarifyingQuestion.trim() : undefined,
      source: "model",
    };
  } catch (e) {
    console.warn("[understanding] falling back to rules:", e instanceof Error ? e.message : String(e));
    return fallback;
  }
}

/** Compact prompt block. Kept small — this rides on every structural turn. */
export function renderUnderstandingBlock(u: PicUnderstanding): string {
  const needs = [
    u.needsAuth && "auth",
    u.needsDatabase && "database",
    u.needsPayments && "payments",
    u.needsRealtime && "realtime",
    u.needsStorage && "file storage",
    u.needsScheduledJobs && "scheduled jobs",
    u.needsExternalApis && "external APIs",
  ].filter(Boolean) as string[];

  const surfaces = [
    u.surfaces.marketing && "marketing site",
    u.surfaces.application && "application",
    u.surfaces.admin && "admin",
  ].filter(Boolean) as string[];

  return [
    "## WHAT YOU ARE BUILDING (understood, not guessed)",
    `Product: ${u.summary}`,
    `Type: ${u.productType} · Domain: ${u.domain}`,
    u.targetUsers.length ? `Users: ${u.targetUsers.join(", ")}` : "",
    `Problem: ${u.userProblem}`,
    `Platforms: ${u.platforms.join(", ")}`,
    `Surfaces required: ${surfaces.length ? surfaces.join(" + ") : "single page"}`,
    `Backend needs: ${needs.length ? needs.join(", ") : "none — keep it frontend-only"}`,
    u.roles.length ? `Roles: ${u.roles.join(", ")}` : "",
    u.firstVersion.length ? `First version must include:\n${u.firstVersion.map((f) => `- ${f}`).join("\n")}` : "",
    u.outOfScope.length ? `Out of scope: ${u.outOfScope.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
