/**
 * Catalog QA harness — static validator that audits everything in the
 * "starter surface" (templates, industry packs, themes, snippets) for the
 * mistakes that actually break generation downstream:
 *
 *   - missing / too-short prompts (LLM produces vague output)
 *   - duplicate slugs (router collisions, gallery dedupe bugs)
 *   - briefs that reference Cloud features the pack didn't list (the
 *     post-generation suggester won't auto-prompt for them)
 *   - prompts that reference third-party services we can't yet auto-resolve
 *     docs for (heads-up — not a hard fail; Layer E will still try)
 *
 * Pure function, no IO, no env. Safe to import from the browser, server fn,
 * or a CLI. The admin page renders the report.
 */
import { START_IDEAS, type StartIdea } from "@/lib/start-ideas";
import { INDUSTRY_PACKS, type IndustryPack, type CloudFeature } from "@/lib/industry-packs";
import { THEME_PRESETS, SNIPPETS, type ThemePreset, type Snippet } from "@/lib/themes-and-snippets";

export type Severity = "error" | "warn" | "info";

export type Finding = {
  severity: Severity;
  surface: "template" | "pack" | "theme" | "snippet";
  slug: string;
  rule: string;
  message: string;
};

export type QAReport = {
  ranAt: string;
  counts: {
    templates: number;
    packs: number;
    themes: number;
    snippets: number;
    errors: number;
    warnings: number;
  };
  findings: Finding[];
};

const MIN_TEMPLATE_PROMPT = 80;     // chars — under this LLMs hallucinate
const MIN_BRIEF_LENGTH = 400;       // industry pack briefs must be substantive
const MIN_SNIPPET_PROMPT = 60;

// Services we already cover via the doc-resolver curated briefs (Layer E).
// Anything else triggers a warn telling the user the resolver will fall back
// to npm README / AI synthesis (still works, just slower / less reliable).
const KNOWN_SERVICES = new Set(
  [
    "stripe", "paystack", "flutterwave", "resend", "plausible",
    "openai", "anthropic", "twilio", "mapbox", "supabase", "sentry",
    "cloudinary", "algolia", "pinecone", "replicate", "elevenlabs",
    "mux", "daily", "livekit", "perplexity", "shopify", "notion",
    "airtable", "linear", "hubspot", "discord", "telegram", "whisper",
    "react flow", "react-flow",
  ].map((s) => s.toLowerCase()),
);

const SERVICE_CANDIDATE_REGEX =
  /\b(stripe|paystack|flutterwave|resend|plausible|openai|anthropic|twilio|mapbox|supabase|sentry|cloudinary|algolia|pinecone|replicate|elevenlabs|mux|daily\.co|daily|livekit|perplexity|shopify|notion|airtable|linear|hubspot|discord|telegram|whisper|react[- ]flow|gmail|@dnd-kit|tanstack)\b/gi;

function uniqueSlugCheck<T extends { slug?: string; title?: string }>(
  items: T[],
  surface: Finding["surface"],
  keyOf: (x: T) => string,
): Finding[] {
  const seen = new Map<string, number>();
  const out: Finding[] = [];
  for (const it of items) {
    const k = keyOf(it);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen.entries()) {
    if (n > 1) {
      out.push({
        severity: "error",
        surface,
        slug: k,
        rule: "duplicate-slug",
        message: `Duplicate slug/title "${k}" appears ${n} times. Will collide in the gallery.`,
      });
    }
  }
  return out;
}

function auditTemplate(t: StartIdea): Finding[] {
  const out: Finding[] = [];
  const slug = t.title;
  if (!t.prompt || t.prompt.trim().length < MIN_TEMPLATE_PROMPT) {
    out.push({
      severity: "error",
      surface: "template",
      slug,
      rule: "prompt-too-short",
      message: `Prompt is ${t.prompt?.length ?? 0} chars; need ≥ ${MIN_TEMPLATE_PROMPT} for usable generation.`,
    });
  }
  if (!t.Icon) {
    out.push({
      severity: "error", surface: "template", slug,
      rule: "missing-icon", message: "No Icon set.",
    });
  }
  if (!t.category) {
    out.push({
      severity: "error", surface: "template", slug,
      rule: "missing-category", message: "No category set.",
    });
  }
  return out;
}

function auditPack(p: IndustryPack): Finding[] {
  const out: Finding[] = [];
  if (!p.brief || p.brief.length < MIN_BRIEF_LENGTH) {
    out.push({
      severity: "error", surface: "pack", slug: p.slug,
      rule: "brief-too-short",
      message: `Brief is ${p.brief?.length ?? 0} chars; need ≥ ${MIN_BRIEF_LENGTH}.`,
    });
  }
  if (!p.pages || p.pages.length < 3) {
    out.push({
      severity: "warn", surface: "pack", slug: p.slug,
      rule: "few-pages",
      message: `Only ${p.pages?.length ?? 0} pages; industry packs should scaffold 4+.`,
    });
  }
  // Cross-check: brief mentions a feature the pack didn't declare
  const featureHints: Array<{ feature: CloudFeature; rx: RegExp }> = [
    { feature: "payments", rx: /\bstripe|checkout|payout|paywall|subscription\b/i },
    { feature: "email", rx: /\b(resend|email|confirmation email|notify|newsletter)\b/i },
    { feature: "auth", rx: /\b(sign[- ]?in|login|account|auth-gated|authenticated|RLS)\b/i },
    { feature: "storage", rx: /\b(upload|gallery|photos|images|files)\b/i },
    { feature: "ai", rx: /\b(AI|LLM|gemini|gpt|openai)\b/i },
    { feature: "database", rx: /\b(database|table|stored|persist|save to db|insert)\b/i },
  ];
  for (const { feature, rx } of featureHints) {
    if (rx.test(p.brief) && !p.cloud.includes(feature)) {
      out.push({
        severity: "warn", surface: "pack", slug: p.slug,
        rule: "missing-cloud-feature",
        message: `Brief implies "${feature}" but pack.cloud doesn't list it — auto-suggest won't fire.`,
      });
    }
  }
  return out;
}

function auditTheme(t: ThemePreset): Finding[] {
  const out: Finding[] = [];
  if (!t.prompt || t.prompt.length < 100) {
    out.push({
      severity: "error", surface: "theme", slug: t.slug,
      rule: "prompt-too-short", message: "Theme prompt under 100 chars.",
    });
  }
  if (!/functionality/i.test(t.prompt) && !/behavior/i.test(t.prompt)) {
    out.push({
      severity: "warn", surface: "theme", slug: t.slug,
      rule: "missing-no-behavior-clause",
      message: 'Theme prompt should explicitly say "do not change functionality/behavior".',
    });
  }
  if (!t.palette || t.palette.length < 2) {
    out.push({
      severity: "error", surface: "theme", slug: t.slug,
      rule: "thin-palette", message: "Need ≥ 2 palette swatches.",
    });
  }
  return out;
}

function auditSnippet(s: Snippet): Finding[] {
  const out: Finding[] = [];
  if (!s.prompt || s.prompt.length < MIN_SNIPPET_PROMPT) {
    out.push({
      severity: "error", surface: "snippet", slug: s.slug,
      rule: "prompt-too-short",
      message: `Snippet prompt is ${s.prompt?.length ?? 0} chars.`,
    });
  }
  return out;
}

function detectUnknownServices(
  surface: Finding["surface"],
  slug: string,
  text: string,
): Finding[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(SERVICE_CANDIDATE_REGEX)) {
    seen.add(m[0].toLowerCase().replace(/\s+/g, " "));
  }
  const unknown = [...seen].filter((s) => !KNOWN_SERVICES.has(s));
  return unknown.map((svc) => ({
    severity: "info" as const,
    surface,
    slug,
    rule: "service-not-curated",
    message: `Mentions "${svc}" — Layer E doc-resolver will fall back to npm/AI synthesis.`,
  }));
}

export function runQAHarness(): QAReport {
  const findings: Finding[] = [];

  findings.push(...uniqueSlugCheck(START_IDEAS, "template", (t) => t.title));
  findings.push(...uniqueSlugCheck(INDUSTRY_PACKS, "pack", (p) => p.slug));
  findings.push(...uniqueSlugCheck(THEME_PRESETS, "theme", (t) => t.slug));
  findings.push(...uniqueSlugCheck(SNIPPETS, "snippet", (s) => s.slug));

  for (const t of START_IDEAS) {
    findings.push(...auditTemplate(t));
    findings.push(...detectUnknownServices("template", t.title, t.prompt ?? ""));
  }
  for (const p of INDUSTRY_PACKS) {
    findings.push(...auditPack(p));
    findings.push(...detectUnknownServices("pack", p.slug, p.brief ?? ""));
  }
  for (const t of THEME_PRESETS) findings.push(...auditTheme(t));
  for (const s of SNIPPETS) {
    findings.push(...auditSnippet(s));
    findings.push(...detectUnknownServices("snippet", s.slug, s.prompt ?? ""));
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warn").length;

  return {
    ranAt: new Date().toISOString(),
    counts: {
      templates: START_IDEAS.length,
      packs: INDUSTRY_PACKS.length,
      themes: THEME_PRESETS.length,
      snippets: SNIPPETS.length,
      errors,
      warnings,
    },
    findings,
  };
}
