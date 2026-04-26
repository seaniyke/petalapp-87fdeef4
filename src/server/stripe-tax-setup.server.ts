/**
 * One-time setup: assign Stripe tax codes to the catalog so end-to-end
 * compliance handling works on every checkout. SaaS plans use the
 * "electronic services" code; top-up packs use "general digital goods".
 *
 * Re-running is safe — Stripe accepts the same tax_code on update.
 */
import { createStripeClient, type StripeEnv } from "./stripe.server";

const TAX_CODE_SAAS = "txcd_10103001"; // Software as a service (general)
const TAX_CODE_DIGITAL = "txcd_10000000"; // Digital goods - general

const PRODUCT_TAX_CODES: Record<string, string> = {
  plan_pro: TAX_CODE_SAAS,
  plan_business: TAX_CODE_SAAS,
  pack_50: TAX_CODE_DIGITAL,
  pack_200: TAX_CODE_DIGITAL,
  pack_1000: TAX_CODE_DIGITAL,
};

export async function applyTaxCodes(env: StripeEnv): Promise<void> {
  const stripe = createStripeClient(env);
  for (const [externalId, taxCode] of Object.entries(PRODUCT_TAX_CODES)) {
    // Resolve our human-readable product id to the Stripe product id via
    // the lovable_external_id metadata that batch_create_product writes.
    const search = await stripe.products.search({
      query: `metadata['lovable_external_id']:'${externalId}'`,
      limit: 1,
    });
    const product = search.data[0];
    if (!product) {
      console.warn(`[stripe-tax-setup] product not found: ${externalId}`);
      continue;
    }
    await stripe.products.update(product.id, { tax_code: taxCode });
  }
}
