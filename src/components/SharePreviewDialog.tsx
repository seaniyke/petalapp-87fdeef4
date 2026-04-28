/**
 * Share Preview dialog — generate a public link to the project's live preview
 * with optional sticky-note commenting from visitors.
 */
import { useEffect, useState } from "react";
import { Link2, Copy, Check, MessageSquare, RotateCw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  buildShareUrl,
  getOrCreateShareForProject,
  revokeShare,
  rotateShareToken,
  setShareCommentsEnabled,
  type PreviewShare,
} from "@/lib/preview-share";
import { useAuthReady } from "@/lib/auth";

export type SharePreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
};

export function SharePreviewDialog({
  open,
  onOpenChange,
  projectId,
}: SharePreviewDialogProps) {
  const auth = useAuthReady();
  const [share, setShare] = useState<PreviewShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !projectId || !auth.user) return;
    let cancelled = false;
    setLoading(true);
    getOrCreateShareForProject(projectId, auth.user.id)
      .then((s) => {
        if (!cancelled) setShare(s);
      })
      .catch((e) => toast.error(e?.message ?? "Failed to create share link"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectId, auth.user]);

  const url = share ? buildShareUrl(share.token) : "";

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  async function toggleComments(next: boolean) {
    if (!share) return;
    setShare({ ...share, allow_comments: next });
    try {
      await setShareCommentsEnabled(share.id, next);
    } catch (e) {
      toast.error("Failed to update");
      setShare({ ...share, allow_comments: !next });
    }
  }

  async function rotate() {
    if (!share) return;
    setLoading(true);
    try {
      const next = await rotateShareToken(share.id);
      setShare(next);
      toast.success("New link generated. The old one no longer works.");
    } catch {
      toast.error("Failed to rotate link");
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!share) return;
    if (!confirm("Revoke this share link? Visitors will no longer be able to view or comment.")) return;
    try {
      await revokeShare(share.id);
      setShare(null);
      onOpenChange(false);
      toast.success("Share link revoked.");
    } catch {
      toast.error("Failed to revoke");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Share preview & gather feedback
          </DialogTitle>
          <DialogDescription>
            Anyone with this link can view your live preview. They can click any element to
            leave a sticky-note comment that lands in your builder chat.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={loading ? "Generating link…" : url}
              className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" size="sm" onClick={copy} disabled={!url}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Allow comments</div>
                <div className="text-xs text-muted-foreground">
                  Visitors can pin sticky notes to any element on the page.
                </div>
              </div>
            </div>
            <Switch
              checked={share?.allow_comments ?? true}
              onCheckedChange={toggleComments}
              disabled={!share}
            />
          </div>

          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={rotate}
              disabled={!share || loading}
            >
              <RotateCw className="mr-1.5 h-3.5 w-3.5" />
              Rotate link
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={revoke}
              disabled={!share}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Revoke
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
