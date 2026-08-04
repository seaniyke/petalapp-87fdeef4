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
      setUrl(id ? `${dist}${dist.includes("?") ? "&" : "?"}v=${encodeURIComponent(id)}` : dist);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return url;
}
