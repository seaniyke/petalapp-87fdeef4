import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Store } from "lucide-react";
import { toast } from "@/lib/notify";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { adminApi } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/features")({
  head: () => ({
    meta: [
      { title: "Admin · Features" },
      { name: "description", content: "Control which Kimble features are available." },
      { property: "og:title", content: "Admin · Features" },
      { property: "og:description", content: "Control which Kimble features are available." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminFeaturesPage,
});

function AdminFeaturesPage() {
  const { ready } = useAdminGuard("/admin/features");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    adminApi<{ marketplace: boolean }>({ action: "feature_settings" })
      .then((data) => setEnabled(data.marketplace))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load features"))
      .finally(() => setLoading(false));
  }, [ready]);

  async function setMarketplace(next: boolean) {
    setSaving(true);
    try {
      const result = await adminApi<{ enabled: boolean }>({
        action: "feature_toggle",
        feature: "marketplace",
        enabled: next,
      });
      setEnabled(result.enabled);
      toast.success(result.enabled ? "Marketplace is on" : "Marketplace is off");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Marketplace");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold">Features</h1>
        <p className="mt-1 text-sm text-muted-foreground">Turn product areas on or off without deleting them.</p>
        <Card className="mt-6 max-w-2xl">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div className="flex min-w-0 items-start gap-3">
              <Store className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="font-semibold">Marketplace</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Shows Marketplace across Kimble, including the landing page and selling tools.
                </p>
              </div>
            </div>
            {loading ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={enabled}
                onCheckedChange={setMarketplace}
                disabled={saving}
                aria-label="Marketplace"
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}