/**
 * Placeholder-page completion gate.
 *
 * Failure mode this closes (observed on a real fintech build):
 * the model authored `src/App.tsx` plus a mock-data module and stopped. Every
 * screen it routed to was missing, so the import resolver wrote
 * "Coming together" placeholder stubs so the build would resolve — and the
 * turn reported success while the user got an app whose every page was an
 * empty prose block.
 *
 * Stubbing is the right last resort for a build, but it must never be the
 * final state of a screen. This pass finds placeholder pages that are actually
 * routed to and makes ONE focused model call to author them for real, using
 * the project's own design system and existing section components.
 *
 * Hard rules:
 *  - Never throws, never blocks a turn. Failing open ships the stub, which is
 *    exactly what would have shipped anyway.
 *  - Only rewrites files that are currently placeholders. Real pages are never
 *    touched.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  PATCH_FILES_TOOL,
  applyOpsPartial,
  type FileOp,
  type ProjectFile,
} from "@/server/generate.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";

/** Marker written by the import resolver when it invents a missing module. */
export const PLACEHOLDER_MARKER = "Auto-generated stub by Petal import-resolver";

const PAGE_LIKE = /^src\/(pages|routes|screens|views)\/.+\.(tsx|jsx)$/i;
const MAX_PAGES = 6;
const MAX_CONTEXT_FILES = 4;

const SYSTEM = `You are finishing a React + TypeScript + Tailwind app whose screens were never written.

Each listed file is an empty placeholder. Replace every one with a real, complete screen:
- Use the app's committed design system tokens for all colours (bg-background, text-foreground,
  bg-card, text-muted-foreground, border-border, bg-primary...). Never raw Tailwind palette
  utilities (bg-white, text-gray-500) and never hex values.
- Reuse the existing section/block components listed as available before writing new markup.
- Real, specific content for this product — headings, tables, cards, stats, forms, empty states.
  No lorem ipsum, no "coming soon", no placeholder prose.
- Keep the SAME exports the placeholder declares (default export plus any named export), so the
  existing imports keep resolving.
- Import data from existing modules when they fit; do not invent imports to files that do not exist.
- Responsive: usable at 390px, 820px and 1440px.

Return every rewritten file through the patch_files tool.`;

export interface PageCompletionResult {
  files: ProjectFile[];
  /** Placeholder pages found before the pass. */
  placeholders: string[];
  /** Paths actually rewritten with real screens. */
  completedPaths: string[];
}

/** A file whose content is an import-resolver placeholder. */
export function isPlaceholderPage(file: ProjectFile): boolean {
  return PAGE_LIKE.test(file.path) && file.content.includes(PLACEHOLDER_MARKER);
}

/** Placeholder pages that something in the live app actually imports. */
export function findRoutedPlaceholders(files: ProjectFile[]): string[] {
  const placeholders = files.filter(isPlaceholderPage).map((f) => f.path);
  if (placeholders.length === 0) return [];
  const others = files.filter((f) => /\.(tsx|jsx|ts|js)$/i.test(f.path) && !placeholders.includes(f.path));
  return placeholders.filter((p) => {
    const base = p.replace(/^src\//, "").replace(/\.(tsx|jsx)$/i, "");
    const alias = `@/${base}`;
    const tail = base.split("/").slice(-2).join("/");
    return others.some((f) => f.content.includes(alias) || f.content.includes(tail));
  });
}

export async function completePlaceholderPages(args: {
  files: ProjectFile[];
  design: PicDesignSystem | null;
  model: string;
  userRequest: string;
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<PageCompletionResult> {
  const idle: PageCompletionResult = { files: args.files, placeholders: [], completedPaths: [] };
  let targets: string[];
  try {
    targets = findRoutedPlaceholders(args.files).slice(0, MAX_PAGES);
  } catch {
    return idle;
  }
  if (targets.length === 0) return idle;

  console.log(
    `[page-completion] project=${args.projectId ?? "n/a"} placeholder pages=${targets.length}`,
  );

  const byPath = new Map(args.files.map((f) => [f.path, f] as const));
  const shell = args.files
    .filter((f) => /^src\/(App|main)\.(tsx|jsx)$/i.test(f.path))
    .slice(0, MAX_CONTEXT_FILES);
  const availableBlocks = args.files
    .filter((f) => /^src\/components\/.+\.(tsx|jsx)$/i.test(f.path))
    .map((f) => f.path)
    .slice(0, 60);
  const dataModules = args.files
    .filter((f) => /^src\/(lib|data)\/.+\.(ts|tsx)$/i.test(f.path))
    .slice(0, 2);

  const design = args.design ? JSON.stringify(args.design).slice(0, 2400) : "(none committed)";

  const prompt =
    `What the user asked for:\n${args.userRequest.slice(0, 1200)}\n\n` +
    `Design system (JSON):\n${design}\n\n` +
    `Available components to reuse:\n${availableBlocks.join("\n")}\n\n` +
    (dataModules.length
      ? `Existing data modules:\n\n${dataModules.map((f) => `--- ${f.path} ---\n${f.content.slice(0, 6000)}`).join("\n\n")}\n\n`
      : "") +
    (shell.length
      ? `App shell:\n\n${shell.map((f) => `--- ${f.path} ---\n${f.content.slice(0, 8000)}`).join("\n\n")}\n\n`
      : "") +
    `Placeholder screens to write for real:\n\n` +
    targets.map((p) => `--- ${p} ---\n${byPath.get(p)?.content ?? ""}`).join("\n\n");

  try {
    const res = await aiChatCompletions({
      feature: "generate",
      timeoutTier: "long",
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "page-completion",
      },
      body: {
        model: args.model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        tools: [PATCH_FILES_TOOL],
        tool_choice: { type: "function", function: { name: "patch_files" } },
        max_tokens: 16000,
        stream: false,
      },
    });
    if (!res.ok) return idle;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const rawArgs = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) return idle;
    const parsed = JSON.parse(rawArgs) as { ops?: FileOp[] };
    const allowed = new Set(targets);
    const ops = (parsed.ops ?? []).filter(
      (op) => op && allowed.has(op.path) && op.op !== "delete",
    );
    if (ops.length === 0) return idle;

    const applied = applyOpsPartial(args.files, ops);
    // Only count a page as completed when the placeholder marker is gone.
    const after = new Map(applied.files.map((f) => [f.path, f.content] as const));
    const completedPaths = targets.filter((p) => !(after.get(p) ?? "").includes(PLACEHOLDER_MARKER));
    if (completedPaths.length === 0) return { ...idle, placeholders: targets };

    console.log(`[page-completion] wrote ${completedPaths.length}/${targets.length} real screens`);
    return { files: applied.files, placeholders: targets, completedPaths };
  } catch (e) {
    console.warn("[page-completion] skipped:", e instanceof Error ? e.message : String(e));
    return { ...idle, placeholders: targets };
  }
}
