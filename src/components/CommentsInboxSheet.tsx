/**
 * Comments Inbox — sheet shown in the builder where the owner sees all
 * sticky-note comments visitors left on shared previews. Resolves them or
 * inserts the text into the composer as a fix prompt.
 *
 * Uses Supabase realtime so new comments arrive without refresh.
 */
import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Check, Send, ExternalLink, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  listProjectComments,
  resolveComment,
  type PreviewComment,
} from "@/lib/preview-share";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type CommentsInboxSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onSendFixPrompt?: (prompt: string) => void;
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function CommentsInboxSheet({
  open,
  onOpenChange,
  projectId,
  onSendFixPrompt,
}: CommentsInboxSheetProps) {
  const [comments, setComments] = useState<PreviewComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setComments(await listProjectComments(projectId));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Realtime — new visitor comments appear instantly
  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`preview_comments:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "preview_comments",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const c = payload.new as PreviewComment;
          setComments((prev) => [c, ...prev]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId]);

  async function markResolved(c: PreviewComment) {
    setComments((prev) =>
      prev.map((x) =>
        x.id === c.id ? { ...x, status: "resolved", resolved_at: new Date().toISOString() } : x,
      ),
    );
    try {
      await resolveComment(c.id);
    } catch {
      toast.error("Failed to resolve");
      load();
    }
  }

  function buildPrompt(c: PreviewComment): string {
    const where = c.selector ? `Element: ${c.selector}` : "On the page";
    return `Visitor feedback on ${c.page_path}\n${where}\nAuthor: ${c.author_name ?? "Anonymous"}\n\n"${c.body}"\n\nFix this.`;
  }

  const visible = comments.filter((c) => (filter === "open" ? c.status === "open" : true));
  const openCount = comments.filter((c) => c.status === "open").length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Visitor feedback
            {openCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {openCount} open
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Sticky-note comments from people you shared the preview with.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setFilter("open")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              filter === "open"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              filter === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            All
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {loading && (
            <div className="text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {!loading && visible.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No {filter === "open" ? "open " : ""}comments yet.
              <br />
              <span className="text-xs">
                Share your preview link to start gathering feedback.
              </span>
            </div>
          )}
          {visible.map((c) => (
            <div
              key={c.id}
              className={cn(
                "rounded-lg border p-3 text-sm",
                c.status === "resolved"
                  ? "border-border bg-muted/30 opacity-60"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {c.author_name || "Anonymous"}
                    </span>
                    <span>·</span>
                    <span>{relTime(c.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-snug">{c.body}</p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate">{c.page_path}</span>
                    {c.selector && (
                      <span className="truncate font-mono">· {c.selector}</span>
                    )}
                  </div>
                </div>
              </div>
              {c.status === "open" && (
                <div className="mt-3 flex gap-2">
                  {onSendFixPrompt && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        onSendFixPrompt(buildPrompt(c));
                        onOpenChange(false);
                      }}
                    >
                      <Send className="mr-1 h-3 w-3" />
                      Ask Petal to fix
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => markResolved(c)}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Resolve
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
