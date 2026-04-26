/**
 * Subscribes to a project's `latest_build_id` row and exposes its status
 * in a shape the BuildActivityCard understands.
 *
 * This is what bridges the two halves of the user's wait:
 *   1) AI generation (handled by streamGenerate in the builder route)
 *   2) Cloudflare Pages deploy (handled here)
 *
 * The two together feel like one continuous action.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BuildSnapshot = {
  status: "pending" | "ready" | "failed";
  distPath: string | null;
  errorMessage: string | null;
};

export function useBuildActivity(latestBuildId: string | null): BuildSnapshot | null {
  const [snap, setSnap] = useState<BuildSnapshot | null>(null);

  useEffect(() => {
    if (!latestBuildId) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("project_builds")
      .select("status, dist_path, error_message")
      .eq("id", latestBuildId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSnap({
          status: (data.status as BuildSnapshot["status"]) ?? "pending",
          distPath: data.dist_path ?? null,
          errorMessage: data.error_message ?? null,
        });
      });

    const channel = supabase
      .channel(`build-activity:${latestBuildId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "project_builds",
          filter: `id=eq.${latestBuildId}`,
        },
        (payload) => {
          const next = payload.new as {
            status: string;
            dist_path: string | null;
            error_message: string | null;
          };
          setSnap({
            status: (next.status as BuildSnapshot["status"]) ?? "pending",
            distPath: next.dist_path ?? null,
            errorMessage: next.error_message ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [latestBuildId]);

  return snap;
}
