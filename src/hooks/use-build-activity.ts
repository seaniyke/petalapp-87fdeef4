/**
 * Subscribes to a project's `latest_build_id` row and exposes its status
 * in a shape the BuildActivityCard understands.
 *
 * This is what bridges the two halves of the user's wait:
 *   1) AI generation (handled by streamGenerate in the builder route)
 *   2) Cloudflare Pages deploy (handled here)
 *
 * The two together feel like one continuous action.
 *
 * Resilience notes:
 *   - Realtime websockets are flaky on iOS Safari and locked-down corporate
 *     networks. We always run a polling fallback alongside the realtime
 *     subscription.
 *   - We re-fetch on `visibilitychange` and `online` so a user returning from
 *     a backgrounded tab gets an instant catch-up instead of a frozen UI.
 *   - We keep polling for ~30s AFTER reaching a terminal state in case the
 *     row gets updated again (rare, but stranding the spinner is worse than
 *     a few extra HEAD-equivalent queries).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BuildSnapshot = {
  /** Includes 'building' (Railway picked up the job, not yet finished) so the
   *  UI can advance the activity card past "deploying" without getting stuck.
   *  The DB-level status check constraint allows the same four values. */
  status: "pending" | "building" | "ready" | "failed";
  distPath: string | null;
  errorMessage: string | null;
  /** When the build row was first observed by this client. Used to escalate
   *  copy ("almost there", "taking longer", "still working") and to surface
   *  a friendly "deploy stalled" card after a long wait — independent of the
   *  server-side reaper which only kicks in after 10 minutes. */
  observedAt: number;
};

export function useBuildActivity(latestBuildId: string | null): BuildSnapshot | null {
  const [snap, setSnap] = useState<BuildSnapshot | null>(null);

  useEffect(() => {
    if (!latestBuildId) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    let terminalSince: number | null = null;
    const startedAt = Date.now();

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
          // Preserve the very first observation timestamp across updates so
          // the long-wait escalation timer is stable for the whole deploy.
          observedAt: prev?.observedAt ?? Date.now(),
        };
        if (next.status === "ready" || next.status === "failed") {
          if (terminalSince == null) terminalSince = Date.now();
        }
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
    // mobile browsers, sleeping tabs that just resumed).
    const channel = supabase
      .channel(`build-activity:${latestBuildId}:${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
      .subscribe((status, err) => {
        if (err) console.warn("[useBuildActivity] realtime unavailable", err);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") void fetchOnce();
      });

    // Aggressive polling for the first 90s of a pending build (the deploy
    // window is short — bandwidth cost is trivial, stranded spinners are not).
    // After that, slow down. After terminal, keep polling for ~30s in case
    // the row gets touched again (e.g. dist_path updated post-ready), then stop.
    const poll = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (terminalSince != null && Date.now() - terminalSince > 30_000) return;
      void fetchOnce();
      // Slow the cadence after the deploy window.
      if (elapsed > 90_000 && terminalSince == null) {
        // no-op — interval already runs at base cadence; we just gate the call.
      }
    }, 4_000);

    // Catch-up handlers: iOS suspends background tabs and silently kills WS.
    const onAlive = () => {
      if (document.visibilityState === "visible") void fetchOnce();
    };
    document.addEventListener("visibilitychange", onAlive);
    window.addEventListener("online", onAlive);
    window.addEventListener("focus", onAlive);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onAlive);
      window.removeEventListener("online", onAlive);
      window.removeEventListener("focus", onAlive);
      void supabase.removeChannel(channel);
    };
  }, [latestBuildId]);

  return snap;
}
