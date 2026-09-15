/**
 * Verification planner — decides what the headless browser should do to a
 * freshly-deployed project.
 *
 * The verifier itself (builder/src/verify.ts) is deliberately dumb: it executes
 * a declarative plan. All the knowledge about *this* app — which routes exist,
 * where the sign-up form lives, which routes are gated, what the app's core
 * write action is — is derived here, where the source files are.
 *
 * Two tiers:
 *   - Routes + auth detection are deterministic regex over the project files.
 *     They must never fail; a bad plan silently degrades to "just load /".
 *   - Write flows are drafted by a budget-tier model, because "what is this
 *     app's primary create action" is a judgement call. If the model is slow,
 *     unavailable, or returns junk, we ship the plan without flows rather than
 *     block the build.
 *
 * Test identities: every seeded account uses the reserved `petal-verify+…`
 * local part and a random password, so accounts created in the user's own
 * backend are always identifiable as Petal's and never collide across builds.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { ProjectFile } from "@/server/generate.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import type { Prd } from "@/server/prd/prd-types";
import { prdBrowserScenarios } from "@/server/prd/prd-acceptance.server";

const MODEL = "google/gemini-2.5-flash-lite";

export interface VerifyStep {
  action: "goto" | "click" | "fill" | "select" | "expectText" | "expectUrl" | "wait";
  path?: string;
  selector?: string;
  value?: string;
  ms?: number;
  optional?: boolean;
}

export interface VerifyFlow {
  name: string;
  requiresAuth?: boolean;
  steps: VerifyStep[];
}

export interface VerifyPlan {
  routes: string[];
  auth?: {
    signupPath: string;
    loginPath: string;
    email: string;
    password: string;
    name?: string;
    protectedRoutes: string[];
  };
  flows?: VerifyFlow[];
  screenshots?: boolean;
  /** Visual QA capture request (mobile + desktop screenshots for vision scoring). */
  visual?: { widths?: number[]; routes?: string[] };
}

/** Mirrors the builder's caps so we never send a plan it will reject. */
const MAX_ROUTES = 12;
const MAX_FLOWS = 4;
const MAX_STEPS = 20;

const ROUTE_PATH_RE = /<Route\b[^>]*\bpath\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g;
const FILE_ROUTE_RE = /createFileRoute\(\s*["']([^"']+)["']\s*\)/g;
const OBJECT_ROUTE_RE = /\bpath\s*:\s*["'](\/[^"']*)["']/g;

const AUTH_PATH_RE = /^\/(auth|login|log-in|signin|sign-in|signup|sign-up|register|account\/login)$/i;
const SIGNUP_HINT_RE = /(signup|sign-up|register|join)/i;
/** Paths that are almost always behind a session in a generated app. */
const GATED_PATH_RE =
  /^\/(app|dashboard|admin|account|profile|settings|home|inbox|orders|billing|projects|workspace|studio|onboarding)(\/|$)/i;

function normalize(path: string): string | null {
  if (!path) return null;
  let p = path.split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  // Wildcards and params cannot be visited without inventing data.
  if (p.includes("*") || p.includes(":") || /\$[A-Za-z]/.test(p)) return null;
  if (p.length > 120) return null;
  return p || "/";
}

/**
 * Kit files that ship with every project. Their demo markup contains route
 * strings (`/about`, `/posts`, …) that the app itself never mounts, so
 * scanning them made the browser check crawl phantom pages and fail the deploy
 * with "rendered a blank page".
 */
const NON_ROUTING_DIR_RE =
  /^src\/components\/(examples|blocks|ui|content)\/|^src\/(lib|hooks|integrations)\//;

/** Every statically-visitable route the project declares, "/" first. */
export function collectRoutes(files: ProjectFile[]): string[] {
  const found = new Set<string>();
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(f.path)) continue;
    if (/\/(node_modules|dist)\//.test(f.path)) continue;
    if (NON_ROUTING_DIR_RE.test(f.path)) continue;
    for (const re of [ROUTE_PATH_RE, FILE_ROUTE_RE, OBJECT_ROUTE_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const raw = m[1] ?? m[2];
        // TanStack's root route id is "__root", not a URL.
        if (!raw || raw.includes("__root")) continue;
        const p = normalize(raw);
        if (p) found.add(p);
      }
    }
  }
  found.add("/");
  const all = [...found];
  // "/" first, then shortest paths — the marketing surface before deep pages.
  all.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.length - b.length || a.localeCompare(b)));
  return all.slice(0, MAX_ROUTES);
}

/** Does the project actually ship an email+password auth surface? */
function detectAuth(files: ProjectFile[], routes: string[]) {
  const authRoutes = routes.filter((r) => AUTH_PATH_RE.test(r));
  if (authRoutes.length === 0) return null;

  const usesPasswordAuth = files.some(
    (f) =>
      /signInWithPassword|signUp\s*\(|createUserWithEmailAndPassword|auth\.signUp/.test(f.content) ||
      /type=["']password["']/.test(f.content),
  );
  if (!usesPasswordAuth) return null;

  const signupPath = authRoutes.find((r) => SIGNUP_HINT_RE.test(r)) ?? authRoutes[0];
  const loginPath = authRoutes.find((r) => !SIGNUP_HINT_RE.test(r)) ?? authRoutes[0];
  const protectedRoutes = routes.filter((r) => GATED_PATH_RE.test(r) && !AUTH_PATH_RE.test(r));

  return { signupPath, loginPath, protectedRoutes };
}

/** A throwaway identity that is obviously Petal's, and unique per build. */
export function makeTestIdentity(projectId: string) {
  const tag = `${projectId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  return {
    email: `petal-verify+${tag}@petal-qa.dev`,
    // Mixed classes so it clears any reasonable strength validator.
    password: `Pv-${randomBytes(9).toString("base64url")}9aA!`,
    name: "Petal Verify",
  };
}

const FLOW_SYSTEM_PROMPT = `You write browser test flows for a freshly built web app.

You get the app's routes and the source of its most important interactive files.
Return the 1-3 flows that exercise what this app is FOR — the core create/submit
action a real user performs (add a task, post a listing, place an order, send a
message). Ignore marketing pages, navigation, and theme toggles.

Rules:
- Selectors must be CSS, or Playwright text engine ("text=Add task"). Prefer
  stable things you can SEE in the source: button text, input placeholder,
  name/id attributes, aria-label. Never invent a data-testid that is not there.
- Every flow must end with an assertion (expectText/expectUrl) proving the write
  landed — usually the new item's text appearing on the page.
- Use unique values so repeated runs never collide: suffix any text you type
  with "petal-verify".
- Mark a flow requiresAuth: true if its route is only reachable when signed in.
- Skip destructive actions: no delete, no payment, no account deletion, no
  sending real email or SMS.
- If nothing in the app performs a meaningful write, return {"flows": []}.

Respond with JSON only:
{"flows":[{"name":"Create a task","requiresAuth":true,"steps":[
  {"action":"goto","path":"/dashboard"},
  {"action":"fill","selector":"input[placeholder*='task' i]","value":"Buy milk petal-verify"},
  {"action":"click","selector":"text=Add"},
  {"action":"expectText","value":"Buy milk petal-verify"}
]}]}`;

const ACTION_SET = new Set([
  "goto",
  "click",
  "fill",
  "select",
  "expectText",
  "expectUrl",
  "wait",
]);
/** Never let a generated flow perform an irreversible action. */
const DESTRUCTIVE_RE = /\b(delete|remove|destroy|cancel subscription|deactivate|wipe|reset password|pay|checkout|purchase)\b/i;

function sanitizeFlows(raw: unknown, routes: string[]): VerifyFlow[] {
  const parsed = raw as { flows?: unknown };
  if (!parsed || !Array.isArray(parsed.flows)) return [];
  const out: VerifyFlow[] = [];

  for (const f of parsed.flows.slice(0, MAX_FLOWS)) {
    const flow = f as Partial<VerifyFlow>;
    if (!flow || typeof flow.name !== "string" || !Array.isArray(flow.steps)) continue;
    if (DESTRUCTIVE_RE.test(flow.name)) continue;

    const steps: VerifyStep[] = [];
    let destructive = false;
    for (const s of flow.steps.slice(0, MAX_STEPS)) {
      const step = s as Partial<VerifyStep>;
      if (!step || typeof step.action !== "string" || !ACTION_SET.has(step.action)) continue;
      if (typeof step.selector === "string" && DESTRUCTIVE_RE.test(step.selector)) {
        destructive = true;
        break;
      }
      const clean: VerifyStep = { action: step.action as VerifyStep["action"] };
      if (typeof step.path === "string") {
        const p = normalize(step.path);
        // Don't let the model send the browser to a route that doesn't exist.
        if (!p || !routes.includes(p)) continue;
        clean.path = p;
      }
      if (typeof step.selector === "string") clean.selector = step.selector.slice(0, 500);
      if (typeof step.value === "string") clean.value = step.value.slice(0, 500);
      if (typeof step.ms === "number") clean.ms = Math.min(Math.max(step.ms, 0), 10_000);
      if (step.optional === true) clean.optional = true;
      if (clean.action === "goto" && !clean.path) continue;
      if (
        (clean.action === "click" || clean.action === "fill" || clean.action === "select") &&
        !clean.selector
      )
        continue;
      steps.push(clean);
    }
    if (destructive || steps.length < 2) continue;
    // A flow with no assertion proves nothing.
    if (!steps.some((s) => s.action === "expectText" || s.action === "expectUrl")) continue;
    out.push({
      name: flow.name.slice(0, 120),
      requiresAuth: flow.requiresAuth === true,
      steps,
    });
  }
  return out;
}

/** The files most likely to contain the app's core interaction. */
function flowContext(files: ProjectFile[], routes: string[]): string {
  const interesting = files
    .filter(
      (f) =>
        /\.(tsx|jsx)$/.test(f.path) &&
        !/\/ui\//.test(f.path) &&
        /<form|onSubmit|useMutation|\.insert\(|addDoc|createItem|handleSubmit|<button/i.test(
          f.content,
        ),
    )
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, 6);

  const parts = [`Routes: ${routes.join(", ")}`, ""];
  for (const f of interesting) {
    parts.push(`--- ${f.path} ---`, f.content.slice(0, 3_500), "");
  }
  return parts.join("\n").slice(0, 24_000);
}

async function draftFlows(args: {
  files: ProjectFile[];
  routes: string[];
  projectId: string;
  userId?: string | null;
  signal?: AbortSignal;
  prd?: Prd | null;
}): Promise<VerifyFlow[]> {
  try {
    const res = await aiChatCompletions({
      feature: "generate",
      timeoutTier: "default",
      signal: args.signal,
      meta: { projectId: args.projectId, userId: args.userId ?? null, phase: "verify-plan" },
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: FLOW_SYSTEM_PROMPT },
          {
            role: "user",
            content: args.prd
              ? `${prdScenarioContext(args.prd)}\n\n${flowContext(args.files, args.routes)}`
              : flowContext(args.files, args.routes),
          },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return [];
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end <= start) return [];
    return sanitizeFlows(JSON.parse(content.slice(start, end + 1)), args.routes);
  } catch {
    // A missing flow list costs coverage, never the build.
    return [];
  }
}

/**
 * Build the verification plan for a build. Never throws — the worst case is a
 * plan that only loads "/".
 */
/**
 * The PRD's acceptance scenarios, rendered as the flows the verifier MUST
 * cover. This is what turns "it compiled" into "the product works".
 */
function prdScenarioContext(prd: Prd): string {
  const scenarios = prdBrowserScenarios(prd);
  const lines = [
    "## Product contract — these acceptance scenarios take priority over anything you infer",
    `${prd.productName}: ${prd.purpose}`,
    `Primary workflow: ${prd.primaryWorkflow.name}`,
    "",
    "Required scenarios (translate each into a flow with real selectors from the source below):",
  ];
  for (const s of scenarios) {
    lines.push(`- [${s.criterionId}] on ${s.route}: ${s.steps.join(" → ")} ⇒ ${s.expect}`);
  }
  return lines.join("\n");
}

/**
 * The routes worth looking at: home first, then the interior screens most
 * likely to carry real layout (dashboard, list, detail, settings), then
 * whatever is left. Auth screens are skipped — the signed-in pass covers them.
 */
function pickVisualRoutes(routes: string[], max = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (r: string) => {
    if (out.length >= max || seen.has(r)) return;
    seen.add(r);
    out.push(r);
  };
  const interesting =
    /(dashboard|home|feed|browse|explore|shop|products?|listings?|orders?|bookings?|projects?|settings|profile|account|pricing|checkout|detail)/i;

  if (routes.includes("/")) push("/");
  for (const r of routes) if (interesting.test(r)) push(r);
  for (const r of routes) if (!/(login|signin|sign-up|signup|auth|register|404)/i.test(r)) push(r);
  return out;
}

export async function buildVerifyPlan(args: {
  files: ProjectFile[];
  projectId: string;
  userId?: string | null;
  /** Skip the model call (used when the turn is already over budget on time). */
  skipFlows?: boolean;
  /** The persisted product contract, when the project has one. */
  prd?: Prd | null;
  signal?: AbortSignal;
}): Promise<VerifyPlan> {
  let routes: string[];
  try {
    routes = collectRoutes(args.files);
  } catch {
    routes = ["/"];
  }

  const plan: VerifyPlan = { routes, screenshots: false };

  // Visual QA: home plus the most substantial interior routes, captured at
  // phone, tablet and desktop widths. Scored by a vision model in the
  // callback. Two routes at two widths was never enough to prove a design —
  // interior screens and the tablet breakpoint went entirely unreviewed.
  plan.visual = { widths: [390, 820, 1440], routes: pickVisualRoutes(routes) };

  try {
    const auth = detectAuth(args.files, routes);
    if (auth) {
      const identity = makeTestIdentity(args.projectId);
      plan.auth = { ...auth, ...identity };
      // Gated routes are verified in the signed-in pass, not the anonymous one,
      // where they would only ever report "redirected to login".
      plan.routes = routes.filter((r) => !auth.protectedRoutes.includes(r));
    }
  } catch {
    /* auth detection is best-effort */
  }

  if (!args.skipFlows) {
    const flows = await draftFlows({
      files: args.files,
      routes,
      projectId: args.projectId,
      userId: args.userId,
      signal: args.signal,
      prd: args.prd,
    });
    if (flows.length) plan.flows = flows;
  }

  return plan;
}
