/**
 * Admin → Builder.
 *
 * One-click redeploy of the Railway builder service (Playwright/Docker image)
 * so shipping a builder change doesn't require the terminal or the Railway
 * dashboard. Also shows the last few deployments and a live health ping.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Rocket, Activity, ExternalLink } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getBuilderDeployStatus,
  redeployBuilder,
  checkBuilderHealth,
  type BuilderDeployStatus,
  type BuilderHealth,
} from "@/lib/admin-builder-deploy.functions";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAdminGuard } from "@/hooks/use-admin-guard";

export const Route = createFileRoute("/admin/builder")({
  head: () => ({
    meta: [
      { title: "Admin · Builder Deploys" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminBuilderPage,
});

function statusTone(status: string) {
  const s = status.toUpperCase();
  if (s === "SUCCESS") return "text-emerald-500";
  if (s === "FAILED" || s === "CRASHED") return "text-destructive";
  if (s === "REMOVED" || s === "SKIPPED") return "text-muted-foreground";
  return "text-amber-500";
}

function AdminBuilderPage() {
  const { ready } = useAdminGuard("/admin/builder");
  const fetchStatus = useServerFn(getBuilderDeployStatus);
  const triggerRedeploy = useServerFn(redeployBuilder);
  const ping = useServerFn(checkBuilderHealth);

  const [status, setStatus] = useState<BuilderDeployStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<BuilderHealth | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchStatus();
      if (res.unauthorized) {
        setError("Admin access required");
        return;
      }
      setStatus(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchStatus]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  // While a deploy is in flight, poll so the row flips to SUCCESS on its own.
  useEffect(() => {
    if (!status?.configured) return;
    const inFlight = status.deployments.some((d) =>
      ["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING"].includes(
        d.status.toUpperCase(),
      ),
    );
    if (!inFlight) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [status, load]);

  async function onRedeploy() {
    setBusy(true);
    try {
      const res = await triggerRedeploy();
      if (res.ok) {
        toast.success("Redeploy started", {
          description: "Railway is rebuilding the builder image now.",
        });
        setTimeout(() => void load(), 2500);
      } else {
        toast.error("Redeploy failed", { description: res.error });
      }
    } catch (e) {
      toast.error("Redeploy failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onPing() {
    setHealth(null);
    try {
      const res = await ping();
      setHealth(res);
    } catch (e) {
      setHealth({
        reachable: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <AdminTabs />
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Builder Deploys</h1>
          <p className="text-sm text-muted-foreground">
            Rebuild and roll out the build service without touching a terminal.
          </p>
        </div>

        {error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : !status ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Redeploy builder</p>
                  <p className="text-sm text-muted-foreground">
                    Rebuilds from the latest source and swaps traffic over when
                    the new image is healthy.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={onPing}>
                    <Activity className="mr-2 h-4 w-4" />
                    Ping
                  </Button>
                  <Button
                    size="sm"
                    onClick={onRedeploy}
                    disabled={busy || !status.configured}
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Rocket className="mr-2 h-4 w-4" />
                    )}
                    Redeploy
                  </Button>
                </div>
              </CardContent>
            </Card>

            {!status.configured && (
              <Card>
                <CardContent className="space-y-2 p-6 text-sm">
                  <p className="font-semibold">Connect Railway to enable this</p>
                  <p className="text-muted-foreground">
                    Add the following to Petal secrets, then reload:
                  </p>
                  <ul className="list-inside list-disc text-muted-foreground">
                    {status.missing.map((m) => (
                      <li key={m}>
                        <code className="rounded bg-muted px-1 text-xs">{m}</code>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {health && (
              <Card>
                <CardContent className="p-6 text-sm">
                  {health.reachable ? (
                    <p className="text-emerald-500">
                      Builder is live (HTTP {health.status}).
                    </p>
                  ) : (
                    <p className="text-destructive">
                      Builder unreachable{health.error ? `: ${health.error}` : ""}
                    </p>
                  )}
                  {health.body && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                      {health.body}
                    </pre>
                  )}
                </CardContent>
              </Card>
            )}

            {status.error && (
              <Card>
                <CardContent className="p-6 text-sm text-destructive">
                  {status.error}
                </CardContent>
              </Card>
            )}

            {status.configured && !status.error && (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">Deployment</th>
                        <th className="px-4 py-2 text-left">Status</th>
                        <th className="px-4 py-2 text-left">Started</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.deployments.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-6 text-sm text-muted-foreground"
                          >
                            No deployments found for this service.
                          </td>
                        </tr>
                      ) : (
                        status.deployments.map((d) => (
                          <tr key={d.id} className="border-b border-border/40">
                            <td className="px-4 py-2 font-mono text-xs">
                              {d.id.slice(0, 8)}
                            </td>
                            <td
                              className={`px-4 py-2 font-medium ${statusTone(d.status)}`}
                            >
                              {d.status}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {new Date(d.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {d.url && (
                                <a
                                  href={d.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Open <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
