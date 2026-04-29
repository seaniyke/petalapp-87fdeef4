/**
 * Shared types for the Integrations Marketplace.
 *
 * Each integration is a small, declarative object: which fields to collect
 * from the user, which files to write into the project, and (optionally) which
 * SQL to run on the project's managed backend. The installer in
 * `installer.server.ts` walks this object — it doesn't care which integration
 * it is. That's how we add new ones without touching the pipeline.
 */
import type { ProjectFile } from "@/server/generate.server";

export type IntegrationFieldKind = "string" | "secret" | "url" | "domain";

export type IntegrationField = {
  /** Stable identifier; becomes the JSON key in the credential store. */
  id: string;
  /** Human-readable label shown in the install dialog. */
  label: string;
  /** Description shown under the label. */
  description?: string;
  /** Placeholder text in the input. */
  placeholder?: string;
  /**
   * `secret` fields are stored encrypted and NEVER returned to the client.
   * `string`/`url`/`domain` may be returned to the client (treated as
   * non-sensitive configuration).
   */
  kind: IntegrationFieldKind;
  /** When true, the installer rejects empty input. Defaults to true. */
  required?: boolean;
  /** Optional Zod-style validation regex. */
  pattern?: RegExp;
  /** Custom validation error if `pattern` doesn't match. */
  patternError?: string;
};

export type IntegrationCredentials = Record<string, string>;

export type IntegrationFileSpec = {
  /** Path inside the generated app, e.g. `src/integrations/resend/send.ts`. */
  path: string;
  content: string;
};

export type IntegrationContext = {
  /** Public values (non-secret fields). Safe to inline in client code. */
  publicValues: IntegrationCredentials;
  /** Secret values. Only inline these in server-only files. */
  secretValues: IntegrationCredentials;
  /**
   * The project's attached managed backend, if any. Lets integrations write
   * SQL (subscriptions table, etc.) only when there's a backend to write to.
   */
  backend: { url: string; anonKey: string } | null;
};

export type IntegrationDefinition = {
  /** Stable identifier. Used as the row key in `project_integrations`. */
  code: string;
  /** Display name. */
  name: string;
  /** Short tagline shown on the marketplace card. */
  tagline: string;
  /** Category badge: "Payments" | "Email" | "Analytics" | "AI" | etc. */
  category: string;
  /** Optional homepage / docs link. */
  docsUrl?: string;
  /**
   * Whether the integration requires a managed backend (for SQL migrations).
   * If true and the project has no backend, the install dialog tells the user
   * to attach one first.
   */
  requiresBackend?: boolean;
  /** Fields the user must fill in. */
  fields: IntegrationField[];
  /**
   * Renders the files to write into the project. Pure function — the
   * installer handles persistence and merge.
   */
  files: (ctx: IntegrationContext) => IntegrationFileSpec[];
  /** Optional SQL to run on the project's managed backend at install time. */
  migration?: (ctx: IntegrationContext) => string | null;
  /** Optional one-paragraph chat message appended after install succeeds. */
  postInstallMessage?: (ctx: IntegrationContext) => string;
  /**
   * Optional guidance string injected into the AI system prompt whenever
   * this integration is installed on the project. Should be SHORT and
   * PRESCRIPTIVE: tell Petal which helper to import, where to call it from
   * (server route vs component), what NOT to do (e.g. don't hardcode keys,
   * don't call the third-party API directly). This is what makes the AI
   * actually use the integration the user installed instead of reinventing
   * it. Receives the same context as `files()` so it can reference the
   * configured domain, default from-address, etc.
   */
  aiGuidance?: (ctx: IntegrationContext) => string;
  /**
   * Trigger phrases that hint the user wants this capability. Used by the
   * auto-suggest classifier to recommend installing this integration before
   * the AI hand-rolls the same feature. Keep these short, lowercase, and
   * specific (e.g. "send email", "subscription billing").
   */
  triggers?: string[];
  /**
   * Packages or APIs this integration replaces. Surfaced in the prompt so
   * Petal stops reaching for raw SDKs when a managed helper exists. Examples:
   * `nodemailer`, `stripe`, `@paystack/inline-js`.
   */
  replaces?: string[];
};

export type ProjectIntegrationRow = {
  id: string;
  project_id: string;
  integration_code: string;
  version: string;
  options: Record<string, unknown>;
  /** Paths the installer wrote — used for clean uninstall. */
  file_manifest: string[];
  installed_at: string;
};

/** Discriminated payload used by the install API. */
export type InstallRequest = {
  projectId: string;
  integrationCode: string;
  fields: IntegrationCredentials;
};

/** What the client sees back after install (no secrets). */
export type InstalledIntegrationView = {
  code: string;
  installedAt: string;
  publicValues: IntegrationCredentials;
};

/** Convert a ProjectFile (from generate.server) into a manifest entry. */
export function projectFileFromSpec(spec: IntegrationFileSpec): ProjectFile {
  return { path: spec.path, content: spec.content };
}
