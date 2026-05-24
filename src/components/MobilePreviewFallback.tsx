import { useEffect, useState } from "react";
import { Loader2, Sparkles, AlertCircle, RotateCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PreviewCrashFallback } from "@/components/PreviewCrashFallback";

type BuildStatus = "pending" | "building" | "ready" | "failed";

type BuildRow = {
  id: string;
  status: string;
  dist_path: string | null;
  error_message: string | null;
  created_at?: string | null;
  ready_at?: string | null;
};

/**
 * Live, deployed preview backed by the preview CDN. Subscribes to the
 * `project_builds` row referenced by `projects.latest_build_id` and renders:
 *  - the newest ready CDN preview while a newer build is still pending
 *  - the newest build URL when status = ready
 *  - an error card with the build log tail when status = failed and no prior
 *    ready preview exists
 *
 * This intentionally does not blank the preview for every pending build: a new
 * pending build can be orphaned if the external builder restarts after accepting
 * work but before posting its callback. Keeping the latest ready CDN URL visible
 * prevents users from getting stuck on a spinner when a valid deployed preview
 * already exists.
 */
export function MobilePreviewFallback({
  projectId,
  latestBuildId,
  isGenerating,
}: {
  projectId: string | null;
  latestBuildId: string | null;
  isGenerating: boolean;
}) {
  const [build, setBuild] = useState<BuildRow | null>(null);
  const [latestReadyBuild, setLatestReadyBuild] = useState<BuildRow | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [crashReason, setCrashReason] = useState<string | null>(null);
  const [pendingTooLong, setPendingTooLong] = useState(false);

  // Load the current latest build and a fallback ready build. We also poll the
  // latest row because realtime delivery can be delayed or unavailable on some
  // mobile browsers/network conditions.
  useEffect(() => {
    if (!latestBuildId) {
      setBuild(null);
      setLatestReadyBuild(null);
      return;
    }

    let cancelled = false;

    const applyBuild = (next: BuildRow) => {
      setBuild((prev) => {
        if (
          next.status === "ready" &&
          (prev?.status !== "ready" || prev?.dist_path !== next.dist_path)
        ) {
          setIframeKey((k) => k + 1);
        }
        return next;
      });
    };

    const loadLatestReadyBuild = async () => {
      if (!projectId) return;
      const { data } = await supabase
        .from("project_builds")
        .select("id, status, dist_path, error_message, created_at, ready_at")
        .eq("project_id", projectId)
        .eq("status", "ready")
        .not("dist_path", "is", null)
        .order("ready_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled && data) setLatestReadyBuild(data as BuildRow);
    };

    const loadLatestBuild = async () => {
      const { data } = await supabase
        .from("project_builds")
        .select("id, status, dist_path, error_message, created_at, ready_at")
        .eq("id", latestBuildId)
        .maybeSingle();

      if (cancelled || !data) return;
      const next = data as BuildRow;
      applyBuild(next);
      if (next.status !== "ready") void loadLatestReadyBuild();
    };

    void loadLatestBuild();
    void loadLatestReadyBuild();

    // Poll until we land on `ready` or `failed`. Once terminal, stop.
    const poll = window.setInterval(() => {
      // Reading the latest build state via closure is fine — applyBuild
      // updates `build`, and on the next interval tick we'll see the
      // newest value (React state is mutable from the interval's POV).
      setBuild((prev) => {
        if (prev?.status === "ready" || prev?.status === "failed") {
          window.clearInterval(poll);
          return prev;
        }
        void loadLatestBuild();
        return prev;
      });
    }, 5_000);

    // Stuck-build detector. If the build has been pending/building > 5 min, surface
    // an actionable error instead of an infinite spinner. We rely on
    // `created_at` so a freshly-created build still gets the full 5 min.
    const stuckTimer = window.setInterval(() => {
      setBuild((prev) => {
        if (!prev || (prev.status !== "pending" && prev.status !== "building")) {
          setPendingTooLong(false);
          return prev;
        }
        const createdAt = prev.created_at ? Date.parse(prev.created_at) : Date.now();
        const ageMs = Date.now() - createdAt;
        setPendingTooLong(ageMs > 5 * 60 * 1000);
        return prev;
      });
    }, 10_000);

    const channel = supabase
      .channel(`build:${latestBuildId}:${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "project_builds",
          filter: `id=eq.${latestBuildId}`,
        },
        (payload) => {
          const next = payload.new as BuildRow;
          applyBuild(next);
          if (next.status === "ready") {
            setLatestReadyBuild(next);
          } else {
            void loadLatestReadyBuild();
          }
        }
      )
      .subscribe((status, err) => {
        if (err) console.warn("[MobilePreviewFallback] realtime unavailable", err);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          void loadLatestBuild();
          void loadLatestReadyBuild();
        }
      });

    // iOS Safari suspends backgrounded tabs and silently kills realtime
    // websockets. Re-fetch whenever the user returns so the preview catches
    // up instead of staying frozen on stale state.
    const onAlive = () => {
      if (document.visibilityState === "visible") {
        void loadLatestBuild();
        void loadLatestReadyBuild();
      }
    };
    document.addEventListener("visibilitychange", onAlive);
    window.addEventListener("online", onAlive);
    window.addEventListener("focus", onAlive);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(stuckTimer);
      document.removeEventListener("visibilitychange", onAlive);
      window.removeEventListener("online", onAlive);
      window.removeEventListener("focus", onAlive);
      void supabase.removeChannel(channel);
    };
  }, [latestBuildId, projectId]);

  // No project / no build yet → empty state.
  if (!projectId || !latestBuildId) {
    return (
      <EmptyState
        title={isGenerating ? "Building your app…" : "Your preview will appear here"}
        message={
          isGenerating
            ? "Petal is generating files. The build will start as soon as they're ready."
            : "Send a message in the Chat tab to generate your first version."
        }
        spinning={isGenerating}
      />
    );
  }

  const status = (build?.status ?? "pending") as BuildStatus;
  const previewBuild = status === "ready" ? build : latestReadyBuild;

  const isBuildingPreview = status === "pending" || status === "building";

  if (isBuildingPreview && previewBuild?.dist_path) {
    return (
      <PreviewFrame
        src={previewBuild.dist_path}
        iframeKey={iframeKey}
            crashReason={crashReason}
            onCrash={setCrashReason}
            onReload={() => {
              setCrashReason(null);
              setIframeKey((k) => k + 1);
            }}
        badge="Updating preview…"
        cacheBust={previewBuild.id}
      />
    );
  }

  if (isBuildingPreview) {
    if (pendingTooLong) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-aurora p-6">
          <div className="max-w-md rounded-2xl border border-amber-500/40 bg-card/90 p-5 text-left shadow-sm backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base leading-tight">Build seems stuck</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your build has been pending for over 5 minutes — the builder may have
                  dropped this job. Send another message to retry, or check back in a bit.
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <EmptyState
        title="Building your live preview…"
        message="Publishing to the preview CDN. This usually takes 30–90 seconds."
        spinning
      />
    );
  }

  if (status === "failed") {
    if (previewBuild?.dist_path) {
      return (
        <PreviewFrame
          src={previewBuild.dist_path}
          iframeKey={iframeKey}
          crashReason={crashReason}
          onCrash={setCrashReason}
          onReload={() => {
            setCrashReason(null);
            setIframeKey((k) => k + 1);
          }}
          badge="Latest build failed — showing previous preview"
          cacheBust={previewBuild.id}
        />
      );
    }

    return (
      <div className="flex h-full w-full items-center justify-center bg-aurora p-6">
        <div className="max-w-md rounded-2xl border border-destructive/40 bg-card/90 p-5 text-left shadow-sm backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-base leading-tight">Build failed</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Your code didn't compile. Send a message asking Petal to fix it, or check the
                logs below.
              </p>
            </div>
          </div>
          {build?.error_message && (
            <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[10px] leading-snug text-muted-foreground">
              {build.error_message.slice(-2000)}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // status === "ready"
  if (!build?.dist_path) {
    return <EmptyState title="Build ready, but no URL was returned." message="" />;
  }

  return (
    <PreviewFrame
      src={build.dist_path}
      iframeKey={iframeKey}
      crashReason={crashReason}
      onCrash={setCrashReason}
      onReload={() => {
        setCrashReason(null);
        setIframeKey((k) => k + 1);
      }}
      cacheBust={build.id}
    />
  );
}

function PreviewFrame({
  src,
  iframeKey,
  onReload,
  badge,
  cacheBust,
}: {
  src: string;
  iframeKey: number;
  onReload: () => void;
  badge?: string;
  /** Optional value appended as ?v=<cacheBust> to bypass edge cache after a fresh deploy. */
  cacheBust?: string;
}) {
  // Append cache-bust param so a freshly-deployed build isn't masked by
  // Cloudflare's edge cache (which can serve stale HTML for ~30s post-deploy).
  // We never overwrite an existing query string the build URL might carry.
  const finalSrc = cacheBust
    ? `${src}${src.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheBust)}`
    : src;
  return (
    <div className="relative flex h-full w-full flex-col">
      {badge && (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{badge}</span>
        </div>
      )}

      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={onReload}
          className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
          title="Reload preview"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <iframe
          key={iframeKey}
          title="App preview"
          src={finalSrc}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}

function EmptyState({
  title,
  message,
  spinning,
}: {
  title: string;
  message: string;
  spinning?: boolean;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-aurora p-6">
      <div className="max-w-xs rounded-2xl border border-border bg-card/90 p-6 text-center shadow-sm backdrop-blur">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-butter">
          {spinning ? (
            <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
          ) : (
            <Sparkles className="h-5 w-5 text-foreground/70" />
          )}
        </div>
        <h3 className="font-display text-lg leading-tight">{title}</h3>
        {message && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}
