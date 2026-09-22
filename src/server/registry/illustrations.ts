/**
 * Illustration intelligence.
 *
 * Not every app wants photography. This is the vocabulary for the other
 * options — and, more importantly, the rule for WHEN a drawing beats a
 * photograph, so the model stops defaulting to stock-photo everything.
 *
 * Pure data + string building. No I/O.
 */

import { type ResourceMeta, retrieve } from "./registry-types";

export interface IllustrationRecord extends ResourceMeta {
  kind: "illustration";
  /** How it is produced in the build. */
  technique: "svg" | "css" | "generated-image" | "screenshot-mock";
  /** One-line rule for when this beats a photograph. */
  useWhen: string;
}

export const ILLUSTRATIONS: readonly IllustrationRecord[] = [
  {
    id: "product-mockup",
    kind: "illustration",
    label: "Product mockup",
    technique: "css",
    description: "The real interface inside a browser or phone frame, built with markup — not a picture of one.",
    useWhen: "The product itself is the proof: software, dashboards, mobile apps.",
    tags: ["saas", "app", "dashboard", "developer", "startup", "product"],
  },
  {
    id: "flow-diagram",
    kind: "illustration",
    label: "Flow diagram",
    technique: "svg",
    description: "Labelled steps or nodes showing how something moves through a system.",
    useWhen: "The value is a process, integration or pipeline that a photo cannot show.",
    tags: ["infrastructure", "logistics", "fintech", "api", "developer", "process"],
  },
  {
    id: "data-viz",
    kind: "illustration",
    label: "Data figure",
    technique: "svg",
    description: "A chart or metric drawn from realistic sample figures, never a screenshot of one.",
    useWhen: "Numbers, results or performance are the argument.",
    tags: ["analytics", "fintech", "data", "dashboard", "research"],
  },
  {
    id: "spot-illustration",
    kind: "illustration",
    label: "Spot illustration",
    technique: "generated-image",
    description: "Small flat vector-style drawings supporting a feature or empty state.",
    useWhen: "The subject is abstract — security, savings, wellbeing — and stock photos would look fake.",
    tags: ["consumer", "education", "health", "nonprofit", "abstract", "empty-state"],
  },
  {
    id: "abstract-graphic",
    kind: "illustration",
    label: "Abstract graphic",
    technique: "css",
    description: "Geometric shapes, orbits or gradients rendered in markup as a hero backdrop.",
    useWhen: "There is no honest photograph and the brand is technical or futuristic.",
    tags: ["ai", "crypto", "infrastructure", "startup", "modern"],
  },
  {
    id: "technical-drawing",
    kind: "illustration",
    label: "Technical drawing",
    technique: "svg",
    description: "Line-art of a machine, part, floor plan or anatomy, annotated with labels.",
    useWhen: "Precision matters more than atmosphere: engineering, medical, architecture.",
    tags: ["industrial", "medical", "architecture", "engineering", "manufacturing"],
  },
  {
    id: "map-figure",
    kind: "illustration",
    label: "Map figure",
    technique: "svg",
    description: "A simplified map or coverage area with marked points.",
    useWhen: "Place, coverage or delivery area is the point.",
    tags: ["logistics", "travel", "realestate", "delivery", "local"],
  },
  {
    id: "photography",
    kind: "illustration",
    label: "Photography (default)",
    technique: "generated-image",
    description: "A real-looking photograph of the actual subject, place, food, product or people.",
    useWhen: "The thing being sold is physical or human — food, property, events, services, retail.",
    tags: ["restaurant", "hospitality", "realestate", "retail", "fitness", "events", "people", "physical"],
  },
];

export function pickIllustrations(briefTags: string[], briefText = "", limit = 3): IllustrationRecord[] {
  return retrieve(ILLUSTRATIONS, briefTags, limit, briefText);
}

/**
 * Prompt block: the few approaches that fit this brief, plus the honest
 * rule about which one to reach for. Short on purpose.
 */
export function renderIllustrationBlock(briefTags: string[], briefText = ""): string {
  const picks = pickIllustrations(briefTags, briefText, 3);
  if (!picks.length) return "";
  const lines = picks.map((p) => `- ${p.label} (${p.technique}): ${p.description} Use when: ${p.useWhen}`);
  return [
    ``,
    `[Imagery approach — choose per section, not once for the whole page]`,
    ...lines,
    `Rules: a photograph must show the real subject — never a stock person pointing at a screen. If the product is software, show the interface built in markup rather than a photo of a laptop. If the idea is abstract, draw it; do not fake a photo of it. Decorative imagery never carries meaning that the text does not also state, and every meaningful image gets real alt text.`,
  ].join("\n");
}
