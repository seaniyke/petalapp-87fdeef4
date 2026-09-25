/**
 * Project ↔ design-system association and AI context.
 *
 * The selection lives on the existing committed design contract
 * (`PicDesignSystem.package`) — no second store.
 */
import type { PicDesignSystem } from "@/server/pic/pic-types";
import { getDesignSystem } from "./registry";
import type { DesignSystemPackage } from "./loader";
import { resolveSelection, withPackageVisuals } from "./authority";

export interface DesignPackageSelection {
  systemId: string;
  accent: string;
}

/**
 * Decide the stored design record after a generation re-commits it.
 *
 * - Project already on a package: the package stays, and colours/typography
 *   are re-derived from it — a generation can never change or drop it.
 * - Brand-new project (no previous record): the freshly committed record
 *   (which carries the default package) is accepted.
 * - Legacy project (record without a package): its stored look is kept as-is
 *   and it is marked `legacy-unmapped`; it is never silently moved to a package.
 */
export function preserveDesignPackage(
  prev: PicDesignSystem | null | undefined,
  next: PicDesignSystem | null,
): PicDesignSystem | null {
  if (!next) return prev ?? next;
  if (!prev) return next;
  if (prev.package) {
    const sel = resolveSelection(prev.package);
    return sel ? withPackageVisuals({ ...next }, sel.pkg, sel.accent) : { ...next, typography: prev.typography, colors: prev.colors, radius: prev.radius, package: prev.package, source: prev.source };
  }
  const { package: _drop, ...rest } = next;
  return { ...rest, typography: prev.typography, colors: prev.colors, radius: prev.radius, source: prev.source, migration: "legacy-unmapped" };
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
