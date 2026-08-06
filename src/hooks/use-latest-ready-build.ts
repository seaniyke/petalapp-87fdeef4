import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { probePreviewUrl } from "@/lib/preview-probe.functions";
import type { PreviewRefusalReason } from "@/lib/preview-state";


/**
 * Returns the URL of the most recent *ready* deployed build for a project.
 *
 * This powers the "instant preview" — the moment a project is opened we can
 * show the last deployed version (served from the CDN, no boot time) while the
 * WebContainer sandbox warms up in the background. Mirrors how Lovable shows a
 * live app immediately on project open.
 */
export type LatestReadyBuild = {
  /** Embeddable deployed URL, or null when there's nothing frameable. */
  url: string | null;
  /** C3 — set when a deployment exists but the probe says we can't frame it. */
  refusedUrl: string | null;
  refusedReason: PreviewRefusalReason | null;
};

const EMPTY: LatestReadyBuild = { url: null, refusedUrl: null, refusedReason: null };

export function useLatestReadyBuild(projectId: string | null | undefined): LatestReadyBuild {
  const [state, setState] = useState<LatestReadyBuild>(EMPTY);

  useEffect(() => {
    if (!projectId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("project_builds")
        .select("id, dist_path, ready_at")
        .eq("project_id", projectId)
        .eq("status", "ready")
        .not("dist_path", "is", null)
        .order("ready_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const dist = (data as { dist_path?: string | null } | null)?.dist_path ?? null;
      const id = (data as { id?: string } | null)?.id;
      if (!dist) {
        setState(EMPTY);
        return;
      }
      // Reachability probe — a deployment row can exist while the CDN host
      // is gone/not yet propagated, or the host may refuse framing
      // ("refused to connect" inside the iframe). A browser no-cors fetch
      // can't tell those apart (opaque response), so we probe server-side
      // where we can read the status code and the framing headers.
      //
      // C3: we now keep the verdict's reason instead of collapsing every
      // failure to `null`, so the preview can explain itself and offer
      // "Open in new tab" rather than showing an empty pane.
      try {
        const verdict = await probePreviewUrl({ data: { url: dist } });
        if (cancelled) return;
        if (!verdict.embeddable) {
          setState({ url: null, refusedUrl: dist, refusedReason: verdict.reason ?? "unreachable" });
          return;
        }
      } catch {
        if (!cancelled) setState({ url: null, refusedUrl: dist, refusedReason: "unreachable" });
        return;
      }
      if (cancelled) return;
      setState({
        url: id ? `${dist}${dist.includes("?") ? "&" : "?"}v=${encodeURIComponent(id)}` : dist,
        refusedUrl: null,
        refusedReason: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return state;
}

/** Back-compat thin wrapper for callers that only need the embeddable URL. */
export function useLatestReadyBuildUrl(projectId: string | null | undefined): string | null {
  return useLatestReadyBuild(projectId).url;
}
