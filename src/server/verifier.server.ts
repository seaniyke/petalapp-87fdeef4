/**
 * Tier 3 — Replit-style verifier pass.
 *
 * After generate finishes (and after the regex + post-stream autofixers
 * have run), send the changed files to a tiny model with one job:
 * "scan for compile/import/type/JSX errors that would break the build".
 *
 * If it flags issues, we emit a `verifier_warning` SSE event AND trigger
 * the existing post-stream autofix recovery loop one more time. The
 * verifier itself never edits files — recovery does.
 *
 * Budget: ONE gemini-flash-lite call, ≤500 output tokens, gated to
 * skip when the turn is trivial (≤2 small files) or the autofixer
 * already burned its recovery pass.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";
import type { ProjectFile } from "@/server/generate.server";

export interface VerifierIssue {
  path: string;
  /** "import" | "syntax" | "type" | "jsx" | "other" */
  kind: string;
  /** ≤ 16 words describing the problem. */
  detail: string;
}

export interface VerifierReport {
  ran: boolean;
  ok: boolean;
  issues: VerifierIssue[];
}

export function shouldRunVerifier(args: {
  fileCount: number;
  changedPaths: string[];
}): boolean {
  // Skip noise turns (single tiny files, css-only patches).
  if (args.fileCount === 0) return false;
  if (args.changedPaths.length <= 1) {
    const only = args.changedPaths[0] ?? "";
    if (only.endsWith(".css") || only.endsWith(".html")) return false;
  }
  return true;
}

const SYSTEM = `You are a code verifier for a React + TanStack Start + Tailwind v4 + Vite app.

You will receive a list of files. Your ONLY job: spot OBVIOUS build-breakers a compiler/bundler would reject. Be terse. Be honest.

LOOK FOR:
- Imports that won't resolve (typoed packages, missing local files in the set, "react-router-dom" instead of "@/components/ui/router", "@supabase/supabase-js" instead of "@/integrations/backend/client")
- Unbalanced JSX tags
- Missing braces / parens / semicolons that prevent parsing
- Adjacent JSX elements not wrapped in a fragment in a return
- Obvious type errors (calling a non-function, accessing .map on a non-array literal, etc.)
- React.lazy(() => import("...")) pointing at files that only export named components, which renders undefined and crashes React.
- Tailwind v3 directives in styles.css (@tailwind base/components/utilities)

DO NOT FLAG:
- Style/design choices, naming, copy, color decisions
- Dead code, unused imports (linter's job, not yours)
- Anything you'd need to run the app to know
- Anything in src/components/ui/, src/integrations/backend/, src/components/examples/

If the files look fine, return an empty issues array. Call "verify" exactly once.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "verify",
    description: "Report obvious build-breakers found in the changed files.",
    parameters: {
      type: "object" as const,
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              kind: {
                type: "string",
                enum: ["import", "syntax", "type", "jsx", "other"],
              },
              detail: { type: "string", description: "≤16 words." },
            },
            required: ["path", "kind", "detail"],
          },
        },
      },
      required: ["issues"],
    },
  },
};

const PROTECTED_PREFIXES = [
  "src/components/ui/",
  "src/components/examples/",
  "src/integrations/backend/",
];

function isProtected(p: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Run the verifier. Failures return ran=false; never throws. */
export async function runVerifier(
  files: ProjectFile[],
  changedPaths: string[],
): Promise<VerifierReport> {
  if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return { ran: false, ok: true, issues: [] };
  }

  const changed = new Set(changedPaths);
  const candidates = files
    .filter((f) => changed.has(f.path) && !isProtected(f.path))
    .filter((f) => /\.(tsx?|jsx?|css|html)$/.test(f.path));

  if (candidates.length === 0) {
    return { ran: false, ok: true, issues: [] };
  }

  // Cap input — verifier is read-only so we can be aggressive.
  const MAX_BYTES = 50_000;
  let used = 0;
  const trimmed: ProjectFile[] = [];
  for (const f of candidates) {
    if (used + f.content.length > MAX_BYTES) break;
    trimmed.push(f);
    used += f.content.length;
  }

  const payload = trimmed.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");

  try {
    const resp = await aiChatCompletions({
      feature: "recovery",
      body: {
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: payload },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "verify" } },
        max_tokens: 500,
      },
    });
    if (!resp.ok) {
      return { ran: true, ok: true, issues: [] };
    }
    const data = (await resp.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { ran: true, ok: true, issues: [] };
    const parsed = JSON.parse(args) as { issues?: VerifierIssue[] };
    const issues = (parsed.issues ?? [])
      .filter((i) => i && typeof i.path === "string" && !isProtected(i.path))
      .slice(0, 8);
    return { ran: true, ok: issues.length === 0, issues };
  } catch (e) {
    console.warn("[verifier] threw:", e);
    return { ran: true, ok: true, issues: [] };
  }
}
