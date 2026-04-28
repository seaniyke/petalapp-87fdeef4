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
  const truncations = args.issues.filter((i) => i.kind === "truncation");
  if (truncations.length === 0) {
    return { files: args.files, result: { ran: false, completedFiles: 0, notes: [] } };
  }

  const byPath = new Map(args.files.map((f) => [f.path, f]));
  const notes: string[] = [];
  let count = 0;

  // Limit blast radius — at most 3 continuation calls per turn.
  for (const issue of truncations.slice(0, 3)) {
    const file = byPath.get(issue.path);
    if (!file) continue;

    try {
      const resp = await aiChatCompletions({
        feature: "recovery",
        body: {
          model: args.model,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `Path: ${file.path}\n\nPartial contents (truncated mid-stream):\n\n${file.content}`,
            },
          ],
          max_tokens: 2000,
          temperature: 0.1,
        },
      });

      if (!resp.ok) {
        notes.push(`${file.path}: HTTP ${resp.status}`);
        continue;
      }

      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      let tail = data.choices?.[0]?.message?.content ?? "";
      if (!tail.trim()) {
        notes.push(`${file.path}: empty completion`);
        continue;
      }

      // Strip accidental fences.
      tail = tail.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```\s*$/g, "");

      // If the model accidentally re-emitted the head, drop the overlap.
      const overlapWindow = file.content.slice(-200);
      const overlapIdx = tail.indexOf(overlapWindow);
      if (overlapIdx !== -1) {
        tail = tail.slice(overlapIdx + overlapWindow.length);
      }

      const merged = file.content + (file.content.endsWith("\n") ? "" : "\n") + tail;

      // Verify the continuation actually helped — if it's still truncated
      // OR braces are still wildly unbalanced, keep the original (the
      // post-stream autofix model gets a shot next).
      const after = verifyFileLocal(file.path, merged);
      const stillTruncated = after.some((i) => i.kind === "truncation");
      if (stillTruncated) {
        notes.push(`${file.path}: continuation still truncated, skipping`);
        continue;
      }

      byPath.set(file.path, { path: file.path, content: merged });
      notes.push(`${file.path}: appended ${tail.length} bytes`);
      count++;
    } catch (e) {
      notes.push(
        `${file.path}: ${e instanceof Error ? e.message : "continuation failed"}`,
      );
    }
  }

  return {
    files: Array.from(byPath.values()),
    result: { ran: true, completedFiles: count, notes },
  };
}
