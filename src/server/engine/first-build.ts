/**
 * First-build entry into the tool loop. There is no monolithic
 * write_project generation before the loop: the loop starts from the empty
 * workspace (or a resumed checkpoint) and writes everything with tools.
 */
import type { ProjectFile } from "@/lib/project-types";

/** Files a first build starts from: saved checkpoint files, else none. */
export function firstBuildSeedFiles(args: string | null | undefined): ProjectFile[] {
  if (!args) return [];
  try {
    const parsed = JSON.parse(args) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (f): f is ProjectFile =>
        !!f && typeof (f as ProjectFile).path === "string" && typeof (f as ProjectFile).content === "string",
    );
  } catch {
    return [];
  }
}

/** Appended to the stable system prefix: tools replace the structured payload. */
export const FIRST_BUILD_TOOL_NOTE =
  "\n\n### Execution mode: tools\n" +
  "There is NO write_project tool in this conversation. Build the app with the provided tools: " +
  "create_file for new files, edit_file for exact changes, read_file/list_files/search only when you need " +
  "information you do not already have, finish when done. Emit several create_file calls in one response " +
  "(shared modules, layout/router and pages together) — useful work per response is what matters.\n";

export function firstBuildBrief(
  request: string,
  planned: Array<{ route: string; file: string }>,
  existing: string[],
): string {
  const pages = planned.map((p) => `${p.route} → ${p.file}`).join(", ");
  const workspace = existing.length
    ? `The workspace already holds ${existing.length} saved files from an interrupted run: ${existing.join(", ")}. ` +
      `Do not rewrite them; write what is still missing.`
    : `The workspace is empty — you already know everything in it, so do not list or read files before writing. ` +
      `Start writing immediately.`;
  return (
    `${request}\n\n${workspace}\n` +
    `Write src/App.tsx (router + shared layout with navigation and footer), every shared module the pages import, ` +
    `and every planned page, then call finish. Planned pages: ${pages}.`
  );
}
