import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the URL of the most recent *ready* deployed build for a project.
 *
 * This powers the "instant preview" — the moment a project is opened we can
 * show the last deployed version (served from the CDN, no boot time) while the
 * WebContainer sandbox warms up in the background. Mirrors how Lovable shows a
 * live app immediately on project open.
 */
export function useLatestReadyBuildUrl(projectId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setUrl(null);
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
        setUrl(null);
        return;
      }
      // Reachability probe — a deployment row can exist while the CDN host
      // is gone/not yet propagated ("refused to connect" inside the iframe).
      // Only hand back a URL we can actually reach, otherwise the instant
      // preview shows a browser error page instead of the app.
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        await fetch(dist, { method: "GET", mode: "no-cors", signal: ctrl.signal, cache: "no-store" });
        clearTimeout(t);
      } catch {
        if (!cancelled) setUrl(null);
        return;
      }
      if (cancelled) return;
      setUrl(id ? `${dist}${dist.includes("?") ? "&" : "?"}v=${encodeURIComponent(id)}` : dist);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return url;
}
