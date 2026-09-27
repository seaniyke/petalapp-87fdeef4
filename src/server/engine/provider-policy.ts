/**
 * THE provider policy. The only code in Kimble that decides how OpenRouter
 * routes an AI call. Every call resolves here via `aiChatCompletions`, so
 * there is no second routing system.
 *
 * Rules:
 *  - OpenRouter is the only gateway and owns provider selection + failover
 *    for the selected model (native routing, `allow_fallbacks`). Kimble does
 *    NOT maintain an allow-list (`only`/`order`).
 *  - Code-writing calls require every parameter (tools must be honoured).
 *  - Providers Kimble has determined are bad are excluded with `ignore`
 *    (DigitalOcean / NextBit for code), plus upstreams that already failed
 *    in this turn.
 *  - An empty allow-list is never sent: see `isEmptyAllowList`.
 */
import { CODEGEN_PROVIDER_IGNORE, codegenPreferredMinTps } from "@/lib/ai-model-config";

export function slug(upstream: string): string {
  return upstream.toLowerCase().replace(/\s+/g, "");
}

export function codegenProviderRouting(avoid: string[] = []): Record<string, unknown> {
  const ignore = Array.from(new Set<string>([...CODEGEN_PROVIDER_IGNORE, ...avoid.map(slug)]));
  const tps = codegenPreferredMinTps();
  return { allow_fallbacks: true, require_parameters: true, ignore, ...(tps ? { preferred_min_throughput: { p50: tps } } : {}) };
}

/** Resolve the OpenRouter `provider` block for one call (or undefined).
 *  `avoid` is the per-turn failed set, read once by aiChatCompletions. */
export function resolveProviderRouting(args: {
  codeWriting: boolean;
  avoid: string[];
  /** Any tool call must come back schema-exact (NextBit re-serializes args). */
  hasTools?: boolean;
}): Record<string, unknown> | undefined {
  const avoid = Array.from(new Set(args.avoid.map(slug)));
  if (args.codeWriting) return codegenProviderRouting(avoid);
  if (args.hasTools) {
    return { require_parameters: true, ignore: Array.from(new Set(["nextbit", ...avoid])) };
  }
  if (avoid.length) return { ignore: avoid };
  return undefined;
}

/** Defensive: a routing block that names an allow-list with nobody on it
 *  can never be served. It must fail as `providers_exhausted`, not be sent. */
export function isEmptyAllowList(routing: unknown): boolean {
  const only = (routing as { only?: unknown } | undefined)?.only;
  return Array.isArray(only) && only.length === 0;
}
