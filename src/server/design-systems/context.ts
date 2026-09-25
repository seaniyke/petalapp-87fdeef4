/**
 * Project ↔ design-system association and AI context.
 *
 * The selection lives on the existing committed design contract
 * (`PicDesignSystem.package`) — no second store.
 */
import type { PicDesignSystem } from "@/server/pic/pic-types";
import { getDesignSystem } from "./registry";
import type { DesignSystemPackage } from "./loader";

export interface DesignPackageSelection {
  systemId: string;
  accent: string;
}

/**
 * Normal generations may re-commit the design contract, but must never
 * silently change or drop the selected package. Only the deterministic
 * re-theme path writes `package`.
 */
export function preserveDesignPackage(
  prev: PicDesignSystem | null | undefined,
  next: PicDesignSystem | null,
): PicDesignSystem | null {
  if (!next) return prev?.package ? prev : next;
  if (!prev?.package) {
    // A generation cannot introduce a package either.
    if (next.package) { const { package: _drop, ...rest } = next; return rest as PicDesignSystem; }
    return next;
  }
  return { ...next, package: prev.package };
}

/** Compact, AI-readable context. Token names + roles, never the raw CSS. */
export function renderDesignSystemContext(pkg: DesignSystemPackage, accent: string): string {
  const names = Object.keys(pkg.tokens.root);
  const custom = names.filter((n) => n.startsWith("kimble-"));
  const roles = names.filter((n) => !n.startsWith("kimble-"));
  const a = pkg.accents[accent];
  const comps = Object.keys(pkg.components);
  return [
    `\n\n## SELECTED DESIGN SYSTEM: ${pkg.meta.name} (${pkg.meta.slug}@${pkg.meta.version})`,
    `Precedence: the user's explicit request > project requirements > this design system > generic design defaults. Follow it unless the user asks otherwise. Do not change or replace the design system, its tokens block or its font links — they are applied by Kimble.`,
    `About: ${pkg.meta.description}`,
    `Accent: ${accent}${a ? ` (overrides ${Object.keys(a.light).join(", ")})` : ""}`,
    `Fonts: ${pkg.meta.fonts.join(", ") || "none"} (already loaded)`,
    `Semantic roles available: ${roles.join(", ")}`,
    custom.length ? `System tokens (use var(--name) instead of raw values): ${custom.map((n) => `--${n}`).join(", ")}` : "",
    comps.length ? `Design-system components installed at src/components/design-system/${pkg.meta.slug}/: ${comps.join(", ")}` : "",
    `### Design playbook (DESIGN.md)`,
    pkg.designMd.trim(),
  ].filter(Boolean).join("\n");
}

/** Context block for the project's selected system, or "" when none/invalid. */
export function designSystemBlockFor(design: PicDesignSystem | null | undefined): string {
  const sel = design?.package;
  if (!sel) return "";
  const pkg = getDesignSystem(sel.systemId);
  if (!pkg || !pkg.accents[sel.accent]) return "";
  return renderDesignSystemContext(pkg, sel.accent);
}
