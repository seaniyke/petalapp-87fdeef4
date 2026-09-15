/**
 * Unwritten-route completion gate.
 *
 * Failure mode this closes (observed on a real "landing + auth + dashboard"
 * build): the model wrote the app shell with only the marketing route and left
 * `{/* Authentication routes will be added here *\/}` and
 * `{/* Dashboard routes will be added here *\/}` behind. Nothing was missing
 * from the import graph, so the build went green, the route verifier only saw
 * `/`, and the user received an app with two-thirds of the requested product
 * absent.
 *
 * This pass finds those promissory comments in the router shell and makes ONE
 * focused model call that authors the screens for real and wires them into the
 * router.
 *
 * Hard rules: never throws, never blocks a turn, and only writes the shell plus
 * new page files. Failing open ships exactly what would have shipped anyway.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  PATCH_FILES_TOOL,
  applyOpsPartial,
  type FileOp,
  type ProjectFile,
} from "@/server/generate.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";

const SHELL = /^src\/(App|main)\.(tsx|jsx)$/i;
const PAGE_TARGET = /^src\/(pages|routes|screens|views|components)\/.+\.(tsx|jsx)$/i;

/** `{/* Dashboard routes will be added here *\/}` and friends. */
const PROMISE_COMMENT =
  /\{?\s*\/\*[^*]{0,160}?(?:will be added|will go here|to be added|add(?:ed)? later|TODO|coming soon)[^*]{0,160}?\*\/\s*\}?/gi;

const SYSTEM = `You are finishing a React + TypeScript + Tailwind single-page app.

The router shell contains placeholder comments where whole screens were promised but never written.
Write those screens for real and wire them into the router.

- Create one file per screen under src/pages/ and route to it from the shell.
- Remove the placeholder comments you fulfil.
- Use the committed design-system tokens for every colour (bg-background, text-foreground, bg-card,
  text-muted-foreground, border-border, bg-primary...). Never raw Tailwind palette utilities
  (bg-white, text-gray-500) and never hex values.
- Reuse the existing components listed as available before writing new markup.
- Real, specific content for this product: full forms with labels and validation states, tables,
  cards, stats, empty states. No lorem ipsum, no "coming soon".
- Only import modules that already exist or that you create in this same response.
- Keep the shell's existing routes and exports intact.
- Responsive and usable at 390px, 820px and 1440px.

Return every file through the patch_files tool.`;

export interface UnwrittenRoutesResult {
  files: ProjectFile[];
  /** Promissory comments found in the shell. */
  promises: string[];
  /** Paths written or rewritten. */
  writtenPaths: string[];
}

/** Router-shell files that still promise screens they never wrote. */
export function findUnwrittenRoutePromises(files: ProjectFile[]): {
  shell: ProjectFile | null;
  promises: string[];
} {
  const shell = files.find((f) => SHELL.test(f.path) && /<Routes?\b|createBrowserRouter|createRouter/.test(f.content));
  if (!shell) return { shell: null, promises: [] };
  const promises = shell.content.match(PROMISE_COMMENT) ?? [];
  return { shell, promises: promises.map((p) => p.trim()).slice(0, 8) };
}

export async function completeUnwrittenRoutes(args: {
  files: ProjectFile[];
  design: PicDesignSystem | null;
  model: string;
  userRequest: string;
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<UnwrittenRoutesResult> {
  const idle: UnwrittenRoutesResult = { files: args.files, promises: [], writtenPaths: [] };
  let shell: ProjectFile | null;
  let promises: string[];
  try {
    ({ shell, promises } = findUnwrittenRoutePromises(args.files));
  } catch {
    return idle;
  }
  if (!shell || promises.length === 0) return idle;

  console.log(
    `[unwritten-routes] project=${args.projectId ?? "n/a"} promises=${promises.length}`,
  );

  const availableComponents = args.files
    .filter((f) => /^src\/components\/.+\.(tsx|jsx)$/i.test(f.path))
    .map((f) => f.path)
    .slice(0, 60);
  const design = args.design ? JSON.stringify(args.design).slice(0, 2400) : "(none committed)";

  const prompt =
    `What the user asked for:\n${args.userRequest.slice(0, 1200)}\n\n` +
    `Design system (JSON):\n${design}\n\n` +
    `Available components to reuse:\n${availableComponents.join("\n")}\n\n` +
    `Unfulfilled promises in the shell:\n${promises.join("\n")}\n\n` +
    `Router shell --- ${shell.path} ---\n${shell.content.slice(0, 12000)}`;

  try {
    const res = await aiChatCompletions({
      feature: "generate",
      timeoutTier: "default",
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "unwritten-routes",
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
    if (!res.ok) return { ...idle, promises };
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const rawArgs = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) return { ...idle, promises };
    const parsed = JSON.parse(rawArgs) as { ops?: FileOp[] };
    const ops = (parsed.ops ?? []).filter(
      (op) => op && op.op !== "delete" && (op.path === shell!.path || PAGE_TARGET.test(op.path)),
    );
    if (ops.length === 0) return { ...idle, promises };

    const applied = applyOpsPartial(args.files, ops);
    const writtenPaths = ops.map((op) => op.path);
    console.log(`[unwritten-routes] wrote ${writtenPaths.length} file(s)`);
    return { files: applied.files, promises, writtenPaths };
  } catch (e) {
    console.warn("[unwritten-routes] skipped:", e instanceof Error ? e.message : String(e));
    return { ...idle, promises };
  }
}
