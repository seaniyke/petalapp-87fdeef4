/**
 * Project Intelligence Context (PIC) — the canonical understanding of a project.
 *
 * Kimble already knew things about a project, but it knew them in three
 * unrelated places: the PRD (`project_blueprints.blueprint.prd`), the
 * blueprint/architecture (same column, sibling keys) and project memory
 * (key/value rows). Nothing assembled them, so every stage re-derived —
 * and drifted from — what the product actually is.
 *
 * PIC is that assembly. It is:
 *  - canonical: every planning stage reads it, every stage may amend it,
 *  - versioned: one row per project plus an append-only history,
 *  - additive: the existing stores keep working and write through to it,
 *  - fail-open: a missing or broken PIC degrades to today's pipeline.
 *
 * Pure types. No I/O.
 */

import type { Prd } from "@/server/prd/prd-types";
import type { BuildTargetId } from "@/lib/build-targets";

/** How sure Kimble is about a decision it made on the user's behalf. */
export type Confidence = "confident" | "inferred" | "uncertain";

export interface PicDecision {
  /** Short stable key, e.g. "platform", "auth", "nav-pattern". */
  key: string;
  /** The decision, in one sentence. */
  value: string;
  confidence: Confidence;
  /** Why Kimble decided this. */
  rationale?: string;
  /** Turn that made the decision. */
  turnId?: string;
  at?: string;
}

/** Which experiences the product needs. A SaaS usually needs both. */
export interface PicSurfaces {
  /** Public marketing/landing experience. */
  marketing: boolean;
  /** The authenticated/working product itself. */
  application: boolean;
  /** Admin/back-office surface. */
  admin: boolean;
}

/** The semantic reading of what the user asked for. */
export interface PicUnderstanding {
  /** One sentence: what is being built. */
  summary: string;
  /** e.g. "saas", "marketplace", "fintech", "landing-page", "utility", "api". */
  productType: string;
  /** Human domain, e.g. "school administration". */
  domain: string;
  targetUsers: string[];
  userProblem: string;
  platforms: BuildTargetId[];
  surfaces: PicSurfaces;
  needsBackend: boolean;
  needsAuth: boolean;
  needsDatabase: boolean;
  needsPayments: boolean;
  needsRealtime: boolean;
  needsStorage: boolean;
  needsScheduledJobs: boolean;
  needsExternalApis: boolean;
  roles: string[];
  /** What the first usable version must contain. */
  firstVersion: string[];
  /** Anything explicitly out of scope. */
  outOfScope: string[];
  /** Per-field confidence for the decisions that change architecture. */
  confidence: Record<string, Confidence>;
  /** True when a clarification would materially change the architecture. */
  needsClarification: boolean;
  clarifyingQuestion?: string;
  /** "model" when the semantic pass ran, "deterministic" on fallback. */
  source: "model" | "deterministic";
}

/* ------------------------------------------------------------------ */
/* Design system contract                                              */
/* ------------------------------------------------------------------ */

export interface PicTypography {
  displayFont: string;
  bodyFont: string;
  /** Optional mono for data/code-heavy products. */
  monoFont?: string;
  /** rem values, largest first: display, h1, h2, h3, body, small. */
  scale: { display: string; h1: string; h2: string; h3: string; body: string; small: string };
  lineHeights: { tight: string; normal: string; relaxed: string };
  letterSpacing: { display: string; body: string };
  headingWeight: number;
  bodyWeight: number;
}

export interface PicColorRole {
  /** CSS color value in the project's token format (oklch preferred). */
  light: string;
  /** Dark-mode value. Falls back to the light value when unthemed. */
  dark: string;
}

export interface PicColorSystem {
  background: PicColorRole;
  foreground: PicColorRole;
  primary: PicColorRole;
  primaryForeground: PicColorRole;
  secondary: PicColorRole;
  accent: PicColorRole;
  muted: PicColorRole;
  mutedForeground: PicColorRole;
  card: PicColorRole;
  border: PicColorRole;
  destructive: PicColorRole;
  success: PicColorRole;
  warning: PicColorRole;
  /** Default mode the product ships in. */
  defaultMode: "light" | "dark";
}

export type NavPattern = "top-nav" | "sidebar" | "tabs" | "bottom-tabs" | "rail";

export interface PicComponentRules {
  buttons: string;
  inputs: string;
  cards: string;
  navigation: string;
  tables: string;
  modals: string;
  badges: string;
  alerts: string;
  emptyStates: string;
  loadingStates: string;
  errorStates: string;
}

export interface PicDesignSystem {
  /** Named visual direction, e.g. "warm editorial fintech". */
  direction: string;
  /** Why this direction fits this product. */
  rationale: string;
  typography: PicTypography;
  colors: PicColorSystem;
  /** Base spacing unit in px; the scale is multiples of it. */
  spacingBase: number;
  radius: { sm: string; md: string; lg: string; full: string };
  shadows: { sm: string; md: string; lg: string };
  surfaces: string;
  density: "compact" | "comfortable" | "spacious";
  navPattern: NavPattern;
  mobileNav: "bottom-tabs" | "drawer" | "top-collapse";
  breakpoints: { sm: number; md: number; lg: number; xl: number };
  motion: { level: "none" | "subtle" | "expressive"; principles: string };
  imagery: string;
  iconography: string;
  accessibility: string;
  components: PicComponentRules;
  /** "model" when the design agent reasoned, "deterministic" on fallback. */
  source: "model" | "deterministic";
}

/* ------------------------------------------------------------------ */
/* Architecture                                                        */
/* ------------------------------------------------------------------ */

export interface PicArchitecture {
  frontend: string;
  backend: string;
  routes: string[];
  screens: string[];
  entities: Array<{ name: string; fields?: string[]; notes?: string }>;
  integrations: string[];
  environment: string[];
  deployment: string;
}

export interface PicSecurity {
  authentication: string;
  authorization: string;
  roles: string[];
  rules: string[];
}

/* ------------------------------------------------------------------ */
/* The context itself                                                  */
/* ------------------------------------------------------------------ */

export interface ProjectIntelligenceContext {
  /** Schema version, so readers can upgrade old rows. */
  schema: 1;
  projectId: string | null;
  productVision: string;
  understanding: PicUnderstanding;
  prd: Prd | null;
  userJourneys: string[];
  features: string[];
  uxDecisions: string[];
  design: PicDesignSystem | null;
  architecture: PicArchitecture | null;
  security: PicSecurity | null;
  acceptanceCriteria: string[];
  /** Decisions Kimble made, with confidence. Newest last. */
  decisions: PicDecision[];
  /** Decisions the user locked in ("keep the sidebar", "always Paystack"). */
  protectedDecisions: string[];
  /** Paths the pipeline must not rewrite without an explicit request. */
  protectedFiles: string[];
  /** Open questions Kimble chose not to ask. */
  unresolved: string[];
  /** One line per turn: what changed. Capped. */
  history: Array<{ at: string; turnId?: string; summary: string }>;
  updatedAt: string;
  revision: number;
}

export interface VersionedPic {
  pic: ProjectIntelligenceContext;
  revision: number;
  updatedAt: string;
}

export const PIC_HISTORY_CAP = 40;
