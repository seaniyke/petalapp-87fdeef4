/**
 * THE provider policy. The only code in Kimble that decides how an AI call
 * is routed. Every call resolves here via `aiChatCompletions`, so there is
 * no second routing system.
 *
 * Rules:
 *  - The Lovable AI Gateway is the only gateway and owns provider selection
 *    + failover for the selected model. Kimble does NOT maintain an
 *    allow-list and does not send an upstream `provider` routing block —
 *    the gateway has no such concept.
 *  - An empty allow-list is never sent: see `isEmptyAllowList` (defensive;
 *    kept so a stale caller-supplied routing block still fails closed).
 */

export function slug(upstream: string): string {
  return upstream.toLowerCase().replace(/\s+/g, "");
}

/**
 * Resolve the upstream routing block for one call. The Lovable AI Gateway
 * owns upstream selection, so this is always undefined — the request carries
 * no `provider` field.
 */
export function resolveProviderRouting(_args: {
  codeWriting: boolean;
  avoid: string[];
  hasTools?: boolean;
}): Record<string, unknown> | undefined {
  return undefined;
}

/** Defensive: a routing block that names an allow-list with nobody on it
 *  can never be served. It must fail as `providers_exhausted`, not be sent. */
export function isEmptyAllowList(routing: unknown): boolean {
  const only = (routing as { only?: unknown } | undefined)?.only;
  return Array.isArray(only) && only.length === 0;
}
