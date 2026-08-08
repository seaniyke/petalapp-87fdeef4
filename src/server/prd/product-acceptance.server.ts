/**
 * PRD — usefulness layer (Step B).
 *
 * `prd-acceptance` answers "did we build the right surfaces?". This file
 * answers the harder question: "can a person actually DO the thing?".
 *
 * A build can contain every required surface, compile cleanly, and still be
 * useless: buttons wired to nothing, a form that never produces a result,
 * lorem copy where the product's value should be. Those are the failures users
 * describe as "it looks like an app but it does nothing".
 *
 * Rules here are deliberately conservative. Blocking findings are reserved for
 * cases where the product's entire value is the interaction (a utility or a
 * game with no interactive element at all). Everything else is a warning that
 * still reaches the repair prompt but never holds a turn hostage.
 */

import type { Prd } from "./prd-types";
import type { PrdFinding } from "./prd-acceptance.server";

interface FileLike {
  path: string;
  content: string;
}

const INTERACTIVE =
  /(useState|useReducer|useForm|onSubmit=|onChange=|onClick=\{(?!\(\)\s*=>\s*\{\s*\}\))|<form\b|<input\b|<select\b|<textarea\b)/;

/** A handler that exists only to satisfy the type checker. */
const DEAD_HANDLER = /on[A-Z]\w+=\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\}/g;
const DEAD_LINK = /href=["']#["']/g;
const PLACEHOLDER_COPY =
  /(lorem ipsum|coming soon|todo:|tbd\b|placeholder text|your text here|replace this)/i;

function appFiles(files: FileLike[]): FileLike[] {
  return files.filter((f) => /^src\/.+\.(tsx|jsx)$/.test(f.path));
}

/**
 * Deterministic usefulness checks over the emitted files.
 * Returns findings in the same shape the PRD gate already understands.
 */
export function checkProductUsefulness(prd: Prd, files: FileLike[]): PrdFinding[] {
  const findings: PrdFinding[] = [];
  const views = appFiles(files);
  if (!views.length) return findings;

  const joined = views.map((f) => f.content).join("\n");

  // 1. The product's value IS the interaction — it must exist.
  const interactionIsTheProduct = prd.productType === "utility" || prd.productType === "game";
  if (interactionIsTheProduct && !INTERACTIVE.test(joined)) {
    findings.push({
      criterionId: "primary-workflow-completes",
      severity: "blocking",
      message: `${prd.productName} is a ${prd.productType}: the whole product is the interaction, but nothing in the build accepts input or holds state.`,
      repairHint: `Build the "${prd.primaryWorkflow.name}" workflow for real: labelled inputs bound to React state on the home page, and a result region that renders the computed outcome (${prd.primaryOutcome}).`,
    });
  }

  // 2. Controls wired to nothing.
  const deadHandlers = (joined.match(DEAD_HANDLER) ?? []).length;
  const deadLinks = (joined.match(DEAD_LINK) ?? []).length;
  if (deadHandlers + deadLinks >= 3) {
    findings.push({
      criterionId: "controls-do-something",
      severity: "warning",
      message: `${deadHandlers + deadLinks} controls are wired to nothing (empty handlers or href="#").`,
      repairHint:
        "Give every control real behaviour: navigate with the router, mutate state, or submit the form. Remove any control that has no purpose.",
    });
  }

  // 3. Placeholder copy standing in for the product's actual content.
  if (PLACEHOLDER_COPY.test(joined)) {
    findings.push({
      criterionId: "real-content",
      severity: "warning",
      message: "The build contains placeholder copy where real product content belongs.",
      repairHint: `Write specific copy for ${prd.productName} (${prd.purpose}). Never ship lorem ipsum, "coming soon", or TODO text.`,
    });
  }

  // 4. The primary outcome should be visible somewhere in the UI, not only
  //    computed. Cheap keyword evidence — warning only.
  if (prd.formulas.length) {
    const rendersResult = /(result|outcome|total|due|score|estimate|summary)/i.test(joined);
    if (!rendersResult) {
      findings.push({
        criterionId: "result-rendered",
        severity: "warning",
        message: "No result region is rendered, so the calculation never reaches the user.",
        repairHint: "Render the computed outcome in a clearly labelled result area next to the inputs.",
      });
    }
  }

  return findings;
}
