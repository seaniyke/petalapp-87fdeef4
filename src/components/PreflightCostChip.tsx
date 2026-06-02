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
import { estimatePromptCostFn } from "@/lib/preflight-estimate.functions";
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

function makeTimeout(ms: number): Promise<PreflightEstimate> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error("estimate timed out")), ms);
  });
}

type Props = {
  prompt: string;
  /** Don't fire while the user is busy generating. */
  disabled?: boolean;
  className?: string;
};

// Module-level cache so re-mounts don't re-fetch the same prompt.
const cache = new Map<string, PreflightEstimate>();

function localEstimate(prompt: string): PreflightEstimate {
  const len = prompt.trim().length;
  const kind: PreflightKind = /\b(database|auth|signup|login|stripe|webhook|api|backend)\b/i.test(
    prompt,
  )
    ? "backend_change"
    : /\b(image|illustration|photo|visual)\b/i.test(prompt)
      ? "image_generation"
      : /\b(refactor|rewrite|clean up)\b/i.test(prompt)
        ? "refactor"
        : len > 240 || /\b(feature|page|dashboard|admin)\b/i.test(prompt)
          ? "feature"
          : /\b(component|card|button|section|footer|header)\b/i.test(prompt)
            ? "new_component"
            : "ui_tweak";
  const base =
    kind === "backend_change"
      ? { sec: 35, cents: 6 }
      : kind === "image_generation"
        ? { sec: 12, cents: 4 }
        : kind === "refactor"
          ? { sec: 30, cents: 5 }
          : kind === "feature"
            ? { sec: 45, cents: 8 }
            : kind === "new_component"
              ? { sec: 18, cents: 3 }
              : { sec: 8, cents: 1 };
  const boost = Math.min(2, Math.floor(len / 200));
  return {
    kind,
    estSeconds: base.sec + boost * 5,
    estCents: base.cents + boost,
    confidence: "low",
    rationale: "Estimated locally because live estimate was unavailable.",
  };
}

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
      setLoading(false);
      return;
    }
    lastRequest.current = trimmed;
    setLoading(true);
    setEstimate(null);
    const timer = setTimeout(async () => {
      try {
        const result = await Promise.race([
          estimateFn({ data: { prompt: trimmed } }),
          makeTimeout(3500),
        ]);
        // Drop late responses if the prompt has changed
        if (lastRequest.current !== trimmed) return;
        cache.set(trimmed, result);
        setEstimate(result);
      } catch (e) {
        console.warn("[preflight] estimate failed", e);
        const fallback = localEstimate(trimmed);
        cache.set(trimmed, fallback);
        setEstimate(fallback);
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
