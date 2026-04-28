/**
 * PreflightCostChip — small inline cost+time estimate next to the composer.
 *
 * Petal differentiator: Lovable, Bolt, v0 and Replit all leave you guessing
 * how much your next prompt will burn. This chip debounces user input and
 * shows a friendly "~$0.04 · ~12s · UI tweak" before they hit send.
 *
 * Usage:
 *   <PreflightCostChip prompt={input} />
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { estimatePromptCostFn } from "@/server/preflight-estimate.functions";
import type { PreflightEstimate, PreflightKind } from "@/server/preflight-estimate.server";

const KIND_LABEL: Record<PreflightKind, string> = {
  ui_tweak: "UI tweak",
  new_component: "New component",
  feature: "Feature",
  backend_change: "Backend change",
  image_generation: "Image",
  refactor: "Refactor",
  discussion: "Chat",
};

function formatCents(c: number): string {
  if (c <= 0) return "free";
  if (c < 1) return "<$0.01";
  return `~$${(c / 100).toFixed(2)}`;
}

function formatSeconds(s: number): string {
  if (s <= 0) return "instant";
  if (s < 60) return `~${s}s`;
  return `~${Math.round(s / 60)}m`;
}

type Props = {
  prompt: string;
  /** Don't fire while the user is busy generating. */
  disabled?: boolean;
  className?: string;
};

// Module-level cache so re-mounts don't re-fetch the same prompt.
const cache = new Map<string, PreflightEstimate>();

export function PreflightCostChip({ prompt, disabled, className }: Props) {
  const [estimate, setEstimate] = useState<PreflightEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const lastRequest = useRef<string>("");
  const estimateFn = useServerFn(estimatePromptCostFn);

  useEffect(() => {
    const trimmed = prompt.trim();
    if (disabled) {
      setEstimate(null);
      return;
    }
    if (trimmed.length < 8) {
      setEstimate(null);
      return;
    }
    const cached = cache.get(trimmed);
    if (cached) {
      setEstimate(cached);
      return;
    }
    lastRequest.current = trimmed;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await estimateFn({ data: { prompt: trimmed } });
        // Drop late responses if the prompt has changed
        if (lastRequest.current !== trimmed) return;
        cache.set(trimmed, result);
        setEstimate(result);
      } catch (e) {
        console.warn("[preflight] estimate failed", e);
        setEstimate(null);
      } finally {
        if (lastRequest.current === trimmed) setLoading(false);
      }
    }, 700); // debounce typing
    return () => clearTimeout(timer);
  }, [prompt, disabled, estimateFn]);

  if (disabled) return null;
  if (!estimate && !loading) return null;

  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition",
        className ?? "",
      ].join(" ")}
      title={estimate?.rationale}
    >
      {loading || !estimate ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Estimating…</span>
        </>
      ) : (
        <>
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="font-medium text-foreground">{formatCents(estimate.estCents)}</span>
          <span aria-hidden>·</span>
          <span>{formatSeconds(estimate.estSeconds)}</span>
          <span aria-hidden>·</span>
          <span>{KIND_LABEL[estimate.kind]}</span>
        </>
      )}
    </div>
  );
}
