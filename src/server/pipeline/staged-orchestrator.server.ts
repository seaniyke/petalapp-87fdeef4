/**
 * Staged Pipeline — orchestrator entrypoint.
 *
 * Runs Plan → Scaffold (parallel) → Wire-up to completion BEFORE opening
 * the SSE response. This lets us return `null` (caller falls back to the
 * monolithic path) for any condition that should not surface to the user
 * — most importantly `missing_root_view` and `scaffold_syntax_unrecoverable`,
 * which both mean the user's best chance at a real app this turn is the
 * monolithic path's retry/continuation budget.
 *
 * Behavior contract:
 *   - Returns `null` when the pipeline could not finish OR when the
 *     monolithic path would do better; the caller MUST fall back.
 *   - Returns a Response when the pipeline succeeded end-to-end with a
 *     real, renderable result. Never throws.
 *
 * Phase 1 (one quality path): the orchestrator accepts the `context`
 * bundle the monolithic path already computes (designDirection +
 * appShape) so both paths share the same brief surface. Previously the
 * staged path received only the raw user text and produced
 * sidebar-and-dashboard plans for every prompt.
 *
 * Phase 2 (design tokens land in code): when a design direction with a
 * theme key is supplied, we deterministically pre-write src/styles.css
 * with the matching oklch tokens. This guarantees the chosen palette is
 * visible on first paint instead of relying on the model to remember the
 * theme block.
 *
 * The SSE events are emitted in the order the existing client expects
 * (phase → status → file_complete* → phase → status → result) so the
 * activity card renders identically to the monolithic path.
 */

import { runStagePlan } from "./stage-plan.server";
import { runStageScaffold } from "./stage-scaffold.server";
import { runStageWireup } from "./stage-wireup.server";
import type { DesignDirection } from "@/server/design-director.server";
import { applyScaffoldKit, STYLES_CSS } from "@/server/scaffold-kit";
import { THEMES } from "@/server/themes.server";
import type { AppShape } from "@/lib/app-shape-classifier";
import type { WebSubtype } from "@/lib/web-subtype";
import type { ProjectFile, StreamEvent } from "@/server/generate.server";

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface StagedPipelineContext {
  /** Rendered `## Predicted app shape` block from app-shape-classifier. */
  appShapeBlock?: string;
  /** Classified shape — drives archetype hint + token quality checks. */
  appShape?: AppShape;
  /** Rendered design direction block from design-director. */
  designDirectionBlock?: string;
  /** The full design direction. Theme key drives the styles.css pre-write. */
  designDirection?: DesignDirection | null;
  /** Web subtype from the main router; marketing must stay marketing-only. */
  webSubtype?: WebSubtype;
}

/** Map an AppShape category to one of the planner's archetype slots. */
function archetypeFromShape(
  shape: AppShape | undefined,
  brief: string,
  webSubtype?: WebSubtype,
): "feed" | "marketing" | "dashboard" | "tool" | "game" | "content" | "business-app" | undefined {
  const b = brief.toLowerCase();

  // The web-subtype router is the higher-confidence signal for initial web
  // requests. If the user says "landing page", do not let a marketplace/social
  // shape upgrade it into a business app and leak dashboards into the page.
  if (webSubtype === "marketing") return "marketing";
  if (webSubtype === "fullstack") return "business-app";

  // Explicit user opt-outs — these short-circuit any business-app upgrade.
  // The user asked for a single surface; honour it.
  if (/\b(admin (only|dashboard)|internal tool|back ?office|analytics dashboard|chrome extension|browser extension|mobile app only|api only)\b/.test(b)) {
    if (/\b(chrome extension|browser extension|mobile app only)\b/.test(b)) return "tool";
    return "dashboard";
  }

  if (!shape) {
    // Fall back to a tiny brief sniff so this doesn't no-op without context.
    if (/\b(feed|post|share|community|anonymous|wall|board)\b/.test(b)) return "feed";
    if (/\b(game|play|score|leaderboard|arcade)\b/.test(b)) return "game";
    // Brief-only sniff for business prompts when classifier is silent.
    if (/\b(saas|crm|fintech|marketplace|platform|startup|edtech|healthtech|booking system|ai (product|startup|tool))\b/.test(b)) {
      return "business-app";
    }
    return undefined;
  }

  if (shape.category === "internal-tool") return "dashboard";
  if (shape.category === "game") return "game";
  if (shape.category === "content" || shape.category === "newsletter") return "content";

  // Business categories — generate marketing site + auth'd app together.
  if (
    shape.category === "saas" ||
    shape.category === "fintech" ||
    shape.category === "crypto" ||
    shape.category === "marketplace" ||
    shape.category === "ecommerce" ||
    shape.category === "booking" ||
    shape.category === "social" ||
    shape.category === "ai-tool"
  ) {
    return "business-app";
  }

  // Marketing-only categories (no logged-in product surface).
  if (
    shape.category === "consultancy" ||
    shape.category === "local-business" ||
    shape.category === "restaurant" ||
    shape.category === "real-estate" ||
    shape.category === "creator" ||
    shape.category === "directory"
  ) {
    return "marketing";
  }
  return undefined;
}

/** Compact one-line summary of the design direction for per-file scaffold prompts. */
function summarizeDesign(direction: DesignDirection | null | undefined): string | undefined {
  if (!direction) return undefined;
  const moves = direction.design_moves.slice(0, 2).join("; ");
  return `${direction.vibe} — ${direction.display_font}/${direction.body_font}, ${direction.palette_mood}. Moves: ${moves}.`;
}

/**
 * Build src/styles.css from the chosen theme's oklch tokens. This is the
 * single most important "design lands in code" lever — without it the
 * model defaults to shadcn-on-white regardless of how strong the design
 * prompt was.
 */
function buildStylesCssFromTheme(direction: DesignDirection): string | null {
  const themeKey = direction.theme;
  if (!themeKey || !(themeKey in THEMES)) return null;
  const theme = THEMES[themeKey];
  const tokenEntries = Object.entries(theme.tokens);
  const tokens = tokenEntries
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  const themeMappings = tokenEntries
    .map(([k]) => `  --color-${k.replace(/^--/, "")}: var(${k});`)
    .join("\n");
  const baseTheme = STYLES_CSS.match(/@theme\s*\{[\s\S]*?\n\}/)?.[0] ?? [
    "@theme {",
    themeMappings,
    "  --font-sans: var(--font-body);",
    "  --font-display: var(--font-heading);",
    "  --font-serif: ui-serif, Georgia, Cambria, serif;",
    "}",
  ].join("\n");
  // Tailwind v4 needs both CSS variables AND @theme mappings. Without the
  // @theme block, utilities like bg-background/text-foreground/grid never
  // compile and the preview falls back to browser-default Times/blue links.
  return [
    '@import "tailwindcss";',
    '@import "@fontsource-variable/inter";',
    '@import "@fontsource-variable/jetbrains-mono";',
    "",
    '@custom-variant dark (&:where(.dark, .dark *));',
    "",
    "/* Design tokens — committed by Petal from the chosen theme.",
    `   vibe: ${direction.vibe} */`,
    baseTheme,
    "",
    ":root {",
    `  --font-body: "${theme.body_font}", ui-sans-serif, system-ui, -apple-system, sans-serif;`,
    `  --font-heading: "${theme.display_font}", "${theme.body_font}", ui-serif, serif;`,
    tokens,
    "}",
    "",
    ".dark {",
    `  --font-body: "${theme.body_font}", ui-sans-serif, system-ui, -apple-system, sans-serif;`,
    `  --font-heading: "${theme.display_font}", "${theme.body_font}", ui-serif, serif;`,
    tokens,
    "}",
    "",
    "html, body, #root { height: 100%; }",
    "body {",
    "  font-family: var(--font-body);",
    "  background: var(--color-background);",
    "  color: var(--color-foreground);",
    "  -webkit-font-smoothing: antialiased;",
    "  text-rendering: optimizeLegibility;",
    "}",
    "",
    ".font-display {",
    "  font-family: var(--font-heading);",
    "}",
    "",
  ].join("\n");
}

export async function runStagedPipelineStream(args: {
  brief: string;
  hasBackend: boolean;
  backend?: { url: string; anonKey: string };
  context?: StagedPipelineContext;
}): Promise<Response | null> {
  const ctx = args.context ?? {};
  const archetypeHint = archetypeFromShape(ctx.appShape, args.brief, ctx.webSubtype);
  const designSummary = summarizeDesign(ctx.designDirection ?? undefined);

  // STAGE 1 — plan.
  const plan = await runStagePlan({
    brief: args.brief,
    hasBackend: args.hasBackend,
    context: {
      appShapeBlock: ctx.appShapeBlock,
      designDirectionBlock: ctx.designDirectionBlock,
      archetypeHint,
      businessDomain: ctx.appShape?.businessDomain,
      category: ctx.appShape?.category,
    },
  });
  if (!plan.ok) {
    console.warn("[staged] plan failed:", plan.reason);
    return null;
  }

  // STAGE 2 — parallel scaffold.
  const scaffold = await runStageScaffold({
    plan: plan.files,
    brief: args.brief,
    manifestSummary: plan.summary,
    context: { designSummary },
  });
  if (!scaffold.ok) {
    console.warn("[staged] scaffold failed:", scaffold.reason);
    return null;
  }

  // Catch the "model emitted unparseable code twice in a row" failure
  // mode. Falling back to the monolithic path (which has its own
  // continuation + autofix budget) is better than shipping broken JSX.
  if (scaffold.syntaxUnrecoverable.length > 0) {
    console.warn(
      `[staged] scaffold_syntax_unrecoverable on ${scaffold.syntaxUnrecoverable.join(", ")} — falling back to monolithic`,
    );
    return null;
  }

  // Phase 2 — deterministically inject src/styles.css from the chosen theme
  // tokens. This runs BEFORE wire-up so any verifier that scans styles.css
  // sees the real palette, not Tailwind defaults.
  let scaffoldFiles = scaffold.files;
  if (ctx.designDirection) {
    const stylesCss = buildStylesCssFromTheme(ctx.designDirection);
    if (stylesCss) {
      const idx = scaffoldFiles.findIndex((f) => f.path === "src/styles.css");
      if (idx >= 0) {
        // Model already emitted one — replace.
        scaffoldFiles = scaffoldFiles.map((f, i) =>
          i === idx ? { path: "src/styles.css", content: stylesCss } : f,
        );
      } else {
        scaffoldFiles = [{ path: "src/styles.css", content: stylesCss }, ...scaffoldFiles];
      }
    }
  }

  // STAGE 3 — wireup + renderable-shell guard.
  const wireup = await runStageWireup({ files: scaffoldFiles, brief: args.brief });
  if (!wireup.ok) {
    // missing_root_view / verifier failures all warrant a silent fallback
    // — the monolithic path has retries and continuation we don't have
    // here, and giving the user a real app beats surfacing the failure.
    console.warn(
      `[staged] wireup failed (${wireup.reason}) — falling back to monolithic:`,
      wireup.blockingIssues.join(" | "),
    );
    return null;
  }

  // All three stages succeeded. Replay the events as an SSE stream so the
  // client renders the same progress UI it always does.
  const encoder = new TextEncoder();
  const events: StreamEvent[] = [
    { type: "phase", phase: "thinking" },
    { type: "status", message: `Planning ${plan.files.length} files…` },
    { type: "phase", phase: "writing" },
    { type: "status", message: "Writing files in parallel…" },
    ...scaffoldFiles.map((f, i) => ({
      type: "file_complete" as const,
      path: f.path,
      bytes: f.content.length,
      index: i,
    })),
    { type: "phase", phase: "polishing" },
    { type: "status", message: "Verifying the build…" },
    {
      type: "result",
      files: wireup.files as ProjectFile[],
      summary: wireup.summary,
    },
  ];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(sse(ev)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
