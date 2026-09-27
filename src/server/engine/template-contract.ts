/**
 * Webby parity: pre-loaded template metadata.
 *
 * Webby's runner injects the template's machine-readable contract straight
 * into the first user message so the agent never has to spend a round trip on
 * `readFile("template.json")` before it can write code. The file itself still
 * exists in the workspace (the executor reads it back for route/orphan
 * checks, and later turns may read it), it is simply pre-loaded.
 *
 * Kimble does the same. `template.json` is shipped by the scaffold kit and is
 * scaffold-owned (read allowed, write refused); this module renders the same
 * contract as a prompt section so the first build starts writing immediately
 * with an accurate picture of what already exists.
 *
 * Derived, never hand-maintained: the content comes from the kit itself.
 */
import { KIT_FILES } from "@/server/scaffold-kit";

export const TEMPLATE_CONTRACT_PATH = "template.json";

/** The contract file's content, as shipped by the scaffold kit. */
export function templateContractContent(): string {
  return KIT_FILES.find((f) => f.path === TEMPLATE_CONTRACT_PATH)?.content ?? "";
}

/** Parsed contract, or null when the kit somehow did not ship it. */
export function templateContract(): Record<string, unknown> | null {
  const raw = templateContractContent();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The prompt section. Mirrors Webby's `buildTemplateMetadataSection`: layout,
 * available primitives, icon set, routing pattern, usage examples — stated as
 * fact so the model does not read or guess them.
 */
export function renderTemplateMetadataSection(): string {
  const c = templateContract();
  if (!c) return "";
  const fs = (c["file_structure"] ?? {}) as Record<string, string>;
  const styling = (c["styling"] ?? {}) as Record<string, string>;
  const shadcn = Array.isArray(c["shadcn_components"]) ? (c["shadcn_components"] as string[]) : [];
  const examples = (c["usage_examples"] ?? {}) as Record<string, string>;
  const protectedFiles = Array.isArray(c["protected_files"]) ? (c["protected_files"] as string[]) : [];

  return (
    `\n### Project contract (template.json — already in the workspace, do not read it)\n` +
    `Pages: ${fs["pages_dir"]}/  ·  Components: ${fs["components_dir"]}/  ·  ` +
    `Router: ${fs["routes_file"]}  ·  Entry: ${fs["entry_file"]}  ·  Stylesheet: ${fs["stylesheet"]}\n` +
    `Routing: ${c["routing_pattern"]}  ·  Styling: ${styling["framework"]} v${styling["tailwind_version"]} ` +
    `(${styling["tokens"]})  ·  Icons: ${styling["icon_set"]}\n` +
    `Pre-installed UI kit at @/components/ui — import these, never write them: ${shadcn.join(", ")}.\n` +
    `Reference blocks you may copy from: @/components/blocks/*, @/components/examples/*, ` +
    `@/components/motion, @/components/fx.\n` +
    `Read-only (writes are refused): ${protectedFiles.join(", ")}.\n` +
    Object.values(examples)
      .map((e) => `- ${e}`)
      .join("\n") +
    `\n`
  );
}
