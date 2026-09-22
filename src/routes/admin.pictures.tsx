/**
 * Admin → Pictures.
 *
 * Internal only. The curated picture library the builder searches before it
 * generates anything.
 *
 * The form is deliberately small: choose a file, say what it shows, pick a
 * category. Shape, ratio and licence are worked out from the file itself.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { Pager, usePaged } from "@/components/Pager";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const INDUSTRIES = [
  "restaurant",
  "cafe",
  "retail",
  "fashion",
  "beauty",
  "fitness",
  "health",
  "travel",
  "hotel",
  "property",
  "construction",
  "automotive",
  "finance",
  "legal",
  "education",
  "software",
  "agency",
  "events",
  "music",
  "sports",
  "nonprofit",
  "agriculture",
  "logistics",
  "pets",
];

const MOODS = [
  "warm",
  "calm",
  "bright",
  "moody",
  "bold",
  "minimal",
  "luxury",
  "playful",
  "natural",
  "industrial",
  "nostalgic",
  "energetic",
];

const STYLES = [
  "photography",
  "portrait",
  "product",
  "interior",
  "landscape scene",
  "street",
  "aerial",
  "food",
  "texture",
  "illustration",
  "3d render",
  "screenshot",
];

/** Everything the library needs about a chosen file, read from the file itself. */
type Measured = { file: File; preview: string; orientation: string; ratio: string };

function nearestRatio(w: number, h: number): string {
  const options: Array<[string, number]> = [
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:2", 3 / 2],
    ["16:9", 16 / 9],
    ["21:9", 21 / 9],
    ["3:4", 3 / 4],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
  ];
  const actual = w / h;
  let best = options[0];
  for (const o of options) {
    if (Math.abs(o[1] - actual) < Math.abs(best[1] - actual)) best = o;
  }
  return best[0];
}

function measure(file: File): Promise<Measured> {
  return new Promise((resolve, reject) => {
    const preview = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const orientation =
        img.width > img.height * 1.1
          ? "landscape"
          : img.height > img.width * 1.1
            ? "portrait"
            : "square";
      resolve({ file, preview, orientation, ratio: nearestRatio(img.width, img.height) });
    };
    img.onerror = () => reject(new Error("That file could not be read as a picture."));
    img.src = preview;
  });
}

function AdminPicturesPage() {
  const { ready } = useAdminGuard("/admin/pictures");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<Measured | null>(null);
  const [subject, setSubject] = useState("");
  const [industry, setIndustry] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("photography");
  const [hasPeople, setHasPeople] = useState(false);

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

  function reset() {
    if (picked) URL.revokeObjectURL(picked.preview);
    setPicked(null);
    setSubject("");
    setIndustry("");
    setMood("");
    setStyle("photography");
    setHasPeople(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("That picture is over 10MB.");
      return;
    }
    try {
      const m = await measure(file);
      if (picked) URL.revokeObjectURL(picked.preview);
      setPicked(m);
      if (!subject) {
        setSubject(file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 80));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That file could not be read.");
    }
  }

  async function add() {
    if (!picked) {
      toast.error("Choose a picture first.");
      return;
    }
    if (!subject.trim()) {
      toast.error("Say what the picture shows.");
      return;
    }
    setSaving(true);
    try {
      const ext = picked.file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `library/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("petal-images")
        .upload(path, picked.file, { contentType: picked.file.type, cacheControl: "31536000" });
      if (upErr) throw upErr;
      const url = supabase.storage.from("petal-images").getPublicUrl(path).data.publicUrl;

      const { error } = await supabase.from("design_pictures").insert({
        url,
        subject: subject.trim(),
        industry: industry || null,
        mood: mood || null,
        style: style || null,
        location: null,
        orientation: picked.orientation,
        aspect_ratio: picked.ratio,
        has_people: hasPeople,
        tags: [industry, mood, style].filter(Boolean) as string[],
        license: "owned",
      });
      if (error) throw error;

      reset();
      toast.success("Picture added");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That picture could not be saved.");
    } finally {
      setSaving(false);
    }
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
  const paged = usePaged(shown, 24);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold">Pictures</h1>
          <p className="text-sm text-muted-foreground">
            The builder looks here first and only makes a new picture when nothing fits.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-3 p-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void choose(e.target.files?.[0])}
            />

            {picked ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="block w-full overflow-hidden rounded-lg border border-border"
              >
                <img
                  src={picked.preview}
                  alt="Chosen picture"
                  className="aspect-video w-full object-cover"
                />
              </button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-28 w-full"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                Choose a picture
              </Button>
            )}

            <Input
              placeholder="What does it show? e.g. modern coffee shop interior"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger>
                  <SelectValue placeholder="Industry" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={mood} onValueChange={setMood}>
                <SelectTrigger>
                  <SelectValue placeholder="Mood" />
                </SelectTrigger>
                <SelectContent>
                  {MOODS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger>
                  <SelectValue placeholder="Kind of picture" />
                </SelectTrigger>
                <SelectContent>
                  {STYLES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={hasPeople} onCheckedChange={setHasPeople} />
                People in shot
              </label>
              <Button onClick={add} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add picture"}
              </Button>
            </div>
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
          {paged.slice.map((row) => (
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
                  {[row.industry, row.mood, row.style, row.aspect_ratio]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
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

        <Pager
          page={paged.page}
          pageCount={paged.pageCount}
          total={paged.total}
          pageSize={paged.pageSize}
          onPage={paged.setPage}
          noun="pictures"
          className="mt-4 rounded-2xl border border-border"
        />

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
