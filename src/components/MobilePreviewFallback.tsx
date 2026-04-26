import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Info, RotateCw, Sparkles } from "lucide-react";
import type { ProjectFile } from "@/server/generate.server";
import { supabase } from "@/integrations/supabase/client";

/**
 * Static-snapshot preview for devices that can't run WebContainers (iOS,
 * non-Chromium Android). We render the project's current files via the
 * `/api/preview/:projectId` server route, which returns a self-contained
 * HTML doc — fast, no install step, works everywhere.
 *
 * Trade-off: Vite/React projects show a "open on desktop for live preview"
 * card (because the static doc can't run a bundler). Plain HTML/CSS/JS
 * projects render fully interactively.
 */
export function MobilePreviewFallback({
  projectId,
  files,
  reloadKey,
  isGenerating,
}: {
  /** Null while a brand-new project is being created. */
  projectId: string | null;
  files: ProjectFile[];
  reloadKey: number;
  isGenerating: boolean;
}) {
  const [iframeKey, setIframeKey] = useState(0);
  const [bearer, setBearer] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Cache-busting signature: changes whenever any file content does.
  const versionSig = useMemo(() => {
    if (files.length === 0) return 0;
    let h = 0;
    for (const f of files) h = (h * 31 + f.content.length) | 0;
    return Math.abs(h);
  }, [files]);

  // Reload iframe when caller bumps reloadKey, or when files change.
  useEffect(() => {
    setIframeKey((k) => k + 1);
  }, [reloadKey, versionSig]);

  // Grab access token so private projects load. Refresh on auth change.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setBearer(data.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setBearer(session?.access_token ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Empty state: no project yet OR no files yet.
  if (!projectId || files.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-aurora p-6">
        <div className="max-w-xs rounded-2xl border border-border bg-card/90 p-6 text-center shadow-sm backdrop-blur">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-butter">
            {isGenerating ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
            ) : (
              <Sparkles className="h-5 w-5 text-foreground/70" />
            )}
          </div>
          <h3 className="font-display text-lg leading-tight">
            {isGenerating ? "Building your app…" : "Your preview will appear here"}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {isGenerating
              ? "Petal is generating files. The preview updates as soon as they're ready."
              : "Send a message in the Chat tab to generate your first version."}
          </p>
        </div>
      </div>
    );
  }

  // Build src with token + cache buster. The token is a query param because
  // iframes can't set Authorization headers — the route accepts both.
  const src = `/api/preview/${projectId}?v=${versionSig}${
    bearer ? `&t=${encodeURIComponent(bearer)}` : ""
  }`;

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Reload control */}
      <div className="absolute right-2 top-2 z-10">
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
          ref={iframeRef}
          key={iframeKey}
          title="App preview"
          src={src}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>

      {/* Info banner */}
      <div className="flex shrink-0 items-start gap-2 border-t border-border bg-card/80 px-3 py-2 text-[11px] leading-snug text-muted-foreground backdrop-blur">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Static preview. For a fully interactive build with hot reload, open this project in
          desktop Chrome, Edge, or Firefox.
        </span>
      </div>
    </div>
  );
}
