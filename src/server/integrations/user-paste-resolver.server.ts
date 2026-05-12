/**
 * Layer J — User-Paste Integration Resolver.
 *
 * Lets the user wire up ANY external API just by pasting either:
 *   - one or more documentation URLs ("integrate this API: https://docs.x.com/...")
 *   - raw code / cURL / JSON snippets in fenced ```code blocks
 *   - both
 *
 * For each detected source, we synthesize an authoritative ResolvedIntegration
 * brief grounded in the actual pasted material — not in training-data memory
 * and not in the curated/npm/AI fallback chain. These briefs override
 * curated ones because the user explicitly asked to follow them.
 *
 * Bounded for prompt cost: max 3 docs URLs + one combined code-context block
 * per turn, 8s fetch timeout, 12KB body cap per URL, 6KB total code paste.
 *
 * Pure server module. Safe in TanStack server functions.
 */

import type { ResolvedIntegration } from "./doc-resolver.server";

const FETCH_TIMEOUT_MS = 8000;
const URL_BODY_CAP = 12_000;
const CODE_PASTE_CAP = 6_000;
const MAX_URLS = 3;

/* -------------------------- extraction --------------------------- */

const URL_RE = /https?:\/\/[^\s)\]<>'"`]+/gi;
// Domains we consider "documentation-ish" or API-ish. Anything else still
// flies if the user explicitly says "docs" / "integrate" near the URL.
const DOC_HINT_RE =
  /\b(docs?|api|reference|developer|developers|sdk|guide|swagger|openapi|spec|postman)\b/i;
const PASTE_INTENT_RE =
  /\b(integrate|integration|add|use|implement|wire|connect|hook)\b/i;

export type UserPasteSources = {
  urls: string[];
  codeBlocks: string[];
};

export function extractUserPasteSources(text: string): UserPasteSources {
  const out: UserPasteSources = { urls: [], codeBlocks: [] };
  if (!text) return out;

  // Fenced code blocks first — and strip them out before URL scanning so we
  // don't double-count URLs sitting inside snippets.
  const codeRe = /```(?:[a-z0-9_-]+)?\n([\s\S]*?)```/gi;
  let stripped = text;
  let cm: RegExpExecArray | null;
  while ((cm = codeRe.exec(text))) {
    const block = cm[1].trim();
    if (block.length >= 20 && out.codeBlocks.join("\n").length < CODE_PASTE_CAP) {
      out.codeBlocks.push(block.slice(0, CODE_PASTE_CAP));
    }
  }
  stripped = stripped.replace(codeRe, "");

  // Inline cURL even without fences (very common when pasting from docs).
  const curlRe = /(?:^|\n)\s*(curl\s+[^\n]{20,}(?:\n\s+[^\n]+)*)/gi;
  let km: RegExpExecArray | null;
  while ((km = curlRe.exec(stripped))) {
    const snippet = km[1].trim();
    if (out.codeBlocks.join("\n").length + snippet.length < CODE_PASTE_CAP) {
      out.codeBlocks.push(snippet);
    }
  }

  // URLs.
  const intentNearby = PASTE_INTENT_RE.test(stripped);
  const seen = new Set<string>();
  for (const m of stripped.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:)\]]+$/, "");
    if (seen.has(raw)) continue;
    // Skip obvious noise.
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|woff2?)(\?|$)/i.test(raw)) continue;
    if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/i.test(raw)) continue;
    if (DOC_HINT_RE.test(raw) || intentNearby) {
      seen.add(raw);
      out.urls.push(raw);
      if (out.urls.length >= MAX_URLS) break;
    }
  }

  return out;
}

/* ---------------------------- fetching --------------------------- */

async function fetchPage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "PetalBuilder/1.0 (+https://buildwithpetal.com) integration-resolver",
        accept: "text/html,text/markdown,application/json,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const raw = (await res.text()).slice(0, URL_BODY_CAP * 4);
    if (ct.includes("application/json")) return raw.slice(0, URL_BODY_CAP);
    return htmlToText(raw).slice(0, URL_BODY_CAP);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/* ------------------------- AI synthesis -------------------------- */

type SynthInput =
  | { kind: "url"; url: string; body: string }
  | { kind: "code"; combined: string };

type SynthJson = {
  service?: string;
  npm?: string | null;
  docs?: string | null;
  secrets?: string[];
  brief?: string;
};

const SYNTH_SYSTEM = `You produce ONE compact integration brief for a code-generation agent.
Reply with strict JSON only (no markdown fences):
{"service": string, "npm": string|null, "docs": string|null, "secrets": string[], "brief": string}

Rules:
- "service" = the human display name of the API/service (e.g. "Acme Payments", "Plaid", "WhatsApp Cloud API").
- "npm" = the official npm package if you can confirm it from the source, else null.
- "docs" = a canonical docs URL from the source, else null.
- "secrets" = UPPER_SNAKE env var names the integration needs (max 5).
- "brief" = markdown, <= 2000 chars, ground EVERY claim in the supplied source. Cover:
   1. install command (if SDK exists) OR raw HTTP base URL
   2. required env vars
   3. minimal server-side example for a TanStack Start + TypeScript app calling it from a server function (createServerFn)
   4. one or two concrete pitfalls (auth header format, idempotency, signature verification, pagination)
- NEVER invent endpoints, fields, or env var names that are not visible in the supplied source. If the source is thin, say so explicitly inside the brief and emit only what you can verify.`;

async function aiSynth(input: SynthInput): Promise<SynthJson | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const userMsg =
    input.kind === "url"
      ? `Source URL: ${input.url}\n\nFetched content (truncated):\n"""\n${input.body}\n"""`
      : `The user pasted the following code/cURL snippet(s) and asked to integrate the underlying API. Treat these as ground truth:\n"""\n${input.combined}\n"""`;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYNTH_SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const txt = json.choices?.[0]?.message?.content?.trim() ?? "";
    return safeJson(txt);
  } catch {
    return null;
  }
}

function safeJson(s: string): SynthJson | null {
  const cleaned = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as SynthJson;
  } catch {
    return null;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toResolved(
  s: SynthJson,
  sourceLabel: string,
  fallbackName: string,
): ResolvedIntegration | null {
  const brief = (s.brief ?? "").slice(0, 4000).trim();
  if (!brief) return null;
  const display = (s.service ?? fallbackName).trim() || fallbackName;
  return {
    serviceSlug: `paste-${slugify(display)}`,
    displayName: display,
    npmPackage: typeof s.npm === "string" ? s.npm : null,
    docsUrl: typeof s.docs === "string" ? s.docs : null,
    promptBlock: `### User-supplied integration: ${display} (${sourceLabel})\nThe user pasted this source — treat it as authoritative. Do NOT substitute SDK names, env vars, or endpoints from memory.\n\n${brief}`,
    requiredSecrets: Array.isArray(s.secrets)
      ? s.secrets
          .filter((x): x is string => typeof x === "string" && /^[A-Z][A-Z0-9_]+$/.test(x))
          .slice(0, 5)
      : [],
    source: "user-paste",
  };
}

/* --------------------------- public API -------------------------- */

/**
 * Resolve every URL + code paste in the user's message into authoritative
 * integration briefs. Bounded; failures are dropped silently.
 */
export async function resolveFromUserPaste(
  text: string,
): Promise<ResolvedIntegration[]> {
  const sources = extractUserPasteSources(text);
  if (!sources.urls.length && !sources.codeBlocks.length) return [];

  const tasks: Array<Promise<ResolvedIntegration | null>> = [];

  for (const url of sources.urls) {
    tasks.push(
      (async () => {
        const body = await fetchPage(url);
        if (!body || body.length < 200) return null;
        const synth = await aiSynth({ kind: "url", url, body });
        if (!synth) return null;
        const host = (() => {
          try {
            return new URL(url).hostname.replace(/^www\./, "");
          } catch {
            return url;
          }
        })();
        const r = toResolved(synth, `from ${host}`, host);
        if (r && !r.docsUrl) r.docsUrl = url;
        return r;
      })(),
    );
  }

  if (sources.codeBlocks.length) {
    const combined = sources.codeBlocks.join("\n\n---\n\n").slice(0, CODE_PASTE_CAP);
    tasks.push(
      (async () => {
        const synth = await aiSynth({ kind: "code", combined });
        if (!synth) return null;
        return toResolved(synth, "from pasted code", "Pasted integration");
      })(),
    );
  }

  const results = await Promise.all(tasks);
  return results.filter((r): r is ResolvedIntegration => r !== null);
}
