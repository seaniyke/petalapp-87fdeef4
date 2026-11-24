/** A scoped next step inside the existing conversation, never a second writer.
 * Frontier reasoning supplies the page specification; deterministic evidence
 * checks dependencies before the fast model can consume it. */
export interface SecondaryWork {
  path: string;
  kind: "informational" | "read_only_list";
  task: string;
  dependencies: string[];
}

export interface SecondaryEvidence {
  pages: Array<{ route: string; file: string }>;
  files: Map<string, string>;
  validatedHash: Map<string, string>;
  validation: Map<string, string[]>;
  hash: (content: string) => string;
}

/** Refusal means frontier continues the work, never that a feature is banned. */
export function secondaryWorkRefusal(work: SecondaryWork, ev: SecondaryEvidence): string | null {
  const page = ev.pages.find((p) => p.file === work.path);
  if (!page || !/^src\/pages\/[\w/-]+\.tsx$/.test(work.path)) return "Use the frontier model for unplanned or shared files.";
  if (page.route === "/" || page.route === "/dashboard" || ev.pages[0]?.file === work.path) return "The core page stays on the frontier model.";
  if (!["informational", "read_only_list"].includes(work.kind) || !work.task.trim()) return "Supply a routine page specification, otherwise continue on the frontier model.";
  if (/\b(auth(?:entication|orization)?|permissions?|schema|migration|payments?|checkout|booking|state.machine|workflow|webhook|write.api|mutations?)\b/i.test(work.task)) return "Complex behaviour stays on the frontier model.";
  if (!work.dependencies.length) return "Build and validate the shared dependencies first.";
  let hasFoundation = false;
  for (const path of work.dependencies) {
    const content = ev.files.get(path);
    if (content === undefined || !ev.validation.has(path) || ev.validation.get(path)?.length || ev.validatedHash.get(path) !== ev.hash(content)) return `Dependency ${path} must exist and be validated at its current content first.`;
    if (!path.startsWith("src/pages/") && path.startsWith("src/")) hasFoundation = true;
  }
  return hasFoundation ? null : "A validated shared foundation is required; page names alone are not evidence.";
}

export function secondaryWorkBrief(work: SecondaryWork): string {
  return `Routine secondary page: ${work.path} (${work.kind}).\n${work.task}\n` +
    `Use the already validated dependencies: ${work.dependencies.join(", ")}. ` +
    "Keep the committed design, full requested functionality and image requirements. " +
    "Only this page may be written in this step. If it needs new shared behaviour, report that need instead; " +
    "the frontier model resumes next. Do not call finish; the frontier model reviews the result and completes the request.";
}