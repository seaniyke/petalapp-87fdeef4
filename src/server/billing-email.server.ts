/**
 * Server-side helper to fire a transactional billing email.
 *
 * Posts to our own /lovable/email/transactional/send route using the
 * BUILDER_SHARED_SECRET so the route trusts the call without a user JWT.
 * Fire-and-forget — never blocks the caller and never throws (a flaky
 * email must not break a Paystack webhook ack).
 *
 * Looks up the recipient email from auth.users by user_id so callers
 * never have to plumb the email through.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type SendArgs = {
  /** Origin to call back into ourselves with — derive from `request.url`. */
  origin: string;
  /** Template name registered in src/lib/email-templates/registry.ts. */
  templateName: string;
  /** Stable key so verify+webhook double-fire only sends one email. */
  idempotencyKey: string;
  /** User to look up the recipient email for. */
  userId: string;
  /** Props passed straight into the React Email component. */
  templateData: Record<string, unknown>;
};

export async function sendBillingEmail(args: SendArgs): Promise<void> {
  try {
    const secret = process.env.BUILDER_SHARED_SECRET;
    if (!secret) {
      console.warn("[billing-email] BUILDER_SHARED_SECRET not set — skipping send");
      return;
    }

    // Resolve the user's email via the admin auth API.
    const { data: u, error: uErr } = await supabaseAdmin.auth.admin.getUserById(args.userId);
    if (uErr || !u?.user?.email) {
      console.warn("[billing-email] could not resolve recipient", {
        userId: args.userId,
        error: uErr?.message,
      });
      return;
    }
    const recipientEmail = u.user.email;

    const url = new URL("/lovable/email/transactional/send", args.origin).toString();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-petal-internal-secret": secret,
      },
      body: JSON.stringify({
        templateName: args.templateName,
        recipientEmail,
        idempotencyKey: args.idempotencyKey,
        templateData: args.templateData,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn("[billing-email] send route returned non-2xx", {
        status: resp.status,
        body: body.slice(0, 200),
        templateName: args.templateName,
      });
    }
  } catch (e) {
    console.warn("[billing-email] send failed (non-fatal)", e);
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Display helpers — turn raw tx fields into friendly labels for the email.
 * ────────────────────────────────────────────────────────────────────── */

const PURPOSE_LABEL: Record<string, string> = {
  plan: "subscription",
  pack: "design credits",
  runtime_topup: "cloud top-up",
  addon: "add-on",
  domain_purchase: "domain registration",
};

/** Human-friendly item label, e.g. "Builder plan" or "$10.00 cloud top-up". */
export function billingItemLabel(args: {
  purpose: string;
  itemCode: string | null;
  usdAmountCents?: number | null;
}): string {
  const { purpose, itemCode, usdAmountCents } = args;

  // Plans / packs / addons: prefer the human-readable item code if it looks
  // like a slug ("builder", "starter-pack") — otherwise fall back to purpose.
  const slug = (itemCode ?? "").trim();
  const prettySlug = slug
    ? slug
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  if (purpose === "plan" && prettySlug) return `${prettySlug} plan`;
  if (purpose === "pack" && prettySlug) return `${prettySlug}`;
  if (purpose === "addon" && prettySlug) return prettySlug;

  if (purpose === "runtime_topup") {
    if (typeof usdAmountCents === "number" && usdAmountCents > 0) {
      return `$${(usdAmountCents / 100).toFixed(2)} cloud top-up`;
    }
    return "Cloud top-up";
  }

  return PURPOSE_LABEL[purpose] ?? "Payment";
}

/** Format an amount in minor units (e.g. kobo) into "₦12,345" or "$10.00". */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  const cur = (currency || "").toUpperCase();
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${cur}`;
  }
}
