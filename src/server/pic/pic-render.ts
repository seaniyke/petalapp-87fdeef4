/**
 * PIC — prompt rendering.
 *
 * Turns the canonical context into the block the builder model reads. Pure:
 * no I/O, so it can be unit-tested and reused by any stage.
 */

import type { ProjectIntelligenceContext } from "./pic-types";
import { renderUnderstandingBlock } from "@/server/understanding.server";
import { renderDesignSystemBlock } from "@/server/design/design-system.server";

function list(title: string, items: string[] | undefined, cap = 10): string {
  if (!items || items.length === 0) return "";
  return `${title}\n${items.slice(0, cap).map((i) => `- ${i}`).join("\n")}`;
}

export interface PicRenderOptions {
  /** Structural turns get the full contract; small edits get the summary only. */
  detail?: "full" | "summary";
}

export function renderPicBlock(
  pic: ProjectIntelligenceContext,
  opts: PicRenderOptions = {},
): string {
  const detail = opts.detail ?? "full";

  const summary = [
    "# PROJECT INTELLIGENCE CONTEXT",
    "This is the committed understanding of this project. It is authoritative. Build against it; never contradict it, and never silently re-decide something recorded here.",
    "",
    renderUnderstandingBlock(pic.understanding),
  ].join("\n");

  if (detail === "summary") {
    const locked = pic.protectedDecisions.length
      ? `\n\n${list("## LOCKED DECISIONS (never change without an explicit request)", pic.protectedDecisions)}`
      : "";
    const design = pic.design
      ? `\n\n## DESIGN SYSTEM (already committed)\nDirection: ${pic.design.direction}. Fonts: ${pic.design.typography.displayFont}/${pic.design.typography.bodyFont}. Nav: ${pic.design.navPattern}. Use the existing tokens in src/styles.css — do not introduce new colours.`
      : "";
    return summary + design + locked;
  }

  const sections = [
    summary,
    pic.design ? renderDesignSystemBlock(pic.design) : "",
    list("## USER JOURNEYS", pic.userJourneys),
    list("## FEATURES", pic.features, 16),
    list("## UX DECISIONS", pic.uxDecisions),
    pic.architecture
      ? [
          "## ARCHITECTURE",
          `Frontend: ${pic.architecture.frontend}`,
          `Backend: ${pic.architecture.backend}`,
          pic.architecture.routes.length ? `Routes: ${pic.architecture.routes.join(", ")}` : "",
          pic.architecture.entities.length
            ? `Entities: ${pic.architecture.entities.map((e) => e.name).join(", ")}`
            : "",
          pic.architecture.integrations.length ? `Integrations: ${pic.architecture.integrations.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    pic.security
      ? [
          "## SECURITY",
          `Authentication: ${pic.security.authentication}`,
          `Authorization: ${pic.security.authorization}`,
          pic.security.roles.length ? `Roles: ${pic.security.roles.join(", ")}` : "",
          ...pic.security.rules.map((r) => `- ${r}`),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    list("## ACCEPTANCE CRITERIA (the build is not done until each is true)", pic.acceptanceCriteria, 14),
    list("## LOCKED DECISIONS (never change without an explicit request)", pic.protectedDecisions),
    list("## PROTECTED FILES (do not rewrite unless the request names them)", pic.protectedFiles),
    pic.decisions.length
      ? `## PRIOR DECISIONS\n${pic.decisions
          .slice(-12)
          .map((d) => `- ${d.key}: ${d.value} (${d.confidence})`)
          .join("\n")}`
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}
