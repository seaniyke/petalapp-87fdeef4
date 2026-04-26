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

    const apply = (data: {
      status: string | null;
      dist_path: string | null;
      error_message: string | null;
    }) => {
      if (cancelled) return;
      setSnap((prev) => {
        const next: BuildSnapshot = {
          status: (data.status as BuildSnapshot["status"]) ?? "pending",
          distPath: data.dist_path ?? null,
          errorMessage: data.error_message ?? null,
        };
        // Avoid pointless re-renders when polling returns identical rows.
        if (
          prev &&
          prev.status === next.status &&
          prev.distPath === next.distPath &&
          prev.errorMessage === next.errorMessage
        ) {
          return prev;
        }
        return next;
      });
    };

    const fetchOnce = async () => {
      const { data } = await supabase
        .from("project_builds")
        .select("status, dist_path, error_message")
        .eq("id", latestBuildId)
        .maybeSingle();
      if (data) apply(data);
    };

    void fetchOnce();

    // Realtime is the primary signal; polling is a fallback for environments
    // where the websocket gets dropped (locked-down corporate networks, some
    // mobile browsers, sleeping tabs that just resumed). Stop polling once the
    // build reaches a terminal state to avoid hammering the DB.
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
        (payload) => apply(payload.new as Parameters<typeof apply>[0]),
      )
      .subscribe();

    const poll = window.setInterval(() => {
      // setSnap is a state setter; we read the latest via a functional check.
      // Skip the network call once we're terminal.
      setSnap((prev) => {
        if (prev?.status === "ready" || prev?.status === "failed") return prev;
        void fetchOnce();
        return prev;
      });
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [latestBuildId]);

  return snap;
}
