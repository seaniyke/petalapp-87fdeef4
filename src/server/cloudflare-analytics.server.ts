/**
 * Cloudflare GraphQL Analytics — visitor counts for a Pages project.
 *
 * Used by /api/visitors (the Publish sheet visitor count). We query
 * `pagesProjectAnalyticsAdaptiveGroups`, which is the per-Pages-project,
 * account-scoped dataset that returns aggregated visits/pageviews per day.
 *
 * Why this dataset (not zone-level httpRequests1dGroups):
 *   The `*.pages.dev` hostname lives on a Cloudflare-managed zone we don't
 *   own, so we can't query it by zone. Custom domains attached via
 *   Cloudflare-for-SaaS *do* live on our zone, but to stay consistent across
 *   both surfaces we always count traffic at the Pages project level. That
 *   matches what the user actually published.
 *
 * Cost / latency: one GraphQL POST per call. We cache the resolved account
 * id in module scope (it never changes) so subsequent calls only do the
 * analytics query.
 *
 * Required env: `CLOUDFLARE_API_TOKEN` with the
 *   "Account → Account Analytics → Read" permission. The token used for
 *   Cloudflare-for-SaaS already qualifies in our setup.
 */

const CF_API = "https://api.cloudflare.com/client/v4";
const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

type Range = "24h" | "7d" | "30d";

export type VisitorStats = {
  /** Unique visitors over the requested window. */
  visitors: number;
  /** Total pageviews over the requested window. */
  pageviews: number;
  /** The window we actually queried, echoed back for the client. */
  range: Range;
  /** ISO timestamps for the window we queried — for debugging / display. */
  since: string;
  until: string;
};

let cachedAccountId: string | null = null;
let cachedAccountAt = 0;
const ACCOUNT_TTL_MS = 60 * 60 * 1000; // 1h

function getToken(): string {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error("CLOUDFLARE_API_TOKEN not configured");
  }
  return token;
}

/**
 * Resolve the Cloudflare account ID that owns this token. We cache it for
 * an hour because it never changes — but we do refresh occasionally so a
 * token rotation onto a different account doesn't strand us forever.
 */
async function getAccountId(): Promise<string> {
  if (cachedAccountId && Date.now() - cachedAccountAt < ACCOUNT_TTL_MS) {
    return cachedAccountId;
  }
  const explicit = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (explicit) {
    cachedAccountId = explicit;
    cachedAccountAt = Date.now();
    return explicit;
  }
  const res = await fetch(`${CF_API}/accounts`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; result?: Array<{ id: string }>; errors?: Array<{ message: string }> }
    | null;
  if (!res.ok || !json?.success || !json.result?.[0]?.id) {
    const msg = json?.errors?.map((e) => e.message).join("; ") ||
      `Cloudflare /accounts error (${res.status})`;
    throw new Error(msg);
  }
  cachedAccountId = json.result[0].id;
  cachedAccountAt = Date.now();
  return cachedAccountId;
}

function rangeToWindow(range: Range): { since: Date; until: Date } {
  const until = new Date();
  const since = new Date(until);
  if (range === "24h") since.setUTCHours(since.getUTCHours() - 24);
  else if (range === "7d") since.setUTCDate(since.getUTCDate() - 7);
  else since.setUTCDate(since.getUTCDate() - 30);
  return { since, until };
}

/**
 * Query Cloudflare for the visits/pageviews of a single Pages project.
 *
 * Returns zeros when:
 *   - The Pages project has no traffic in the window.
 *   - Cloudflare returns a known "no data" shape.
 *
 * Throws when the API call itself fails (auth, network, schema mismatch).
 * Callers should treat thrown errors as soft failures (e.g. show "—" in
 * the UI) — analytics being temporarily unavailable shouldn't block the
 * Publish sheet.
 */
export async function getPagesProjectVisitors(
  pagesProjectName: string,
  range: Range = "7d",
): Promise<VisitorStats> {
  const accountId = await getAccountId();
  const { since, until } = rangeToWindow(range);

  // pagesProjectAnalyticsAdaptiveGroups is the documented dataset for
  // per-Pages-project, account-scoped traffic. Filter by projectName +
  // datetime window, sum visits and pageViews.
  // Docs: https://developers.cloudflare.com/analytics/graphql-api/
  const query = /* GraphQL */ `
    query Visitors($accountTag: string!, $projectName: string!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          pagesProjectAnalyticsAdaptiveGroups(
            limit: 1
            filter: {
              projectName: $projectName
              datetime_geq: $since
              datetime_leq: $until
            }
          ) {
            sum {
              requests
              pageViews
              visits
            }
          }
        }
      }
    }
  `;

  const res = await fetch(CF_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: accountId,
        projectName: pagesProjectName,
        since: since.toISOString(),
        until: until.toISOString(),
      },
    }),
  });

  type GqlResp = {
    data?: {
      viewer?: {
        accounts?: Array<{
          pagesProjectAnalyticsAdaptiveGroups?: Array<{
            sum?: {
              requests?: number;
              pageViews?: number;
              visits?: number;
            };
          }>;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const json = (await res.json().catch(() => null)) as GqlResp | null;
  if (!res.ok) {
    throw new Error(
      `Cloudflare analytics HTTP ${res.status}` +
        (json?.errors?.length ? `: ${json.errors.map((e) => e.message).join("; ")}` : ""),
    );
  }
  if (json?.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const sum =
    json?.data?.viewer?.accounts?.[0]?.pagesProjectAnalyticsAdaptiveGroups?.[0]?.sum;

  return {
    visitors: Math.max(0, Math.floor(sum?.visits ?? 0)),
    pageviews: Math.max(0, Math.floor(sum?.pageViews ?? 0)),
    range,
    since: since.toISOString(),
    until: until.toISOString(),
  };
}

export const VISITOR_RANGES: readonly Range[] = ["24h", "7d", "30d"] as const;
export type VisitorRange = Range;
