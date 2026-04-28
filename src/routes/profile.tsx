import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-5 pb-20 pt-10 sm:px-6 sm:pt-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="mt-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Your profile
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Set how Petal greets you and what shows on your projects.
          </p>
        </div>

        <form
          onSubmit={handleSave}
          className="mt-10 space-y-6 rounded-2xl border border-border bg-card/60 p-6 shadow-sm backdrop-blur-sm sm:p-8"
        >
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email
            </Label>
            <p className="text-sm text-foreground">{user?.email}</p>
          </div>

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
      </div>
    </div>
  );
}
