/**
 * Stream continuation (Tier 2.6).
 *
 * When the local verifier detects a TRUNCATED file (stream cut off mid-JSX
 * or mid-statement), the post-stream autofix model is forced to guess what
 * the original output was supposed to be. That's a poor fix.
 *
 * Better: re-prompt the SAME model with the partial output and ask it to
 * emit ONLY the remaining bytes, then splice them onto the truncated file.
 *
 * This is one extra streaming-style call (we use non-stream for simplicity)
 * to the same model, scoped to one file. Costs ~1k tokens. Only fires when
 * the local verifier reports a `truncation` issue — never on healthy turns.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import type { ProjectFile } from "@/server/generate.server";
import type { LocalIssue } from "@/server/local-verifier";
import { verifyFileLocal } from "@/server/local-verifier";

export interface ContinuationResult {
  ran: boolean;
  completedFiles: number;
  notes: string[];
}

const SYSTEM = `You are a code-completion bot. The user will give you a file path and the PARTIAL contents of a file whose generation was cut off mid-stream.

Your job: emit ONLY the missing tail bytes that would complete the file. Do NOT repeat any of the existing content. Do NOT wrap in markdown fences. Do NOT add commentary. Output raw code only — the bytes you emit will be appended verbatim.

Hard rules:
- Match the existing indentation and code style.
- Close every open JSX tag, brace, paren, and bracket.
- Do NOT invent new features or sections — finish what's already there as minimally as possible.
- If the partial file ends mid-component, finish that component sensibly with placeholder children (a heading, a paragraph) and close all tags.
- End the file with a newline.`;

/** Pick the most-truncated file from a verdict and try to complete it. */
export async function runContinuation(args: {
  files: ProjectFile[];
  issues: LocalIssue[];
  model: string;
}): Promise<{ files: ProjectFile[]; result: ContinuationResult }> {
  // A "truncation-shaped" issue is anything that suggests the file ended
  // early: classic mid-statement truncation, an unterminated string/template,
  // or unbalanced braces/parens at file scope. Each of these means the model
  // stopped writing before it should have, and the cheapest fix is to ask
  // the SAME model to emit the missing tail.
  const TRUNCATION_KINDS = new Set([
    "truncation",
    "unterminated-string",
    "braces",
  ]);
  const truncations = args.issues.filter((i) => TRUNCATION_KINDS.has(i.kind));
  if (truncations.length === 0) {
    return { files: args.files, result: { ran: false, completedFiles: 0, notes: [] } };
  }
  // Dedupe by path — one continuation call per file is plenty.
  const seenPaths = new Set<string>();
  const uniq = truncations.filter((i) => {
    if (seenPaths.has(i.path)) return false;
    seenPaths.add(i.path);
    return true;
  });

  const byPath = new Map(args.files.map((f) => [f.path, f]));
  const notes: string[] = [];
  let count = 0;

  // Escalation ladder: if attempt 1 still leaves the file broken, attempt 2
  // promotes to a stronger model. Provider-neutral aliases — the gateway
  // routes by name.
  const escalate = (m: string): string | null => {
    if (/flash-lite/i.test(m)) return m.replace(/flash-lite/i, "flash");
    if (/gpt-5-nano/i.test(m)) return "openai/gpt-5-mini";
    if (/gpt-5-mini/i.test(m)) return "openai/gpt-5";
    if (/gemini-2\.5-flash$/i.test(m)) return "google/gemini-2.5-pro";
    return null;
  };

  // Send only the last ~6KB of the file as anchor context. The full head
  // doesn't help the model emit the tail and burns the response budget.
  const tailAnchor = (s: string): string => (s.length > 6000 ? s.slice(-6000) : s);

  async function attempt(file: ProjectFile, model: string): Promise<string | null> {
    const resp = await aiChatCompletions({
      feature: "recovery",
      body: {
        model,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Path: ${file.path}\n\nPartial contents (truncated mid-stream; tail shown):\n\n${tailAnchor(file.content)}`,
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    let tail = data.choices?.[0]?.message?.content ?? "";
    if (!tail.trim()) return null;
    tail = tail.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```\s*$/g, "");
    const overlapWindow = file.content.slice(-200);
    const overlapIdx = tail.indexOf(overlapWindow);
    if (overlapIdx !== -1) tail = tail.slice(overlapIdx + overlapWindow.length);
    return tail;
  }

  // Limit blast radius — at most 3 files per turn.
  for (const issue of uniq.slice(0, 3)) {
    const file = byPath.get(issue.path);
    if (!file) continue;

    const ladder = [args.model, escalate(args.model)].filter(Boolean) as string[];
    let healed = false;
    let lastNote = "";

    for (const model of ladder) {
      try {
        const tail = await attempt(file, model);
        if (!tail) {
          lastNote = `${file.path}: empty/failed completion (${model})`;
          continue;
        }
        const merged = `${file.content}${tail}`;
        const after = verifyFileLocal(file.path, merged);
        const stillBroken = after.some(
          (i) =>
            i.kind === "truncation" ||
            i.kind === "unterminated-string" ||
            i.kind === "braces",
        );
        if (stillBroken) {
          lastNote = `${file.path}: still broken after ${model}`;
          continue;
        }
        byPath.set(file.path, { path: file.path, content: merged });
        notes.push(
          `${file.path}: appended ${tail.length} bytes (${model}${model !== args.model ? " — escalated" : ""})`,
        );
        count++;
        healed = true;
        break;
      } catch (e) {
        lastNote = `${file.path}: ${e instanceof Error ? e.message : "continuation failed"} (${model})`;
      }
    }
    if (!healed) notes.push(lastNote || `${file.path}: persistent truncation, dropping`);
  }

  return {
    files: Array.from(byPath.values()),
    result: { ran: true, completedFiles: count, notes },
  };
}
