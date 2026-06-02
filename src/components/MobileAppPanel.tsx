/**
 * MobileAppPanel — Zero-config native shell setup + build dispatch.
 *
 * Petal owns the GitHub mirror + Codemagic app, so users just click
 * "Build iOS" / "Build Android". No bundle id or Codemagic id needed.
 *
 * States:
 *  1. Free plan → upgrade nudge (mobile is paid-only).
 *  2. Paid plan → Build iOS / Build Android buttons + recent builds list.
 */
import { useEffect, useState } from "react";
import { Apple, Loader2, Smartphone, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { BillingSheet } from "@/components/BillingSheet";
import { supabase } from "@/integrations/supabase/client";
import {
  getMobileAppStatus,
  startMobileBuild,
} from "@/lib/mobile-builds.functions";

type MobileBuild = {
  id: string;
  platform: "ios" | "android";
  kind: "unsigned" | "signed";
  status: "queued" | "running" | "succeeded" | "failed";
  artifact_url: string | null;
  estimated_cost_usd: number;
  created_at: string;
};

type Status = {
  provisioned: boolean;
  bundleId: string;
  githubRepo: string | null;
  signing: { hasApple: boolean; hasAndroid: boolean };
};

const STATUS_COLOR: Record<MobileBuild["status"], string> = {
  queued: "text-muted-foreground",
  running: "text-primary",
  succeeded: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
};

export function MobileAppPanel({ projectId }: { projectId: string }) {
  const { plan } = useWallet();
  const isPaidPlan = !!plan && plan.code !== "free";

  const [billingOpen, setBillingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [builds, setBuilds] = useState<MobileBuild[]>([]);
  const [busyPlatform, setBusyPlatform] = useState<"ios" | "android" | null>(null);

  const statusFn = useServerFn(getMobileAppStatus);
  const startFn = useServerFn(startMobileBuild);

  async function refresh() {
    setLoading(true);
    try {
      const [s, { data: buildRows }] = await Promise.all([
        statusFn({ data: { projectId } }),
        supabase
          .from("mobile_builds")
          .select("id, platform, kind, status, artifact_url, estimated_cost_usd, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      setStatus(s as Status);
      setBuilds((buildRows as MobileBuild[] | null) ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isPaidPlan) {
      setLoading(false);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isPaidPlan]);

  if (!isPaidPlan) {
    return (
      <div id="settings-mobile" className="mt-8 scroll-mt-4 border-t border-border pt-6">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Smartphone className="h-4 w-4" /> Mobile app
        </h3>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm text-foreground">
            Ship this project as a real iOS + Android app — App Store, Play Store,
            push notifications, the lot.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mobile builds are included with paid plans. Each build is metered
            from your runtime balance (~$0.20 unsigned, ~$0.40 signed).
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3 inline-flex items-center gap-1.5"
            onClick={() => setBillingOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" /> Upgrade to enable
          </Button>
        </div>
        <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
      </div>
    );
  }

  if (loading) {
    return (
      <div id="settings-mobile" className="mt-8 scroll-mt-4 border-t border-border pt-6">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Smartphone className="h-4 w-4" /> Mobile app
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  async function onBuild(platform: "ios" | "android") {
    setBusyPlatform(platform);
    try {
      const res = await startFn({
        data: { projectId, platform, kind: "unsigned" },
      });
      if (!res.ok) {
        if (res.reason === "plan_required") {
          toast.error("Upgrade required to build mobile apps");
          setBillingOpen(true);
        } else if (res.reason === "insufficient_balance") {
          toast.error("Top up your runtime balance to start a build");
        } else if (res.reason === "signing_required") {
          toast.error("Add a signing certificate to run a signed build");
        } else {
          toast.error(res.message ?? `Build failed (${res.reason})`);
        }
        return;
      }
      toast.success(
        `${platform === "ios" ? "iOS" : "Android"} build queued — ~$${res.estimatedCostUsd.toFixed(2)}`,
      );
      await refresh();
    } finally {
      setBusyPlatform(null);
    }
  }

  return (
    <div id="settings-mobile" className="mt-8 scroll-mt-4 border-t border-border pt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Smartphone className="h-4 w-4" /> Mobile app
      </h3>
      <div className="mb-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <div className="font-medium text-foreground">{status?.bundleId}</div>
        <div className="text-muted-foreground">
          {status?.provisioned
            ? "Managed by Petal · ready to build"
            : "Will be provisioned on first build"}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busyPlatform !== null}
          onClick={() => onBuild("ios")}
          className="inline-flex items-center gap-1.5"
        >
          {busyPlatform === "ios" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Apple className="h-3.5 w-3.5" />
          )}
          Build iOS
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busyPlatform !== null}
          onClick={() => onBuild("android")}
          className="inline-flex items-center gap-1.5"
        >
          {busyPlatform === "android" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Smartphone className="h-3.5 w-3.5" />
          )}
          Build Android
        </Button>
      </div>

      {builds.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent builds
          </div>
          <ul className="space-y-1.5">
            {builds.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  {b.platform === "ios" ? (
                    <Apple className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="font-medium">
                    {b.platform === "ios" ? "iOS" : "Android"}
                  </span>
                  <span className="text-muted-foreground">· {b.kind}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={STATUS_COLOR[b.status]}>{b.status}</span>
                  {b.artifact_url && (
                    <a
                      href={b.artifact_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
    </div>
  );
}
