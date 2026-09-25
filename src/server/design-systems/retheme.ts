/**
 * Re-theme orchestration: validate → snapshot → deterministic apply → save
 * through the existing revision transaction → record selection → build.
 *
 * Dependencies are injected so the pipeline is testable and so it reuses
 * Kimble's existing mechanisms (replace_project_files, project_versions,
 * project intelligence, build trigger) instead of new ones.
 */
import type { ProjectFile } from "@/server/generate.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";
import { applyDesignSystem } from "./apply";
import { isValidAccent, type DesignSystemPackage } from "./loader";

export interface RethemeDeps {
  getPackage(slug: string): DesignSystemPackage | null;
  loadFiles(projectId: string): Promise<ProjectFile[]>;
  snapshot(projectId: string, files: ProjectFile[], label: string): Promise<void>;
  /** Atomic save; returns the new project revision. Throws on failure. */
  saveFiles(projectId: string, files: ProjectFile[]): Promise<number | null>;
  loadDesign(projectId: string): Promise<PicDesignSystem | null>;
  saveDesign(projectId: string, design: PicDesignSystem): Promise<void>;
  triggerBuild?(projectId: string, revision: number): Promise<void>;
}

export type RethemeResult =
  | { ok: true; changed: boolean; revision: number | null; changedPaths: string[]; built: boolean }
  | { ok: false; error: string; stage: "validate" | "load" | "apply" | "snapshot" | "save" };

/** Allowed scope for an optional follow-up AI cleanup (not wired to AI here). */
export const RETHEME_CLEANUP_SCOPE = {
  may: ["replace hard-coded colours with semantic tokens", "replace hard-coded font families with font tokens", "replace raw visual values that block the design system"],
  mustNot: ["redesign pages", "change content", "change routes", "change behaviour", "restructure layouts", "add unrelated components", "change business logic"],
} as const;

export async function rethemeProject(
  deps: RethemeDeps,
  args: { projectId: string; systemId: string; accent?: string },
): Promise<RethemeResult> {
  const pkg = deps.getPackage(args.systemId);
  if (!pkg) return { ok: false, stage: "validate", error: `unknown or invalid design system "${args.systemId}"` };
  const accent = args.accent ?? pkg.meta.default_accent;
  if (!isValidAccent(pkg, accent)) return { ok: false, stage: "validate", error: `accent "${accent}" does not belong to ${pkg.meta.slug}` };

  let files: ProjectFile[];
  try { files = await deps.loadFiles(args.projectId); } catch (e) {
    return { ok: false, stage: "load", error: e instanceof Error ? e.message : String(e) };
  }

  const applied = applyDesignSystem(files, pkg, accent);
  if (!applied.ok) return { ok: false, stage: "apply", error: applied.error };

  const design = await deps.loadDesign(args.projectId);
  const recordSelection = async () => {
    if (!design) return;
    const cur = design.package;
    if (cur?.systemId === pkg.meta.slug && cur.accent === accent) return;
    await deps.saveDesign(args.projectId, { ...design, package: { systemId: pkg.meta.slug, accent } });
  };

  if (!applied.changed) {
    await recordSelection();
    return { ok: true, changed: false, revision: null, changedPaths: [], built: false };
  }

  try { await deps.snapshot(args.projectId, files, `Before design system: ${pkg.meta.name} (${accent})`); } catch (e) {
    return { ok: false, stage: "snapshot", error: e instanceof Error ? e.message : String(e) };
  }

  let revision: number | null;
  try { revision = await deps.saveFiles(args.projectId, applied.files); } catch (e) {
    // Atomic save failed: project files are untouched; selection is not recorded.
    return { ok: false, stage: "save", error: e instanceof Error ? e.message : String(e) };
  }

  await recordSelection();
  let built = false;
  if (deps.triggerBuild && revision !== null) {
    try { await deps.triggerBuild(args.projectId, revision); built = true; } catch { /* build can be retried; code is saved */ }
  }
  return { ok: true, changed: true, revision, changedPaths: applied.changedPaths, built };
}
