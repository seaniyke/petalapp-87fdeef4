/**
 * Client helper for /api/visitors. Returns the latest visitor + pageview
 * counts for a project's published Cloudflare Pages site.
 *
 * The endpoint soft-fails on Cloudflare outages — when `unavailable` is
 * true, the UI should render a dash rather than a zero so we don't lie
 * about empty traffic.
 */
import { supabase } from "@/integrations/supabase/client";

export type VisitorRange = "24h" | "7d" | "30d";

export type VisitorStatsResult = {
  visitors: number;
  pageviews: number;
  range: VisitorRange;
  since: string | null;
  until: string | null;
  /** Cloudflare analytics call failed — treat counts as unknown. */
  unavailable: boolean;
  /** Project hasn't been published yet, so there's no traffic to fetch. */
  neverPublished?: boolean;
  /** Human-readable error if `unavailable` is true. */
  error?: string;
};

export async function fetchProjectVisitors(input: {
  projectId: string;
  range?: VisitorRange;
  signal?: AbortSignal;
}): Promise<VisitorStatsResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const params = new URLSearchParams({ projectId: input.projectId });
  if (input.range) params.set("range", input.range);

  const resp = await fetch(`/api/visitors?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: input.signal,
  });

  let payload: unknown = null;
  try {
    payload = await resp.json();
  } catch {
    /* fall through */
  }

  if (!resp.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Visitors fetch failed (${resp.status})`;
    throw new Error(message);
  }

  return payload as VisitorStatsResult;
}
