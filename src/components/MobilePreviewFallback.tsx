import { useEffect, useState } from "react";
import { Loader2, Sparkles, AlertCircle, RotateCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type BuildStatus = "pending" | "ready" | "failed";

type BuildRow = {
  id: string;
  status: string;
  dist_path: string | null;
  error_message: string | null;
};

/**
 * Live, deployed preview backed by Cloudflare Pages. Subscribes to the
 * `project_builds` row referenced by `projects.latest_build_id` and renders:
 *  - a "Building…" card while status = pending
 *  - an <iframe> pointing at `dist_path` when status = ready
 *  - an error card with the build log tail when status = failed
 *
 * `latestBuildId` is supplied by the parent (the builder route subscribes to
 * project rows, so it always knows the newest build).
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
  const [iframeKey, setIframeKey] = useState(0);

  // Load the row once whenever latestBuildId changes, then subscribe to updates.
  useEffect(() => {
    if (!latestBuildId) {
      setBuild(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("project_builds")
      .select("id, status, dist_path, error_message")
      .eq("id", latestBuildId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setBuild(data as BuildRow);
      });

    const channel = supabase
      .channel(`build:${latestBuildId}`)
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
          setBuild(next);
          if (next.status === "ready") setIframeKey((k) => k + 1);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [latestBuildId]);

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

  if (status === "pending") {
    return (
      <EmptyState
        title="Building your live preview…"
        message="Installing dependencies and deploying to Cloudflare Pages. This usually takes 30–90 seconds."
        spinning
      />
    );
  }

  if (status === "failed") {
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
    <div className="relative flex h-full w-full flex-col">
      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <a
          href={build.dist_path}
          target="_blank"
          rel="noreferrer"
          className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={() => setIframeKey((k) => k + 1)}
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
          src={build.dist_path}
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
