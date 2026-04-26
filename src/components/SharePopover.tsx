import { useState } from "react";
import { Globe, Copy, Check, Loader2, Lock, ArrowRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { updateProject, type ProjectRow } from "@/lib/projects";
import { toast } from "sonner";

type Props = {
  project: ProjectRow;
  onChange: (next: ProjectRow) => void;
  /** Open the project settings sheet on the Domains section. */
  onConnectDomain?: () => void;
};

export function SharePopover({ project, onChange, onConnectDomain }: Props) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/p/${project.slug}`
      : `/p/${project.slug}`;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const updated = await updateProject(project.id, { is_public: next });
      onChange(updated);
      toast.success(next ? "Project is now public" : "Project is now private");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update visibility");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition ${
            project.is_public
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
          title={project.is_public ? "Public — anyone with the link" : "Private"}
        >
          {project.is_public ? (
            <Globe className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          Share
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Make public</div>
            <div className="text-xs text-muted-foreground">
              Anyone with the link can view and remix.
            </div>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Switch
              checked={project.is_public}
              onCheckedChange={toggle}
              disabled={busy}
            />
          </div>
        </div>
        <div className="space-y-2 p-4">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Share link
          </label>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className={`flex-1 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs ${
                project.is_public ? "" : "opacity-50"
              }`}
            />
            <button
              onClick={copy}
              disabled={!project.is_public}
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-muted disabled:opacity-40"
              title="Copy link"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          {!project.is_public && (
            <p className="text-[11px] text-muted-foreground">
              Turn on <span className="font-medium">Make public</span> to share this link.
            </p>
          )}
        </div>
        {onConnectDomain && (
          <button
            type="button"
            onClick={onConnectDomain}
            className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-3 text-left text-xs text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Use a custom domain
            </span>
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
