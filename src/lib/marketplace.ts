/**
 * Petal Marketplace — client data layer (Phase 1: listing foundation).
 *
 * Everything here talks to real tables/RPCs:
 *   - `marketplace_licenses`  — fixed license catalog (personal/commercial/extended)
 *   - `marketplace_listings`  — creator products, RLS-scoped to the creator
 *   - `marketplace_list_live` / `marketplace_get_live` — public discovery
 *   - `marketplace_open_listing` — server-side delivery: copies the frozen
 *     file snapshot into a NEW project owned by the signed-in user.
 *
 * A listing points at a FROZEN snapshot of the project's files taken at
 * publish time, never the live project. The creator keeps building on the
 * original; buyers get exactly what was reviewed.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ListingRow = Database["public"]["Tables"]["marketplace_listings"]["Row"];
export type LicenseRow = Database["public"]["Tables"]["marketplace_licenses"]["Row"];

export type PublicListing = {
  id: string;
  slug: string;
  title: string;
  pitch: string;
  description?: string;
  category: string;
  cover_url: string | null;
  screenshots: string[];
  demo_url: string | null;
  price_minor: number;
  currency_code: string;
  license_code: string;
  open_count: number;
  file_count: number;
  published_at: string | null;
  creator_id: string;
};

export const LISTING_CATEGORIES = [
  "app",
  "saas",
  "website",
  "landing-page",
  "mobile",
  "dashboard",
  "business",
  "starter",
  "template",
] as const;

export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

function rpc(name: string, args: Record<string, unknown>): Promise<any> {
  return (supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<any> })
    .rpc(name, args);
}

/** Human price. Free listings say "Free" rather than "$0.00". */
export function formatListingPrice(priceMinor: number, currency = "USD"): string {
  if (!priceMinor) return "Free";
  const amount = priceMinor / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function listingSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "product"}-${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Public discovery                                                    */
/* ------------------------------------------------------------------ */

export async function listLiveListings(): Promise<PublicListing[]> {
  const { data, error } = await rpc("marketplace_list_live", {});
  if (error) throw error;
  return (data ?? []) as PublicListing[];
}

export async function getLiveListing(slug: string): Promise<PublicListing | null> {
  const { data, error } = await rpc("marketplace_get_live", { p_slug: slug });
  if (error) throw error;
  const rows = (data ?? []) as PublicListing[];
  return rows[0] ?? null;
}

export async function listLicenses(): Promise<LicenseRow[]> {
  const { data, error } = await supabase
    .from("marketplace_licenses")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Has the signed-in user already bought this product? */
export async function ownsListing(slug: string): Promise<boolean> {
  const { data, error } = await rpc("marketplace_owns_listing", { p_slug: slug });
  if (error) return false;
  return Boolean(data);
}

/** Start a hosted card checkout for a paid listing. Returns the URL to send
 *  the buyer to. Pricing, ownership and availability are re-checked server-side. */
export async function startListingCheckout(
  slug: string,
  currency = "USD",
): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in required");

  const res = await fetch("/api/billing/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      purpose: "marketplace",
      itemCode: slug,
      currency,
      returnUrl: `${window.location.origin}/marketplace/${slug}`,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || "Could not start checkout";
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* plain-text error */
    }
    throw new Error(message);
  }
  const json = (await res.json()) as { authorizationUrl?: string };
  if (!json.authorizationUrl) throw new Error("No checkout URL returned");
  return json.authorizationUrl;
}

/** Products I've bought. */
export async function listMyPurchases(): Promise<
  Database["public"]["Tables"]["marketplace_purchases"]["Row"][]
> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("marketplace_purchases")
    .select("*")
    .eq("buyer_id", userData.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Sales of my products, newest first. */
export async function listMySales(): Promise<
  Database["public"]["Tables"]["marketplace_purchases"]["Row"][]
> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("marketplace_purchases")
    .select("*")
    .eq("creator_id", userData.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Buy-free path: copy the frozen snapshot into a new project I own. */
export async function openListingInPetal(slug: string): Promise<string> {
  const { data, error } = await rpc("marketplace_open_listing", { p_slug: slug });
  if (error) throw error;
  return data as string;
}

/* ------------------------------------------------------------------ */
/* Creator side                                                        */
/* ------------------------------------------------------------------ */

export async function listMyListings(): Promise<ListingRow[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("creator_id", userData.user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type CreateListingInput = {
  projectId: string;
  title: string;
  pitch: string;
  description?: string;
  category: string;
  licenseCode: string;
  /** USD cents. 0 = free. */
  priceMinor?: number;
  demoUrl?: string | null;
  coverUrl?: string | null;
};

/**
 * Freeze the project's current files into a new draft listing.
 * The creator's project is untouched.
 */
export async function createListingFromProject(input: CreateListingInput): Promise<ListingRow> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Not signed in");

  const { data: files, error: filesErr } = await supabase
    .from("project_files")
    .select("path, content")
    .eq("project_id", input.projectId);
  if (filesErr) throw filesErr;
  if (!files || files.length === 0) {
    throw new Error("This project has no files yet — build something first.");
  }

  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      creator_id: user.id,
      project_id: input.projectId,
      slug: listingSlug(input.title),
      title: input.title,
      pitch: input.pitch,
      description: input.description ?? "",
      category: input.category,
      license_code: input.licenseCode,
      price_minor: Math.max(0, Math.round(input.priceMinor ?? 0)),
      demo_url: input.demoUrl ?? null,
      cover_url: input.coverUrl ?? null,
      source_files: files as unknown as Database["public"]["Tables"]["marketplace_listings"]["Insert"]["source_files"],
      file_count: files.length,
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Re-freeze a listing against the project's latest files. */
export async function refreshListingSnapshot(listingId: string, projectId: string): Promise<ListingRow> {
  const { data: files, error: filesErr } = await supabase
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId);
  if (filesErr) throw filesErr;

  const { data, error } = await supabase
    .from("marketplace_listings")
    .update({
      source_files: (files ?? []) as never,
      file_count: files?.length ?? 0,
    })
    .eq("id", listingId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateListing(
  id: string,
  patch: Partial<
    Pick<
      ListingRow,
      | "title"
      | "pitch"
      | "description"
      | "category"
      | "license_code"
      | "demo_url"
      | "cover_url"
      | "status"
      | "price_minor"
    >
  >,
): Promise<ListingRow> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function submitListingForReview(id: string): Promise<ListingRow> {
  return updateListing(id, { status: "in_review" });
}

export async function deleteListing(id: string): Promise<void> {
  const { error } = await supabase.from("marketplace_listings").delete().eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Admin review                                                        */
/* ------------------------------------------------------------------ */

/** Admin: every listing awaiting a decision, plus what's already live. */
export async function listListingsForReview(): Promise<ListingRow[]> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*")
    .in("status", ["in_review", "live", "rejected", "delisted"])
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function decideListing(
  id: string,
  decision: "live" | "rejected" | "delisted",
  note?: string,
): Promise<ListingRow> {
  const patch: Database["public"]["Tables"]["marketplace_listings"]["Update"] = {
    status: decision,
    review_note: note ?? null,
    ...(decision === "live" ? { published_at: new Date().toISOString() } : {}),
  };
  const { data, error } = await supabase
    .from("marketplace_listings")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------ */
/* Phase 3 — creator earnings + payouts                                */
/* ------------------------------------------------------------------ */

export type EarningRow = Database["public"]["Tables"]["marketplace_earnings"]["Row"];
export type PayoutRow = Database["public"]["Tables"]["marketplace_payouts"]["Row"];

export type CreatorSummary = {
  sales_count: number;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  available_cents: number;
  requested_cents: number;
  paid_cents: number;
  min_payout_cents: number;
  payouts_enabled: boolean;
};

const EMPTY_SUMMARY: CreatorSummary = {
  sales_count: 0,
  gross_cents: 0,
  commission_cents: 0,
  net_cents: 0,
  available_cents: 0,
  requested_cents: 0,
  paid_cents: 0,
  min_payout_cents: 5000,
  payouts_enabled: false,
};

/** Lifetime earnings, plus what is payable right now. */
export async function getCreatorSummary(): Promise<CreatorSummary> {
  const { data, error } = await rpc("marketplace_creator_summary", {});
  if (error) throw error;
  const row = (data ?? [])[0] as Partial<CreatorSummary> | undefined;
  if (!row) return EMPTY_SUMMARY;
  return {
    ...EMPTY_SUMMARY,
    ...row,
    sales_count: Number(row.sales_count ?? 0),
    gross_cents: Number(row.gross_cents ?? 0),
    commission_cents: Number(row.commission_cents ?? 0),
    net_cents: Number(row.net_cents ?? 0),
    available_cents: Number(row.available_cents ?? 0),
    requested_cents: Number(row.requested_cents ?? 0),
    paid_cents: Number(row.paid_cents ?? 0),
    min_payout_cents: Number(row.min_payout_cents ?? 5000),
    payouts_enabled: Boolean(row.payouts_enabled),
  };
}

export async function listMyEarnings(): Promise<EarningRow[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("marketplace_earnings")
    .select("*")
    .eq("creator_id", userData.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listMyPayouts(): Promise<PayoutRow[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("marketplace_payouts")
    .select("*")
    .eq("creator_id", userData.user.id)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type PayoutMethod = "bank" | "paystack" | "crypto";

/** Requests a payout of the whole available balance. */
export async function requestPayout(method: PayoutMethod, destination: string): Promise<string> {
  const { data, error } = await rpc("marketplace_request_payout", {
    p_method: method,
    p_destination: destination,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelPayout(id: string): Promise<void> {
  const { error } = await rpc("marketplace_cancel_payout", { p_id: id });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Phase 4 — reviews + admin economy controls                          */
/* ------------------------------------------------------------------ */

export type PublicReview = {
  id: string;
  rating: number;
  body: string;
  created_at: string;
  reviewer_name: string;
  reviewer_avatar: string | null;
};

export async function listReviews(slug: string): Promise<PublicReview[]> {
  const { data, error } = await rpc("marketplace_list_reviews", { p_slug: slug });
  if (error) throw error;
  return (data ?? []) as PublicReview[];
}

export async function submitReview(slug: string, rating: number, body: string): Promise<void> {
  const { error } = await rpc("marketplace_submit_review", {
    p_slug: slug,
    p_rating: rating,
    p_body: body,
  });
  if (error) throw error;
}

export type MarketplaceConfig = {
  commission_bps: number;
  min_payout_cents: number;
  payouts_enabled: boolean;
};

export async function getMarketplaceConfig(): Promise<MarketplaceConfig> {
  const { data, error } = await supabase
    .from("marketplace_config")
    .select("commission_bps, min_payout_cents, payouts_enabled")
    .maybeSingle();
  if (error) throw error;
  return {
    commission_bps: Number(data?.commission_bps ?? 2000),
    min_payout_cents: Number(data?.min_payout_cents ?? 5000),
    payouts_enabled: Boolean(data?.payouts_enabled),
  };
}

export async function adminSetConfig(cfg: MarketplaceConfig): Promise<void> {
  const { error } = await rpc("marketplace_admin_set_config", {
    p_commission_bps: cfg.commission_bps,
    p_min_payout_cents: cfg.min_payout_cents,
    p_payouts_enabled: cfg.payouts_enabled,
  });
  if (error) throw error;
}

export type AdminPayoutRow = {
  id: string;
  creator_id: string;
  creator_email: string | null;
  amount_cents: number;
  method: string;
  destination: string;
  status: string;
  admin_note: string | null;
  requested_at: string;
  decided_at: string | null;
  paid_at: string | null;
};

export async function adminListPayouts(status?: string): Promise<AdminPayoutRow[]> {
  const { data, error } = await rpc("marketplace_admin_list_payouts", {
    p_status: status ?? null,
  });
  if (error) throw error;
  return (data ?? []) as AdminPayoutRow[];
}

export async function adminDecidePayout(
  id: string,
  decision: "approved" | "paid" | "rejected",
  note?: string,
): Promise<void> {
  const { error } = await rpc("marketplace_admin_decide_payout", {
    p_id: id,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw error;
}
