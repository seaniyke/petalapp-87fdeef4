/**
 * Universal Integration Resolver — Layer E.
 *
 * When a user asks Petal to "add Twilio" / "integrate Mapbox" / "use OpenAI",
 * this module fetches a compact, prompt-ready summary of the third-party
 * service so the LLM generates code grounded in real, current SDK signatures
 * instead of training-data memory.
 *
 * Strategy chain (first one to succeed wins, results are cached):
 *   1. DB cache hit (refreshed within last 14 days)
 *   2. Built-in curated brief (covers the top ~40 services)
 *   3. npm registry lookup → README + package metadata
 *   4. AI synthesis fallback (Lovable AI gateway distills what it knows)
 *
 * Cached output is a single `prompt_block` string ready to inject into the
 * system prompt, plus a `required_secrets` list the UI uses to ask for keys.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CURATED_INTEGRATIONS } from "./curated-briefs";
import { renderGatewayHint } from "./gateway-aware-services";

export type ResolvedIntegration = {
  serviceSlug: string;
  displayName: string;
  npmPackage: string | null;
  docsUrl: string | null;
  promptBlock: string;
  requiredSecrets: string[];
  source: "cache" | "curated" | "npm" | "ai";
};

const CACHE_MAX_AGE_DAYS = 14;
const FETCH_TIMEOUT_MS = 6000;

/* ------------------------------ slug ------------------------------ */

/** Normalize a free-form service mention to a stable slug. */
export function slugifyService(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ----------------------------- cache ------------------------------ */

async function readCache(slug: string): Promise<ResolvedIntegration | null> {
  const { data } = await supabaseAdmin
    .from("integration_docs_cache")
    .select(
      "service_slug, display_name, npm_package, docs_url, prompt_block, required_secrets, source, refreshed_at",
    )
    .eq("service_slug", slug)
    .maybeSingle();
  if (!data) return null;
  const ageMs = Date.now() - new Date(data.refreshed_at as string).getTime();
  const maxMs = CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs > maxMs) return null;
  // Bump hit counter (best-effort).
  void supabaseAdmin
    .from("integration_docs_cache")
    .update({ hit_count: (data as { hit_count?: number }).hit_count ?? 0 + 1 })
    .eq("service_slug", slug);
  return {
    serviceSlug: data.service_slug as string,
    displayName: data.display_name as string,
    npmPackage: (data.npm_package as string | null) ?? null,
    docsUrl: (data.docs_url as string | null) ?? null,
    promptBlock: data.prompt_block as string,
    requiredSecrets: ((data.required_secrets as string[] | null) ?? []) as string[],
    source: "cache",
  };
}

async function writeCache(r: ResolvedIntegration): Promise<void> {
  await supabaseAdmin
    .from("integration_docs_cache")
    .upsert(
      {
        service_slug: r.serviceSlug,
        display_name: r.displayName,
        npm_package: r.npmPackage,
        docs_url: r.docsUrl,
        prompt_block: r.promptBlock,
        required_secrets: r.requiredSecrets,
        source: r.source === "cache" ? "curated" : r.source,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: "service_slug" },
    );
}

/* ----------------------------- npm -------------------------------- */

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "petal-resolver/1" } });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function tryNpm(slug: string, displayName: string): Promise<ResolvedIntegration | null> {
  // Common package-name guesses.
  const guesses = [
    slug,
    slug.replace(/-/g, ""),
    `@${slug}/sdk`,
    `${slug}-sdk`,
    `${slug}-node`,
    `node-${slug}`,
  ];
  for (const pkg of guesses) {
    const res = await fetchWithTimeout(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
    if (!res || !res.ok) continue;
    const data = (await res.json().catch(() => null)) as
      | {
          name?: string;
          "dist-tags"?: { latest?: string };
          versions?: Record<string, { description?: string; homepage?: string }>;
          description?: string;
          homepage?: string;
          repository?: { url?: string };
          readme?: string;
        }
      | null;
    if (!data?.name) continue;
    const latest = data["dist-tags"]?.latest;
    const verData = (latest && data.versions?.[latest]) || null;
    const description = verData?.description ?? data.description ?? "";
    const homepage = verData?.homepage ?? data.homepage ?? null;
    const readmeSnippet = (data.readme ?? "").slice(0, 1800).trim();

    const promptBlock = [
      `### Universal Integration: ${displayName}`,
      `npm package: \`${data.name}\`${latest ? ` (latest: ${latest})` : ""}`,
      description ? `Description: ${description}` : "",
      homepage ? `Homepage / docs: ${homepage}` : "",
      "",
      "When the user asks to use this service:",
      `1. Install: run \`npm install ${data.name}\` (or include in package.json).`,
      "2. Read any required API keys from `process.env.<NAME>` inside server code only — NEVER hardcode them, NEVER call the third-party API from the browser.",
      "3. If a secret is missing, emit `<lov-add-secret name=\"...\" instructions=\"Get this from <provider dashboard URL>\" link=\"...\" />` so the user can paste it securely.",
      "4. Wrap the SDK in a thin server function under `src/lib/<service>.functions.ts` exposed via `createServerFn`; call it from the UI with `useServerFn`.",
      readmeSnippet
        ? `\nREADME excerpt (use as ground truth for SDK signatures, do NOT hallucinate other APIs):\n"""\n${readmeSnippet}\n"""`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      serviceSlug: slug,
      displayName,
      npmPackage: data.name,
      docsUrl: homepage,
      promptBlock,
      requiredSecrets: guessSecrets(displayName),
      source: "npm",
    };
  }
  return null;
}

/** Best-effort guess of secret-name conventions (UPPER_SNAKE per provider). */
function guessSecrets(displayName: string): string[] {
  const base = displayName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return [];
  return [`${base}_API_KEY`];
}

/* ---------------------------- AI synth ---------------------------- */

async function tryAiSynth(slug: string, displayName: string): Promise<ResolvedIntegration | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const res = await fetchWithTimeout(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    9000,
  );
  if (!res) return null;
  // Re-issue with a real body (the head request above just primes the connection).
  void res;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You produce a compact integration brief for a code-generation agent. Reply ONLY with strict JSON: {\"npm\":string|null,\"docs\":string|null,\"secrets\":string[],\"brief\":string}. The brief is markdown, <=1500 chars, covers: install command, env vars, minimal server-side example using the most current SDK, and one or two pitfalls. Never invent endpoints — if uncertain, say so.",
          },
          {
            role: "user",
            content: `Service: ${displayName}. Audience: a TanStack Start + TypeScript app calling the SDK from a server function. Return JSON only.`,
          },
        ],
        temperature: 0.2,
      }),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const txt = json.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJson(txt);
    if (!parsed) return null;
    const brief = String(parsed.brief ?? "").slice(0, 4000);
    if (!brief) return null;
    return {
      serviceSlug: slug,
      displayName,
      npmPackage: typeof parsed.npm === "string" ? parsed.npm : null,
      docsUrl: typeof parsed.docs === "string" ? parsed.docs : null,
      promptBlock: `### Universal Integration: ${displayName}\n${brief}`,
      requiredSecrets: Array.isArray(parsed.secrets)
        ? parsed.secrets.filter((s: unknown): s is string => typeof s === "string").slice(0, 5)
        : guessSecrets(displayName),
      source: "ai",
    };
  } catch {
    return null;
  }
}

function safeJson(s: string): Record<string, unknown> | null {
  // Strip ```json fences if present.
  const cleaned = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/* --------------------------- public API --------------------------- */

/**
 * Resolve a service mention to a prompt-ready integration brief.
 * Returns null if all strategies fail (very rare — AI synth is the floor).
 */
export async function resolveIntegration(
  rawName: string,
): Promise<ResolvedIntegration | null> {
  const displayName = rawName.trim();
  if (!displayName) return null;
  const slug = slugifyService(displayName);
  if (!slug) return null;

  // 1. Cache
  const cached = await readCache(slug);
  if (cached) return cached;

  // 2. Curated
  const curated = CURATED_INTEGRATIONS[slug];
  if (curated) {
    const r: ResolvedIntegration = { ...curated, serviceSlug: slug, source: "curated" };
    const hint = renderGatewayHint(slug, r.displayName);
    if (hint) r.promptBlock = `${r.promptBlock}\n${hint}`;
    void writeCache(r);
    return r;
  }

  // 3. npm
  const npm = await tryNpm(slug, displayName);
  if (npm) {
    const hint = renderGatewayHint(slug, npm.displayName);
    if (hint) npm.promptBlock = `${npm.promptBlock}\n${hint}`;
    void writeCache(npm);
    return npm;
  }

  // 4. AI fallback
  const ai = await tryAiSynth(slug, displayName);
  if (ai) {
    const hint = renderGatewayHint(slug, ai.displayName);
    if (hint) ai.promptBlock = `${ai.promptBlock}\n${hint}`;
    void writeCache(ai);
    return ai;
  }

  return null;
}

/** Render multiple resolved integrations into one prompt block. */
export function renderResolvedIntegrationsBlock(items: ResolvedIntegration[]): string {
  if (items.length === 0) return "";
  return [
    "",
    "",
    "## On-demand integration briefs",
    "The user mentioned the following third-party service(s). Use these briefs as ground truth for SDK names, env var names, and imports — do NOT invent alternatives or rely on training-data memory.",
    "",
    ...items.map((i) => i.promptBlock),
    "",
    "If any required secret is missing from process.env, emit `<lov-add-secret name=\"...\" instructions=\"...\" link=\"...\" />` BEFORE writing code that uses it.",
  ].join("\n\n");
}
