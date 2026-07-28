import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountHubGrid } from "@/components/AccountHubGrid";
import { InviteFriendsCard } from "@/components/InviteFriendsCard";
import { BillingSheet } from "@/components/BillingSheet";
import { CloudBalanceSheet } from "@/components/CloudBalanceSheet";
import { CloudPanelSheet } from "@/components/cloud/CloudPanelSheet";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
  head: () => ({
    meta: [
      { title: "Your Profile · Petal" },
      { name: "description", content: "Set your display name and avatar." },
    ],
  }),
});

function ProfilePage() {
  const { user, isReady } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [billingOpen, setBillingOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudPanelOpen, setCloudPanelOpen] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      navigate({ to: "/auth", search: { mode: "signin", redirect: "/profile" } });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setDisplayName(data.display_name ?? "");
        setAvatarUrl(data.avatar_url ?? "");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, user, navigate]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const trimmedName = displayName.trim();
    const trimmedAvatar = avatarUrl.trim();
    const { error } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        display_name: trimmedName || null,
        avatar_url: trimmedAvatar || null,
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Keep the home-page greeting cache in sync so a refresh shows the new
    // name immediately (no flash of the previous email-derived value).
    if (typeof window !== "undefined") {
      try {
        const key = `petal:profile-name:${user.id}`;
        if (trimmedName) window.localStorage.setItem(key, trimmedName);
        else window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    toast.success("Profile updated");
  }

  const initial = (displayName || user?.email || "?").trim()[0]?.toUpperCase() ?? "?";

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Editorial cover band */}
      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
        <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
        <div className="relative mx-auto max-w-2xl px-5 pb-24 pt-12 sm:px-6 sm:pt-16">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Account
          </p>
          <h1 className="heading-editorial mt-3 text-5xl sm:text-6xl">
            Your <em>profile.</em>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
            Set how Petal greets you and what shows on your projects.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-5 pb-20 sm:px-6">
        {/* Avatar preview card, overlapping the hero */}
        <div className="-mt-14 flex items-end gap-4 rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-editorial)] sm:p-6">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-foreground text-2xl font-semibold text-background ring-4 ring-background">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-semibold tracking-tight">
              {displayName || user?.email?.split("@")[0] || "Set your name"}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <form
          onSubmit={handleSave}
          className="mt-6 space-y-6 rounded-3xl border border-border bg-card/70 p-6 shadow-[var(--shadow-soft)] backdrop-blur-sm sm:p-8"
        >
          <div className="space-y-2">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Ada"
              maxLength={60}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              We'll use the first part of this to greet you on the home page.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar_url">Avatar URL</Label>
            <Input
              id="avatar_url"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="submit" disabled={saving || loading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>


        <InviteFriendsCard />

        <AccountHubGrid
          onOpenBilling={() => setBillingOpen(true)}
          onOpenCloudBalance={() => setCloudOpen(true)}
          onOpenCloud={() => setCloudPanelOpen(true)}
        />
      </div>

      <BillingSheet
        open={billingOpen}
        onOpenChange={setBillingOpen}
        onOpenCloudBalance={() => {
          setBillingOpen(false);
          setCloudOpen(true);
        }}
      />
      <CloudBalanceSheet
        open={cloudOpen}
        onOpenChange={setCloudOpen}
        onOpenBilling={() => {
          setCloudOpen(false);
          setBillingOpen(true);
        }}
      />
      <CloudPanelSheet
        open={cloudPanelOpen}
        onOpenChange={setCloudPanelOpen}
        onOpenBalance={() => {
          setCloudPanelOpen(false);
          setCloudOpen(true);
        }}
      />
    </div>
  );
}
