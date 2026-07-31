/**
 * Server functions powering Admin → Builder (one-click Railway redeploy).
 *
 * Talks to Railway's public GraphQL API (https://backboard.railway.com/graphql/v2)
 * with an account token stored as RAILWAY_API_TOKEN. The service/environment
 * ids come from RAILWAY_BUILDER_SERVICE_ID / RAILWAY_BUILDER_ENVIRONMENT_ID.
 *
 * `serviceInstanceRedeploy` rebuilds from the latest source (our Dockerfile),
 * which is exactly what "Redeploy" in the Railway dashboard does.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

export type BuilderDeployment = {
  id: string;
  status: string;
  createdAt: string;
  url: string | null;
};

export type BuilderDeployStatus = {
  unauthorized?: true;
  configured: boolean;
  missing: string[];
  builderUrl: string | null;
  deployments: BuilderDeployment[];
  error?: string;
};

async function assertAdmin(userId: string) {
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  return !!isAdmin;
}

function readConfig() {
  const token = process.env.RAILWAY_API_TOKEN ?? "";
  const serviceId = process.env.RAILWAY_BUILDER_SERVICE_ID ?? "";
  const environmentId = process.env.RAILWAY_BUILDER_ENVIRONMENT_ID ?? "";
  const missing: string[] = [];
  if (!token) missing.push("RAILWAY_API_TOKEN");
  if (!serviceId) missing.push("RAILWAY_BUILDER_SERVICE_ID");
  if (!environmentId) missing.push("RAILWAY_BUILDER_ENVIRONMENT_ID");
  return { token, serviceId, environmentId, missing };
}

async function railway<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; errors?: { message: string }[] }
    | null;
  if (!res.ok || !json) {
    throw new Error(`Railway API returned ${res.status}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data as T;
}

const DEPLOYMENTS_QUERY = `
  query BuilderDeployments($serviceId: String!, $environmentId: String!) {
    deployments(
      first: 5
      input: { serviceId: $serviceId, environmentId: $environmentId }
    ) {
      edges {
        node { id status createdAt staticUrl url }
      }
    }
  }
`;

const REDEPLOY_MUTATION = `
  mutation RedeployBuilder($serviceId: String!, $environmentId: String!) {
    serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
  }
`;

type DeploymentsResult = {
  deployments: {
    edges: {
      node: {
        id: string;
        status: string;
        createdAt: string;
        staticUrl: string | null;
        url: string | null;
      };
    }[];
  };
};

export const getBuilderDeployStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BuilderDeployStatus> => {
    if (!(await assertAdmin(context.userId))) {
      return {
        unauthorized: true,
        configured: false,
        missing: [],
        builderUrl: null,
        deployments: [],
      };
    }

    const { token, serviceId, environmentId, missing } = readConfig();
    const builderUrl = process.env.BUILDER_URL ?? null;
    if (missing.length) {
      return { configured: false, missing, builderUrl, deployments: [] };
    }

    try {
      const data = await railway<DeploymentsResult>(token, DEPLOYMENTS_QUERY, {
        serviceId,
        environmentId,
      });
      const deployments = (data.deployments?.edges ?? []).map(({ node }) => ({
        id: node.id,
        status: node.status,
        createdAt: node.createdAt,
        url: node.staticUrl ? `https://${node.staticUrl}` : node.url,
      }));
      return { configured: true, missing: [], builderUrl, deployments };
    } catch (err) {
      return {
        configured: true,
        missing: [],
        builderUrl,
        deployments: [],
        error: err instanceof Error ? err.message : "Unknown Railway error",
      };
    }
  });

export const redeployBuilder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await assertAdmin(context.userId))) {
      return { ok: false, error: "Not authorized" };
    }
    const { token, serviceId, environmentId, missing } = readConfig();
    if (missing.length) {
      return { ok: false, error: `Missing configuration: ${missing.join(", ")}` };
    }
    try {
      await railway(token, REDEPLOY_MUTATION, { serviceId, environmentId });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown Railway error",
      };
    }
  });

export type BuilderHealth = {
  unauthorized?: true;
  reachable: boolean;
  status?: number;
  body?: string;
  error?: string;
};

/** Pings the deployed builder so admins can confirm the new image is live. */
export const checkBuilderHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BuilderHealth> => {
    if (!(await assertAdmin(context.userId))) {
      return { unauthorized: true, reachable: false };
    }
    const base = process.env.BUILDER_URL;
    if (!base) return { reachable: false, error: "BUILDER_URL is not set" };
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/healthz`, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.text().catch(() => "")).slice(0, 300);
      return { reachable: res.ok, status: res.status, body };
    } catch (err) {
      return {
        reachable: false,
        error: err instanceof Error ? err.message : "Unreachable",
      };
    }
  });
