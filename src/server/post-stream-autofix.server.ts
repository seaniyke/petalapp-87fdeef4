/**
 * Post-stream autofix model (Tier 2).
 *
 * After generation completes AND the regex autofixer found ≥1 issue (or the
 * preflight classifier flagged the turn as "risky"), run a tiny fast model
 * over the changed files with a strict "fix obvious build-breakers only"
 * brief. This is the v0-style safety net, scoped narrowly so it never
 * rewrites the user's app.
 *
 * Budget: ONE call to gemini-flash-lite, ≤2k output tokens, gated by gate().
 * Petal eats the cost (it's QA, not user-requested work) — same convention
 * as self-check / humanize-error.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import type { ProjectFile } from "@/server/generate.server";

export interface PostStreamFixResult {
  ran: boolean;
  fixedFiles: number;
  notes: string[];
}

/** Decide whether to invoke the model based on heuristics. */
export function shouldRunPostStreamAutofix(args: {
  autofixCount: number;
  preflightKind?: string;
  fileCount: number;
}): boolean {
  // Always run when the regex autofixer caught something meaningful.
  if (args.autofixCount >= 2) return true;
  // Bigger turns benefit more.
  if (args.fileCount >= 6) return true;
  // Refactor / feature work is high-risk per Bolt/Lovable telemetry patterns.
  if (args.preflightKind === "refactor" || args.preflightKind === "feature") return true;
  return false;
}

const SYSTEM = `You are a code-fix bot. You will receive a set of files from a freshly generated React + Tailwind v4 + Vite app. Your ONLY job is to find OBVIOUS build-breakers and emit minimal patches.

ALLOWED FIXES:
- Bad/missing imports (typoed package names, undefined React hooks, unresolved "@/..." paths)
- Unbalanced JSX tags
- Missing closing braces / semicolons that prevent parsing
- Direct "react-router-dom" or "@supabase/supabase-js" imports → swap to "@/components/ui/router" or "@/integrations/backend/client"
- Tailwind v3 directives (@tailwind base/components/utilities) inside src/styles.css → swap for @import "tailwindcss";
- Tailwind v4 \`@theme { ... }\` block containing nested selectors (\`.dark { ... }\`, \`:root { ... }\`, \`@media (...)\`, or \`&:is(...)\`) → move those nested blocks OUTSIDE @theme. Inside @theme keep ONLY token declarations like \`--color-primary: oklch(...);\` or \`--radius: 0.5rem;\`. Class-based dark mode is already enabled at the top of styles.css via \`@custom-variant dark (&:where(.dark, .dark *));\` — do not redeclare it inside @theme.
- Invalid lucide-react icon names
- React.lazy(() => import("...")) used with a target file that only has named exports. Fix by adding \`export default ComponentName;\` to the target file OR by replacing lazy imports with eager named imports.

FORBIDDEN:
- Refactoring working code
- Renaming components/variables for style reasons
- Adding new features
- Changing copy / colors / layout
- Touching files under src/components/ui/, src/components/examples/, src/integrations/backend/, vite.config.ts, tsconfig.json

If the files look clean, return an empty fixes array. DO NOT invent problems.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "emit_fixes",
    description: "Emit a list of file replacements for OBVIOUS build-breakers only.",
    parameters: {
      type: "object" as const,
      properties: {
        fixes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: {
                type: "string",
                description: "FULL new contents of the file. Omit unchanged files entirely.",
              },
              reason: {
                type: "string",
                description: "≤12 words explaining the build-breaker.",
              },
            },
            required: ["path", "content", "reason"],
          },
        },
      },
      required: ["fixes"],
    },
  },
};

const PROTECTED_PREFIXES = [
  "src/components/ui/",
  "src/components/examples/",
  "src/integrations/backend/",
];
const PROTECTED_PATHS = new Set(["vite.config.ts", "tsconfig.json", "src/lib/utils.ts"]);

function isProtected(p: string): boolean {
  if (PROTECTED_PATHS.has(p)) return true;
  return PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Run the model pass. Returns updated files + a small report. Failures are
 *  swallowed — we just return ran=false and the original files.
 *
 *  `issues` (optional) is the list of structural problems the local verifier
 *  already found. When present we pin them at the top of the user message as
 *  an authoritative MUST-FIX list so the model patches the EXACT files that
 *  are broken (not whatever else looks suspicious to it).
 */
export async function runPostStreamAutofix(
  files: ProjectFile[],
  issues?: { path: string; kind: string; detail: string }[],
): Promise<{ files: ProjectFile[]; result: PostStreamFixResult }> {
  // Only ship the non-scaffold files to the model — keeps token cost down
  // and prevents the model from being tempted to touch protected code.
  const candidates = files.filter((f) => !isProtected(f.path) && /\.(tsx?|jsx?|css|html)$/.test(f.path));
  if (candidates.length === 0) {
    return { files, result: { ran: false, fixedFiles: 0, notes: [] } };
  }

  // When the verifier flagged specific files, ALWAYS include them — even if
  // they would otherwise blow the byte budget — and prioritise them first so
  // they're never trimmed away.
  const flaggedPaths = new Set((issues ?? []).map((i) => i.path));
  candidates.sort((a, b) => {
    const af = flaggedPaths.has(a.path) ? 0 : 1;
    const bf = flaggedPaths.has(b.path) ? 0 : 1;
    return af - bf;
  });

  // Cap input — flash-lite has plenty of context but we don't need to burn it.
  const MAX_BYTES = 60_000;
  let used = 0;
  const trimmed: ProjectFile[] = [];
  for (const f of candidates) {
    const len = f.content.length;
    if (used + len > MAX_BYTES && !flaggedPaths.has(f.path)) break;
    trimmed.push(f);
    used += len;
  }

  const issueBlock = issues && issues.length
    ? `MUST-FIX list (from a deterministic local verifier — these are NOT optional):\n${issues
        .map((i, idx) => `${idx + 1}. ${i.path} — ${i.kind}: ${i.detail}`)
        .join("\n")}\n\nReturn one fix entry per listed path. Do not skip any.\n\n`
    : "";

  const userPayload = issueBlock + trimmed
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");

  try {
    const resp = await aiChatCompletions({
      feature: "recovery",
      body: {
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPayload },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "emit_fixes" } },
        max_tokens: 2000,
      },
    });

    if (!resp.ok) {
      return { files, result: { ran: true, fixedFiles: 0, notes: [`autofix model HTTP ${resp.status}`] } };
    }

    const data = (await resp.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { files, result: { ran: true, fixedFiles: 0, notes: [] } };

    const parsed = JSON.parse(args) as {
      fixes?: Array<{ path: string; content: string; reason: string }>;
    };
    const fixes = (parsed.fixes ?? []).filter((f) => !isProtected(f.path));
    if (fixes.length === 0) {
      return { files, result: { ran: true, fixedFiles: 0, notes: [] } };
    }

    // Apply: replace existing files; ignore "create" since we only fix existing.
    const byPath = new Map(files.map((f) => [f.path, f]));
    const notes: string[] = [];
    let count = 0;
    for (const fx of fixes) {
      if (!byPath.has(fx.path)) continue; // refuse to invent new files
      byPath.set(fx.path, { path: fx.path, content: fx.content });
      notes.push(`${fx.path}: ${fx.reason}`);
      count++;
    }
    return {
      files: Array.from(byPath.values()),
      result: { ran: true, fixedFiles: count, notes },
    };
  } catch (e) {
    return {
      files,
      result: { ran: true, fixedFiles: 0, notes: [`autofix model error: ${e instanceof Error ? e.message : "unknown"}`] },
    };
  }
}
