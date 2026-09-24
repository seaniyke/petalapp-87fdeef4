/**
 * PRD — model authoring pass.
 *
 * Takes the deterministic PRD as a prior and lets a fast model fill in the
 * parts rules cannot know: the real product name, the user's actual words,
 * domain-specific workflows, and product-specific acceptance criteria.
 *
 * Contract:
 *  - Tool-calling, strict schema. No free-form prose, no JSON-in-a-string.
 *  - Cheap + fast model. This runs on every first build; it must cost cents
 *    and take seconds.
 *  - It can REFINE the prior. It cannot delete the guarantees: required
 *    surfaces stay non-empty, the primary workflow keeps five steps, and
 *    deterministic formulas are never dropped.
 *  - Every failure path returns the deterministic PRD. This pass can never
 *    block or fail a build.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import { deterministicPrd } from "./prd-deterministic";
import type { Prd, PrdSurface, ProductType } from "./prd-types";
import { MAX_USER_PROMPT_CHARS } from "@/lib/prompt-limits";

const MODEL = "deepseek/deepseek-v4-flash";

const SYSTEM = `You are Kimble's product architect. You turn a user's one-line app request into a precise internal PRD that an engineering pipeline will build and then verify against.

You are given a deterministic draft produced by rules. Improve it. Keep what is right, fix what is wrong, fill what is blank.

Hard rules:
- Build the SMALLEST COMPLETE product that delivers the user's outcome. Never pad it with surfaces they did not ask for.
- A single-purpose tool (calculator, converter, generator) is a public page with the working tool above the fold. It is NOT a dashboard, and it has no login unless the user asked to save things.
- Only include auth, accounts, dashboards, admin, or checkout when the user's own words require them.
- The product name must be a real, invented, human brand name. Never "My App", never the category ("Pregnancy Calculator" is a category, "Due Date Companion" is a name).
- The primary workflow always has exactly five steps: entry, input, action, result, next.
- State domain formulas explicitly, with a worked example whose expected output is checkable. Never invent a formula you are unsure of; leave the list as given instead.
- Acceptance criteria are observable behaviours a browser test can check. No vague quality statements.
- Content tone must fit the domain. Health topics are informative and never diagnostic.

Reply only by calling the write_prd tool.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "write_prd",
    description: "Write the refined product requirements document.",
    parameters: {
      type: "object",
      properties: {
        productName: { type: "string", description: "Real brand name. Not the category." },
        purpose: { type: "string", description: "One sentence: what this product is." },
        targetUser: { type: "string" },
        primaryOutcome: { type: "string", description: "The outcome the user came for, in their terms." },
        productType: {
          type: "string",
          enum: ["utility", "content-site", "workflow-app", "marketplace", "social", "game", "ai-tool", "storefront"],
        },
        domain: { type: "string", description: "Subject domain, e.g. 'pregnancy & prenatal health'." },
        primaryWorkflowName: { type: "string" },
        primaryWorkflowSteps: {
          type: "array",
          description: "Exactly 5 items, in order: entry, input, action, result, next.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["entry", "input", "action", "result", "next"] },
              description: { type: "string" },
            },
            required: ["kind", "description"],
            additionalProperties: false,
          },
        },
        secondaryWorkflows: {
          type: "array",
          description: "0-2 supporting workflows.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: ["entry", "input", "action", "result", "next"] },
                    description: { type: "string" },
                  },
                  required: ["kind", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["name", "steps"],
            additionalProperties: false,
          },
        },
        formulas: {
          type: "array",
          description: "Domain logic. Keep the draft's formulas unless they are wrong.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              statement: { type: "string" },
              exampleInput: { type: "string" },
              exampleExpected: { type: "string" },
            },
            required: ["id", "statement", "exampleInput", "exampleExpected"],
            additionalProperties: false,
          },
        },
        dataModel: {
          type: "array",
          description: "Only when the product genuinely persists data. Otherwise empty.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              fields: { type: "array", items: { type: "string" } },
              operations: { type: "array", items: { type: "string", enum: ["create", "read", "update", "delete"] } },
              visibility: { type: "string", enum: ["owner", "role", "public"] },
              ownerField: { type: "string" },
              allowedRoles: { type: "array", items: { type: "string" } },
              relationships: { type: "array", items: { type: "string" } },
            },
            required: ["name", "fields", "operations", "visibility", "ownerField", "allowedRoles", "relationships"],
            additionalProperties: false,
          },
        },
        needsPersistence: { type: "boolean" },
        needsAuth: { type: "boolean" },
        roles: { type: "array", items: { type: "string" } },
        permissions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              entity: { type: "string" },
              operations: { type: "array", items: { type: "string", enum: ["create", "read", "update", "delete"] } },
            },
            required: ["role", "entity", "operations"],
            additionalProperties: false,
          },
        },
        requiredSurfaces: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "landing", "tool", "results", "content", "catalog", "detail", "dashboard",
              "auth", "account", "admin", "checkout", "settings", "about", "contact",
            ],
          },
        },
        excludedSurfaces: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "landing", "tool", "results", "content", "catalog", "detail", "dashboard",
              "auth", "account", "admin", "checkout", "settings", "about", "contact",
            ],
          },
        },
        states: { type: "array", items: { type: "string" } },
        navigation: { type: "string" },
        contentTone: { type: "string" },
        acceptance: {
          type: "array",
          description: "Observable, checkable behaviours.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              statement: { type: "string" },
              check: {
                type: "string",
                enum: ["surface-exists", "interaction", "computation", "responsive", "absence"],
              },
              route: { type: "string" },
            },
            required: ["id", "statement", "check", "route"],
            additionalProperties: false,
          },
        },
        outOfScope: { type: "array", items: { type: "string" } },
      },
      required: [
        "productName", "purpose", "targetUser", "primaryOutcome", "productType", "domain",
        "primaryWorkflowName", "primaryWorkflowSteps", "secondaryWorkflows", "formulas",
        "dataModel", "needsPersistence", "needsAuth", "roles", "permissions", "requiredSurfaces", "excludedSurfaces",
        "states", "navigation", "contentTone", "acceptance", "outOfScope",
      ],
      additionalProperties: false,
    },
  },
};

type RawPrd = {
  productName?: string;
  purpose?: string;
  targetUser?: string;
  primaryOutcome?: string;
  productType?: string;
  domain?: string;
  primaryWorkflowName?: string;
  primaryWorkflowSteps?: Array<{ kind?: string; description?: string }>;
  secondaryWorkflows?: Array<{ name?: string; steps?: Array<{ kind?: string; description?: string }> }>;
  formulas?: Array<{ id?: string; statement?: string; exampleInput?: string; exampleExpected?: string }>;
  dataModel?: Array<{ name?: string; fields?: string[]; operations?: string[]; visibility?: string; ownerField?: string; allowedRoles?: string[]; relationships?: string[] }>;
  needsPersistence?: boolean;
  needsAuth?: boolean;
  roles?: string[];
  permissions?: Array<{ role?: string; entity?: string; operations?: string[] }>;
  requiredSurfaces?: string[];
  excludedSurfaces?: string[];
  states?: string[];
  navigation?: string;
  contentTone?: string;
  acceptance?: Array<{ id?: string; statement?: string; check?: string; route?: string }>;
  outOfScope?: string[];
};

const VALID_SURFACES: PrdSurface[] = [
  "landing", "tool", "results", "content", "catalog", "detail", "dashboard",
  "auth", "account", "admin", "checkout", "settings", "about", "contact",
];
const VALID_TYPES: ProductType[] = [
  "utility", "content-site", "workflow-app", "marketplace", "social", "game", "ai-tool", "storefront",
];

function coerceSurfaces(input: unknown, fallback: PrdSurface[]): PrdSurface[] {
  if (!Array.isArray(input)) return fallback;
  const out = input.filter((s): s is PrdSurface => VALID_SURFACES.includes(s as PrdSurface));
  return out.length ? Array.from(new Set(out)) : fallback;
}

/**
 * Merge the model's PRD onto the deterministic prior. The prior's guarantees
 * survive: formulas are never lost, surfaces are never emptied, and the
 * five-step workflow shape is enforced.
 */
export function mergePrd(prior: Prd, raw: RawPrd): Prd {
  const steps = Array.isArray(raw.primaryWorkflowSteps)
    ? raw.primaryWorkflowSteps
        .filter((s) => s && typeof s.description === "string" && s.description.trim())
        .map((s) => ({
          kind: (["entry", "input", "action", "result", "next"] as const).includes(s.kind as never)
            ? (s.kind as Prd["primaryWorkflow"]["steps"][number]["kind"])
            : "action",
          description: String(s.description).trim(),
        }))
    : [];

  const modelFormulas = Array.isArray(raw.formulas)
    ? raw.formulas
        .filter((f) => f?.id && f?.statement)
        .map((f) => ({
          id: String(f.id),
          statement: String(f.statement),
          example:
            f.exampleInput && f.exampleExpected
              ? { input: String(f.exampleInput), expected: String(f.exampleExpected) }
              : undefined,
        }))
    : [];

  // Deterministic formulas are authoritative for known domains; the model may
  // only ADD to them.
  const formulas = [...prior.formulas];
  for (const f of modelFormulas) if (!formulas.some((p) => p.id === f.id)) formulas.push(f);

  const required = coerceSurfaces(raw.requiredSurfaces, prior.requiredSurfaces);
  const excluded = coerceSurfaces(raw.excludedSurfaces, prior.excludedSurfaces).filter(
    (s) => !required.includes(s),
  );

  const productType = VALID_TYPES.includes(raw.productType as ProductType)
    ? (raw.productType as ProductType)
    : prior.productType;

  const acceptance = Array.isArray(raw.acceptance)
    ? raw.acceptance
        .filter((c) => c?.id && c?.statement)
        .map((c) => ({
          id: String(c.id),
          statement: String(c.statement),
          check: (["surface-exists", "interaction", "computation", "responsive", "absence"] as const).includes(
            c.check as never,
          )
            ? (c.check as Prd["acceptance"][number]["check"])
            : ("interaction" as const),
          route: c.route ? String(c.route) : undefined,
        }))
    : [];

  // Keep every deterministic criterion; the model's are additive.
  const mergedAcceptance = [...prior.acceptance];
  for (const c of acceptance) if (!mergedAcceptance.some((p) => p.id === c.id)) mergedAcceptance.push(c);

  const name = (raw.productName ?? "").trim();
  const looksLikeCategory = /^(my |the )?[\w\s]*\b(app|calculator|tracker|tool|site|website|dashboard)$/i.test(name);

  return {
    version: 1,
    productName: name && !looksLikeCategory ? name : prior.productName || name || "Kimble Build",
    purpose: (raw.purpose ?? "").trim() || prior.purpose,
    targetUser: (raw.targetUser ?? "").trim() || prior.targetUser,
    primaryOutcome: (raw.primaryOutcome ?? "").trim() || prior.primaryOutcome,
    productType,
    domain: (raw.domain ?? "").trim() || prior.domain,
    primaryWorkflow:
      steps.length >= 4
        ? { name: (raw.primaryWorkflowName ?? "").trim() || prior.primaryWorkflow.name, steps }
        : prior.primaryWorkflow,
    secondaryWorkflows: Array.isArray(raw.secondaryWorkflows)
      ? raw.secondaryWorkflows
          .filter((w) => w?.name && Array.isArray(w.steps) && w.steps.length)
          .slice(0, 2)
          .map((w) => ({
            name: String(w.name),
            steps: (w.steps ?? [])
              .filter((s) => s?.description)
              .map((s) => ({
                kind: (["entry", "input", "action", "result", "next"] as const).includes(s.kind as never)
                  ? (s.kind as Prd["primaryWorkflow"]["steps"][number]["kind"])
                  : ("action" as const),
                description: String(s.description),
              })),
          }))
      : prior.secondaryWorkflows,
    formulas,
    dataModel: Array.isArray(raw.dataModel)
      ? raw.dataModel
          .filter((e) => e?.name && Array.isArray(e.fields))
          .map((e) => ({
            name: String(e.name),
            fields: (e.fields ?? []).map(String),
            operations: (e.operations ?? ["create", "read", "update", "delete"]).filter((op): op is "create" | "read" | "update" | "delete" => ["create", "read", "update", "delete"].includes(op)),
            visibility: (["owner", "role", "public"].includes(e.visibility ?? "") ? e.visibility : prior.needsAuth ? "owner" : "public") as "owner" | "role" | "public",
            ownerField: e.ownerField || (prior.needsAuth ? "user_id" : undefined),
            allowedRoles: Array.isArray(e.allowedRoles) ? e.allowedRoles.map(String) : undefined,
            relationships: Array.isArray(e.relationships) ? e.relationships.map(String) : [],
          }))
      : prior.dataModel,
    needsPersistence: typeof raw.needsPersistence === "boolean" ? raw.needsPersistence : prior.needsPersistence,
    needsAuth: typeof raw.needsAuth === "boolean" ? raw.needsAuth : prior.needsAuth,
    roles: Array.isArray(raw.roles) ? raw.roles.map(String) : prior.roles,
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions
          .filter((p) => p?.role && p?.entity)
          .map((p) => ({
            role: String(p.role),
            entity: String(p.entity),
            operations: (p.operations ?? []).filter((op): op is "create" | "read" | "update" | "delete" => ["create", "read", "update", "delete"].includes(op)),
          }))
      : prior.permissions,
    requiredSurfaces: required,
    excludedSurfaces: excluded,
    states: Array.isArray(raw.states) && raw.states.length ? raw.states.map(String) : prior.states,
    navigation: (raw.navigation ?? "").trim() || prior.navigation,
    contentTone: (raw.contentTone ?? "").trim() || prior.contentTone,
    acceptance: mergedAcceptance,
    outOfScope: Array.isArray(raw.outOfScope) ? raw.outOfScope.map(String) : prior.outOfScope,
    source: "hybrid",
    confidence: Math.max(prior.confidence, 0.8),
  };
}

/** Run the model pass. Always resolves — falls back to the deterministic PRD. */
export async function modelPrd(brief: string, userId?: string): Promise<Prd> {
  const prior = deterministicPrd(brief);
  if (!process.env.OPENROUTER_API_KEY) return prior;

  try {
    const res = await aiChatCompletions({
      feature: "preflight",
      // Forced tool output — an operator model override would break the contract.
      lockCallerModel: true,
      meta: userId ? { userId } : undefined,
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
             content: `User request:\n"""${brief.slice(0, MAX_USER_PROMPT_CHARS)}"""\n\nDeterministic draft to refine:\n${JSON.stringify(
              {
                productName: prior.productName,
                purpose: prior.purpose,
                productType: prior.productType,
                domain: prior.domain,
                primaryWorkflow: prior.primaryWorkflow,
                formulas: prior.formulas,
                requiredSurfaces: prior.requiredSurfaces,
                excludedSurfaces: prior.excludedSurfaces,
                needsPersistence: prior.needsPersistence,
                needsAuth: prior.needsAuth,
                 dataModel: prior.dataModel,
                 roles: prior.roles,
                 permissions: prior.permissions,
                states: prior.states,
              },
              null,
              1,
            )}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "write_prd" } },
        stream: false,
      },
    } as Parameters<typeof aiChatCompletions>[0]);

    if (!res.ok) return prior;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return prior;
    return mergePrd(prior, JSON.parse(args) as RawPrd);
  } catch {
    return prior;
  }
}
