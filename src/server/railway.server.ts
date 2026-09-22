/**
 * Railway GraphQL client — shared.
 *
 * Two separate uses in Kimble:
 *   1. Admin → Builder: redeploy Kimble's own build service
 *      (`src/lib/admin-builder-deploy.functions.ts`).
 *   2. Kimble Compute: per-project containers for apps that need a real
 *      server (`src/server/compute.server.ts`).
 *
 * Everything here is thin and server-only. No Kimble business logic lives in
 * this module — it just speaks Railway.
 */

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

export type RailwayConfig = {
  token: string;
  /** Railway project that hosts every customer compute service. */
  projectId: string;
  environmentId: string;
  missing: string[];
};

/** Config for the Kimble Compute pool (separate from the builder service). */
export function readComputeConfig(): RailwayConfig {
  const token = process.env["RAILWAY_API_TOKEN"] ?? "";
  const projectId = process.env["RAILWAY_COMPUTE_PROJECT_ID"] ?? "";
  const environmentId = process.env["RAILWAY_COMPUTE_ENVIRONMENT_ID"] ?? "";
  const missing: string[] = [];
  if (!token) missing.push("RAILWAY_API_TOKEN");
  if (!projectId) missing.push("RAILWAY_COMPUTE_PROJECT_ID");
  if (!environmentId) missing.push("RAILWAY_COMPUTE_ENVIRONMENT_ID");
  return { token, projectId, environmentId, missing };
}

export async function railwayGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; errors?: { message: string }[] }
    | null;
  if (!res.ok || !json) throw new Error(`Railway API returned ${res.status}`);
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

const CREATE_SERVICE = `
  mutation KimbleComputeCreate($input: ServiceCreateInput!) {
    serviceCreate(input: $input) { id name }
  }
`;

const UPSERT_VARIABLES = `
  mutation KimbleComputeVars($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }
`;

const REDEPLOY = `
  mutation KimbleComputeRedeploy($serviceId: String!, $environmentId: String!) {
    serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
  }
`;

const DELETE_SERVICE = `
  mutation KimbleComputeDelete($id: String!) {
    serviceDelete(id: $id)
  }
`;

const DOMAIN_CREATE = `
  mutation KimbleComputeDomain($input: ServiceDomainCreateInput!) {
    serviceDomainCreate(input: $input) { domain }
  }
`;

const SERVICE_STATUS = `
  query KimbleComputeStatus($serviceId: String!, $environmentId: String!) {
    deployments(first: 1, input: { serviceId: $serviceId, environmentId: $environmentId }) {
      edges { node { id status createdAt staticUrl url } }
    }
  }
`;

export type RailwayService = { id: string; name: string };

export async function createService(
  cfg: RailwayConfig,
  name: string,
  source: { image?: string; repo?: string },
): Promise<RailwayService> {
  const data = await railwayGraphql<{ serviceCreate: RailwayService }>(cfg.token, CREATE_SERVICE, {
    input: {
      projectId: cfg.projectId,
      environmentId: cfg.environmentId,
      name,
      source,
    },
  });
  return data.serviceCreate;
}

export async function setServiceVariables(
  cfg: RailwayConfig,
  serviceId: string,
  variables: Record<string, string>,
): Promise<void> {
  if (!Object.keys(variables).length) return;
  await railwayGraphql(cfg.token, UPSERT_VARIABLES, {
    input: {
      projectId: cfg.projectId,
      environmentId: cfg.environmentId,
      serviceId,
      variables,
    },
  });
}

export async function redeployService(cfg: RailwayConfig, serviceId: string): Promise<void> {
  await railwayGraphql(cfg.token, REDEPLOY, {
    serviceId,
    environmentId: cfg.environmentId,
  });
}

export async function deleteService(cfg: RailwayConfig, serviceId: string): Promise<void> {
  await railwayGraphql(cfg.token, DELETE_SERVICE, { id: serviceId });
}

export async function createServiceDomain(
  cfg: RailwayConfig,
  serviceId: string,
): Promise<string | null> {
  try {
    const data = await railwayGraphql<{ serviceDomainCreate: { domain: string } }>(
      cfg.token,
      DOMAIN_CREATE,
      { input: { serviceId, environmentId: cfg.environmentId } },
    );
    const domain = data.serviceDomainCreate?.domain;
    return domain ? `https://${domain}` : null;
  } catch (err) {
    console.warn("[railway] domain create failed", err);
    return null;
  }
}

export type RailwayDeployment = {
  id: string;
  status: string;
  createdAt: string;
  url: string | null;
};

export async function latestDeployment(
  cfg: RailwayConfig,
  serviceId: string,
): Promise<RailwayDeployment | null> {
  const data = await railwayGraphql<{
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
  }>(cfg.token, SERVICE_STATUS, { serviceId, environmentId: cfg.environmentId });
  const node = data.deployments?.edges?.[0]?.node;
  if (!node) return null;
  return {
    id: node.id,
    status: node.status,
    createdAt: node.createdAt,
    url: node.staticUrl ? `https://${node.staticUrl}` : node.url,
  };
}
