/**
 * GitSyncSection — connect a project to a GitHub repo you own and push
 * snapshots of its files there.
 *
 * Uses a fine-grained personal access token (Contents: read & write). The
 * token is stored server-side only and never returned to the browser.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Github,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  connectProjectGitRepo,
  disconnectProjectGitRepo,
  getProjectGitLink,
  pushProjectToGit,
  setProjectGitAutoSync,
  type GitLink,
} from "@/lib/git-sync.functions";

const TOKEN_HELP = "https://github.com/settings/personal-access-tokens/new";

export function GitSyncSection({ projectId }: { projectId: string }) {
  const fetchLink = useServerFn(getProjectGitLink);
  const connectFn = useServerFn(connectProjectGitRepo);
  const disconnectFn = useServerFn(disconnectProjectGitRepo);
  const pushFn = useServerFn(pushProjectToGit);
  const autoSyncFn = useServerFn(setProjectGitAutoSync);

  const [link, setLink] = useState<GitLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "push" | "disconnect" | null>(null);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");

  const load = useCallback(async () => {
    try {
      setLink(await fetchLink({ data: { projectId } }));
    } catch {
      setLink({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [fetchLink, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!repo.trim() || !token.trim()) {
      toast.error("Add both the repository and a token.");
      return;
    }
    setBusy("connect");
    try {
      const res = await connectFn({
        data: {
          projectId,
          repoFullName: repo.trim(),
          branch: branch.trim() || "main",
          token: token.trim(),
          autoSync: false,
        },
      });
      if (!res.connected) {
        toast.error(res.error ?? "Couldn't connect that repository.");
        return;
      }
      setToken("");
      setLink(res);
      toast.success(`Connected to ${res.repoFullName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't connect that repository.");
    } finally {
      setBusy(null);
    }
  };

  const push = async () => {
    setBusy("push");
    try {
      const res = await pushFn({ data: { projectId } });
      if (!res.ok) {
        toast.error(res.error ?? "Push failed.");
      } else {
        toast.success("Pushed to GitHub", {
          action: res.commitUrl
            ? { label: "View commit", onClick: () => window.open(res.commitUrl, "_blank") }
            : undefined,
        });
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await disconnectFn({ data: { projectId } });
      setLink({ connected: false });
      toast.success("Repository disconnected");
    } finally {
      setBusy(null);
    }
  };

  const toggleAutoSync = async (next: boolean) => {
    setLink((prev) => (prev ? { ...prev, autoSync: next } : prev));
    const res = await autoSyncFn({ data: { projectId, autoSync: next } });
    if (!res.ok) {
      setLink((prev) => (prev ? { ...prev, autoSync: !next } : prev));
      toast.error("Couldn't update auto-sync.");
    }
  };

  return (
    <div id="settings-git" className="mt-8 scroll-mt-4 border-t border-border pt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Github className="h-4 w-4" /> GitHub sync
      </h3>

      {loading ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
        </div>
      ) : link?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{link.repoFullName}</div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                {link.branch}
                {link.lastSyncedAt && (
                  <> · last push {new Date(link.lastSyncedAt).toLocaleString()}</>
                )}
              </div>
            </div>
            <a
              href={link.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          {link.lastError && (
            <p className="rounded-lg bg-destructive/10 p-2 text-xs font-medium text-destructive">
              Last push failed: {link.lastError}
            </p>
          )}

          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div>
              <div className="text-sm font-medium">Push after every change</div>
              <div className="text-xs text-muted-foreground">
                Mirror each build automatically instead of pushing by hand.
              </div>
            </div>
            <Switch checked={!!link.autoSync} onCheckedChange={toggleAutoSync} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={busy !== null}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Disconnect
            </Button>
            <Button size="sm" onClick={push} disabled={busy !== null}>
              {busy === "push" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="mr-1.5 h-3.5 w-3.5" />
              )}
              Push now
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Mirror this project's code into a repository you own. Create a{" "}
            <a
              href={TOKEN_HELP}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              fine-grained token
            </a>{" "}
            with <strong>Contents: read &amp; write</strong> on that repo. Petal stores it
            encrypted and never shows it again.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="git-repo" className="text-xs">
                Repository
              </Label>
              <Input
                id="git-repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="your-name/your-repo"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="git-branch" className="text-xs">
                Branch
              </Label>
              <Input
                id="git-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="git-token" className="text-xs">
              Access token
            </Label>
            <Input
              id="git-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={connect} disabled={busy !== null}>
              {busy === "connect" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Github className="mr-1.5 h-3.5 w-3.5" />
              )}
              Connect repository
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
