/**
 * Admin → Pictures.
 *
 * Internal only. The curated picture library the builder searches before it
 * generates anything. Rows are written straight through the database client —
 * the table's own rules already restrict writes to admins.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pictures")({
  head: () => ({
    meta: [
      { title: "Admin · Pictures" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPicturesPage,
});

type Row = {
  id: string;
  url: string;
  subject: string;
  industry: string | null;
  mood: string | null;
  style: string | null;
  location: string | null;
  orientation: string;
  aspect_ratio: string;
  has_people: boolean;
  tags: string[];
  license: string;
  active: boolean;
};

const BLANK = {
  url: "",
  subject: "",
  industry: "",
  mood: "",
  style: "photography",
  location: "",
  orientation: "landscape",
  aspect_ratio: "16:9",
  has_people: false,
  tags: "",
  license: "cc0",
};

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function AdminPicturesPage() {
  const { ready } = useAdminGuard("/admin/pictures");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ ...BLANK });

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("design_pictures")
      .select(
        "id,url,subject,industry,mood,style,location,orientation,aspect_ratio,has_people,tags,license,active",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as Row[]);
  }

  useEffect(() => {
    if (ready) void load();
  }, [ready]);

  async function add() {
    if (!draft.url.trim() || !draft.subject.trim()) {
      toast.error("A picture needs a link and a subject.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("design_pictures").insert({
      url: draft.url.trim(),
      subject: draft.subject.trim(),
      industry: draft.industry.trim() || null,
      mood: draft.mood.trim() || null,
      style: draft.style.trim() || null,
      location: draft.location.trim() || null,
      orientation: draft.orientation,
      aspect_ratio: draft.aspect_ratio,
      has_people: draft.has_people,
      tags: splitTags(draft.tags),
      license: draft.license.trim() || "unknown",
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft({ ...BLANK });
    toast.success("Picture added");
    void load();
  }

  async function toggle(row: Row) {
    const { error } = await supabase
      .from("design_pictures")
      .update({ active: !row.active })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: !r.active } : r)));
  }

  async function remove(row: Row) {
    const { error } = await supabase.from("design_pictures").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) =>
        `${r.subject} ${r.industry ?? ""} ${r.mood ?? ""} ${r.tags.join(" ")}`
          .toLowerCase()
          .includes(needle),
      )
    : rows;

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold">Pictures</h1>
          <p className="text-sm text-muted-foreground">
            The builder searches this library first and only makes a new picture when
            nothing here fits.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              placeholder="Image link"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
            <Input
              placeholder="Subject (e.g. modern coffee shop interior)"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
            <Input
              placeholder="Industry"
              value={draft.industry}
              onChange={(e) => setDraft({ ...draft, industry: e.target.value })}
            />
            <Input
              placeholder="Mood"
              value={draft.mood}
              onChange={(e) => setDraft({ ...draft, mood: e.target.value })}
            />
            <Input
              placeholder="Style"
              value={draft.style}
              onChange={(e) => setDraft({ ...draft, style: e.target.value })}
            />
            <Input
              placeholder="Location"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
            <Input
              placeholder="Tags, comma separated"
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            />
            <Input
              placeholder="Orientation"
              value={draft.orientation}
              onChange={(e) => setDraft({ ...draft, orientation: e.target.value })}
            />
            <Input
              placeholder="Aspect ratio"
              value={draft.aspect_ratio}
              onChange={(e) => setDraft({ ...draft, aspect_ratio: e.target.value })}
            />
            <Input
              placeholder="Licence"
              value={draft.license}
              onChange={(e) => setDraft({ ...draft, license: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.has_people}
                onCheckedChange={(v) => setDraft({ ...draft, has_people: v })}
              />
              People in shot
            </label>
            <Button onClick={add} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add picture"}
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Input
            placeholder="Search the library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
          />
          <span className="text-xs text-muted-foreground">
            {shown.length} of {rows.length}
          </span>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((row) => (
            <Card key={row.id} className={row.active ? "" : "opacity-60"}>
              <CardContent className="space-y-2 p-3">
                <img
                  src={row.url}
                  alt={row.subject}
                  loading="lazy"
                  className="aspect-video w-full rounded-lg object-cover"
                />
                <p className="text-sm font-medium">{row.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {[row.industry, row.mood, row.style, row.location, row.aspect_ratio]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">{row.tags.join(", ")}</p>
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={row.active} onCheckedChange={() => toggle(row)} />
                    {row.active ? "In use" : "Off"}
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The library is empty, so every picture is made from scratch. Add a few and
            builds get faster and more consistent.
          </p>
        ) : null}
      </main>
    </div>
  );
}
