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
import { sanitizeVerificationDefects } from "@/lib/verification-report";

export type BuildSnapshot = {
  /** The row this snapshot came from. Status/timers must never leak between
   * retries, because every retry creates a new build row. */
  buildId: string;
  /** Includes 'building' (Railway picked up the job, not yet finished) so the
   *  UI can advance the activity card past "deploying" without getting stuck.
   *  The DB-level status check constraint allows the same four values. */
  status: "pending" | "building" | "ready" | "failed";
  distPath: string | null;
  errorMessage: string | null;
  /** When the build row was first observed by this client. Used to escalate
   *  copy ("almost there", "taking longer", "still working") and to surface
   *  a friendly "deploy stalled" card after a long wait — independent of the
   *  server-side reaper which only kicks in after 20 minutes. */
  observedAt: number;
  /** Post-deploy browser check: null when the build predates verification or
   *  the run was skipped. `defects` is already human-readable. */
  verification: { ok: boolean; defects: string[]; skipped?: string } | null;
};

/** Narrow the jsonb column without trusting its shape. */
function readVerification(raw: unknown): BuildSnapshot["verification"] {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { ok?: unknown; defects?: unknown; skipped?: unknown };
  if (typeof v.ok !== "boolean") return null;
  return {
    // Recompute `ok` after sanitizing. Older builder deployments could label
    // their own DOM-probe exception as an app defect; that must not launch an
    // auto-fix loop or show an error card when no real defect remains.
    ok: v.ok || sanitizeVerificationDefects(v.defects).length === 0,
    defects: sanitizeVerificationDefects(v.defects),
    ...(typeof v.skipped === "string" ? { skipped: v.skipped } : {}),
  };
}

export function useBuildActivity(latestBuildId: string | null): BuildSnapshot | null {
  const [snap, setSnap] = useState<BuildSnapshot | null>(null);

  useEffect(() => {
    if (!latestBuildId) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    let terminalSince: number | null = null;
    let latestStatus: BuildSnapshot["status"] = "pending";
    const startedAt = Date.now();
    let watchdogPokedAt = 0;

    // Never expose an all-null frame while a new row is loading. Background
    // build-id changes do not always set the builder's `awaitingBuild` bridge,
    // so nulling here briefly rendered idle/success UI between two builds.
    // Switch atomically to an honest pending snapshot for the new build.
    setSnap((prev) =>
      prev?.buildId === latestBuildId
        ? prev
        : {
            buildId: latestBuildId,
            status: "pending",
            distPath: null,
            errorMessage: null,
            observedAt: Date.now(),
            verification: null,
          },
    );

    const pokeWatchdog = async () => {
      // Throttle: at most once every 60s per build to avoid hammering.
      if (Date.now() - watchdogPokedAt < 60_000) return;
      watchdogPokedAt = Date.now();
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) return;
        await fetch("/api/builds/watchdog", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ buildId: latestBuildId }),
        });
      } catch (e) {
        console.warn("[useBuildActivity] watchdog poke failed", e);
      }
    };

    const apply = (data: {
      status: string | null;
      dist_path: string | null;
      error_message: string | null;
      created_at?: string | null;
      verification?: unknown;
    }, buildId = latestBuildId) => {
      if (cancelled) return;
      setSnap((prev) => {
        const sameBuild = prev?.buildId === buildId;
        const createdAt = data.created_at ? new Date(data.created_at).getTime() : NaN;
        const next: BuildSnapshot = {
          buildId,
          status: (data.status as BuildSnapshot["status"]) ?? "pending",
          distPath: data.dist_path ?? null,
          errorMessage: data.error_message ?? null,
          // Preserve the very first observation timestamp across updates so
          // the long-wait escalation timer is stable for the whole deploy.
          observedAt:
            sameBuild && prev
              ? prev.observedAt
              : Number.isFinite(createdAt)
                ? createdAt
                : Date.now(),
          verification: readVerification(data.verification),
        };
        if (next.status === "ready" || next.status === "failed") {
          if (terminalSince == null) terminalSince = Date.now();
        }
        latestStatus = next.status;
        // Avoid pointless re-renders when polling returns identical rows.
        if (
          sameBuild && prev &&
          prev.status === next.status &&
          prev.distPath === next.distPath &&
          prev.errorMessage === next.errorMessage &&
          (prev.verification?.defects.length ?? -1) === (next.verification?.defects.length ?? -1)
        ) {
          return prev;
        }
        return next;
      });
    };

    const BUILD_COLUMNS = "status, dist_path, error_message, verification, created_at";

    const fetchOnce = async () => {
      const { data } = await supabase
        .from("project_builds")
        .select(BUILD_COLUMNS)
        .eq("id", latestBuildId)
        .maybeSingle();
      if (data) apply(data);
    };

    const fetchProjectLatestBuild = async () => {
      const { data: current } = await supabase
        .from("project_builds")
        .select("project_id")
        .eq("id", latestBuildId)
        .maybeSingle();
      if (!current?.project_id) return;
      const { data: project } = await supabase
        .from("projects")
        .select("latest_build_id")
        .eq("id", current.project_id)
        .maybeSingle();
      const newestId = project?.latest_build_id;
      if (!newestId || newestId === latestBuildId) return;
      const { data: latest } = await supabase
        .from("project_builds")
        .select(BUILD_COLUMNS)
        .eq("id", newestId)
        .maybeSingle();
      if (latest) apply(latest, newestId);
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
      if (elapsed > 15_000 && terminalSince == null) void fetchProjectLatestBuild();
      // If an active build has not completed after ~90s, poke the watchdog.
      // This includes `building`: a successful deploy with a dropped callback
      // otherwise remains stranded forever.
      if (
        elapsed > 90_000 &&
        terminalSince == null &&
        (latestStatus === "pending" || latestStatus === "building")
      ) {
        void pokeWatchdog();
      }
    }, 4_000);

    // Catch-up handlers: iOS suspends background tabs and silently kills WS.
    // visibilitychange + focus + online all fire within milliseconds of each
    // other when a phone unlocks, so coalesce them into one catch-up fetch.
    let lastAlive = 0;
    const onAlive = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAlive < 3000) return;
      lastAlive = now;
      void fetchOnce();
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
