/**
 * Integration registry — the single source of truth for the marketplace.
 *
 * Adding a new integration is a one-liner: import its definition file and
 * append it to INTEGRATIONS. The installer, the API routes, and the
 * marketplace UI all read from here.
 *
 * Definitions intentionally live in separate files (one per integration) so
 * each can grow scaffolded files independently without bloating one giant
 * registry file.
 */
import type { IntegrationDefinition } from "./types";
import { resendIntegration } from "./resend.integration";
import { plausibleIntegration } from "./plausible.integration";
import { stripeIntegration } from "./stripe.integration";
import { paystackIntegration } from "./paystack.integration";
import { flutterwaveIntegration } from "./flutterwave.integration";

export const INTEGRATIONS: IntegrationDefinition[] = [
  resendIntegration,
  plausibleIntegration,
  stripeIntegration,
  paystackIntegration,
  flutterwaveIntegration,
  // TODO follow-up: posthog, openai, pwa
];

export function getIntegration(code: string): IntegrationDefinition | null {
  return INTEGRATIONS.find((i) => i.code === code) ?? null;
}

/** Public catalog for the marketplace UI. Excludes the `files` / `migration`
 * functions so we never accidentally ship server-side code to the client. */
export type IntegrationCatalogEntry = {
  code: string;
  name: string;
  tagline: string;
  category: string;
  docsUrl?: string;
  requiresBackend: boolean;
  fields: IntegrationDefinition["fields"];
  /** Surfaced so the marketplace UI can mirror AI auto-suggestions. */
  triggers?: string[];
  replaces?: string[];
};

export function publicCatalog(): IntegrationCatalogEntry[] {
  return INTEGRATIONS.map((i) => ({
    code: i.code,
    name: i.name,
    tagline: i.tagline,
    category: i.category,
    docsUrl: i.docsUrl,
    requiresBackend: i.requiresBackend ?? false,
    fields: i.fields,
    triggers: i.triggers,
    replaces: i.replaces,
  }));
}
