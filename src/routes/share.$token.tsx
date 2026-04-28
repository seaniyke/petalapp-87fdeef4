/**
 * Public Share page — anyone with the share token can view the project's
 * preview in an iframe and (if commenting is enabled) leave sticky-note
 * comments anchored to the element they click.
 *
 * Why the iframe approach: the visitor sees the actual published / preview
 * deployment, fully sandboxed. The sticky-note overlay sits OUTSIDE the
 * iframe (we cannot inject into cross-origin iframes), so we record:
 *   - viewport-relative coordinates (x_pct, y_pct)
 *   - a textual hint (we cannot inspect the DOM cross-origin, so selector
 *     stays null unless the visitor types one in)
 *
 * This matches Vercel's preview-comments UX without requiring any cooperation
 * from the embedded page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare, Send, X, Loader2 } from "lucide-react";
import { resolvePublishedUrl } from "@/lib/published-url";
import {
  getShareByToken,
  postComment,
  type PreviewShare,
} from "@/lib/preview-share";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type LoadState =
  | { kind: "loading" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "ready";
      share: PreviewShare;
      previewUrl: string;
      displayHost: string;
    };

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
  head: () => ({
    meta: [
      { title: "Shared preview · Petal" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function SharePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("petal_share_author") ?? "",
  );
  const [posting, setPosting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const share = await getShareByToken(token);
      if (cancelled) return;
      if (!share) {
        setState({ kind: "invalid", reason: "This link is invalid or has expired." });
        return;
      }
      if (share.revoked_at) {
        setState({ kind: "invalid", reason: "This link has been revoked." });
        return;
      }
      if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
        setState({ kind: "invalid", reason: "This link has expired." });
        return;
      }
      // Look up the project to find its preview / published URL.
      const { data: proj } = await supabase
        .from("projects")
        .select("primary_domain_id, latest_build_id")
        .eq("id", share.project_id)
        .maybeSingle();
      const resolved = await resolvePublishedUrl(
        share.project_id,
        proj?.primary_domain_id ?? null,
        proj?.latest_build_id ?? null,
      );
      if (!resolved.url) {
        setState({
          kind: "invalid",
          reason: "This project hasn't been published yet — ask the owner to publish first.",
        });
        return;
      }
      setState({
        kind: "ready",
        share,
        previewUrl: resolved.url,
        displayHost: resolved.display ?? "",
      });
    })().catch((e) => {
      setState({ kind: "invalid", reason: e?.message ?? "Failed to load share." });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const allowComments =
    state.kind === "ready" && state.share.allow_comments;

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!allowComments) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPin({ x, y });
    setBody("");
  }

  async function submitComment() {
    if (state.kind !== "ready" || !pin || !body.trim()) return;
    setPosting(true);
    try {
      await postComment({
        shareId: state.share.id,
        projectId: state.share.project_id,
        pagePath: "/",
        selector: null,
        xPct: pin.x,
        yPct: pin.y,
        body: body.trim(),
        viewportWidth: window.innerWidth,
        authorName: author.trim() || null,
      });
      if (author.trim()) {
        localStorage.setItem("petal_share_author", author.trim());
      }
      toast.success("Comment sent — the builder will see it instantly.");
      setPin(null);
      setBody("");
    } catch (e) {
      toast.error("Failed to send comment.");
    } finally {
      setPosting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="grid h-screen place-items-center bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (state.kind === "invalid") {
    return (
      <div className="grid h-screen place-items-center bg-background p-6 text-center">
        <div>
          <div className="text-2xl font-semibold">Can't open this preview</div>
          <p className="mt-2 text-sm text-muted-foreground">{state.reason}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Petal Preview</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono text-xs text-muted-foreground">
            {state.displayHost}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {allowComments ? (
            <>
              <MessageSquare className="h-3.5 w-3.5" />
              Click anywhere to leave a comment
            </>
          ) : (
            <span>Read-only preview</span>
          )}
        </div>
      </header>

      {/* Iframe + overlay */}
      <div className="relative flex-1">
        <iframe
          src={state.previewUrl}
          title="Shared preview"
          className="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        />
        {allowComments && (
          <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className={cn(
              "absolute inset-0 cursor-crosshair",
              pin ? "bg-foreground/5" : "bg-transparent",
            )}
          >
            {pin && (
              <div
                className="absolute"
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="grid h-6 w-6 -translate-x-3 -translate-y-3 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-lg ring-4 ring-primary/20">
                  ✚
                </div>
                <div className="mt-2 w-72 -translate-x-1/2 rounded-xl border border-border bg-card p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between text-xs font-medium">
                    <span>New comment</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setPin(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Your name (optional)"
                    className="mb-2 h-8 text-xs"
                  />
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="What's wrong / what should change?"
                    rows={3}
                    className="text-sm"
                    autoFocus
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitComment}
                      disabled={!body.trim() || posting}
                    >
                      {posting ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="mr-1 h-3 w-3" />
                      )}
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-border bg-card px-4 py-2 text-center text-[11px] text-muted-foreground">
        Built with{" "}
        <a href="/" className="font-medium text-foreground hover:underline">
          Petal
        </a>
      </footer>
    </div>
  );
}
