/**
 * THE provider policy. The only code in Kimble that decides which OpenRouter
 * upstream serves an AI call. Every call — first build, continuation,
 * missing page, retry, recovery, repair, design — resolves here via
 * `aiChatCompletions`, so there is no second routing system.
 *
 * Rules:
 *  - Code-writing calls: primaries (OpenInference → Azure) first; last-resort
 *    upstreams (DeepInfra) only once every primary has failed in this turn.
 *  - Upstreams that failed in this turn (stall / empty / error) are excluded
 *    for every later call in the turn, whatever path makes it.
 *  - DigitalOcean / NextBit are never used for code.
 *  - Non-code calls only inherit the failed-upstream exclusions.
 */
import {
  CODEGEN_LAST_RESORT_PROVIDERS,
  CODEGEN_PRIMARY_PROVIDERS,
  CODEGEN_PROVIDER_IGNORE,
  CODEGEN_PROVIDER_ORDER,
} from "@/lib/ai-model-config";

export function slug(upstream: string): string {
  return upstream.toLowerCase().replace(/\s+/g, "");
}

export function codegenProviderRouting(avoid: string[] = []): Record<string, unknown> {
  const ignoreSet = new Set<string>([...CODEGEN_PROVIDER_IGNORE, ...avoid.map(slug)]);
  const primariesLeft = CODEGEN_PRIMARY_PROVIDERS.some((p) => !ignoreSet.has(p));
  if (primariesLeft) for (const p of CODEGEN_LAST_RESORT_PROVIDERS) ignoreSet.add(p);
  const ignore = Array.from(ignoreSet);
  const order = CODEGEN_PROVIDER_ORDER.filter((p) => !ignore.includes(p));
  return { order, allow_fallbacks: true, require_parameters: true, ignore };
}

/** Resolve the OpenRouter `provider` block for one call (or undefined). */
export function resolveProviderRouting(args: {
  codeWriting: boolean;
  avoid: string[];
}): Record<string, unknown> | undefined {
  const avoid = Array.from(new Set(args.avoid.map(slug)));
  if (args.codeWriting) return codegenProviderRouting(avoid);
  if (avoid.length) return { ignore: avoid };
  return undefined;
}
