/**
 * Project Context layer — the ONE deterministic place that turns project
 * reality into focused AI context. No AI calls. Used by /api/generate.
 *
 *   manifest.ts     — authoritative index of the current project
 *   design-intel.ts — the existing visual language, structured
 *   memory-model.ts — classified memory + source-of-truth precedence
 *   select.ts       — focused file selection + fail-closed section flags
 *   budget.ts       — measured context with priority-ordered dropping
 *
 * Craft knowledge lives in the existing skills registry (@/server/skills),
 * which is selected per task; this layer passes it the detected flags.
 */
export * from "./manifest";
export * from "./design-intel";
export * from "./memory-model";
export * from "./select";
export * from "./budget";

import type { ProjectFile } from "@/server/generate.server";
import type { MemoryEntry } from "@/server/project-memory.server";
import { buildProjectManifest, renderStructureBlock, type ManifestInputs, type ProjectManifest } from "./manifest";
import { renderDesignIntel } from "./design-intel";
import { renderResolvedMemory, resolveMemory, type ClassifiedMemory } from "./memory-model";
import { detectContextFlags, selectContext, type ContextFlags, type Selection } from "./select";

export interface TurnProjectContext {
  manifest: ProjectManifest | null;
  flags: ContextFlags;
  selection: Selection | null;
  memory: ClassifiedMemory[];
  structureBlock: string;
  designBlock: string;
  memoryBlock: string;
}

export function assembleProjectContext(args: {
  files: ProjectFile[];
  request: string;
  isInitial: boolean;
  memoryEntries: MemoryEntry[];
  explicitTargets?: string[];
  manifestInputs?: ManifestInputs;
}): TurnProjectContext {
  // First build: there is no project yet — only the request and memory matter.
  const manifest = args.isInitial ? null : buildProjectManifest(args.files, args.manifestInputs);
  const flags = detectContextFlags(args.request, manifest, { isInitial: args.isInitial });
  const selection = manifest
    ? selectContext(args.request, manifest, { explicitTargets: args.explicitTargets, flags })
    : null;
  const memory = resolveMemory(args.memoryEntries, manifest, args.request);
  return {
    manifest,
    flags,
    selection,
    memory,
    structureBlock: manifest ? renderStructureBlock(manifest) : "",
    designBlock: manifest ? renderDesignIntel(manifest.design, flags.design ? "full" : "tokens") : "",
    // History/inference hints only on first build or structural asks where
    // they help; targeted edits get decisions, preferences and state.
    memoryBlock: renderResolvedMemory(memory, { includeHistory: args.isInitial }),
  };
}
