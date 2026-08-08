/**
 * WebsiteInfoSheet — secondary sheet opened from the PublishSheet that lets
 * the project owner edit how their published site appears in browser tabs
 * and link previews:
 *
 *   - Icon (favicon)        — defaults to the Petal flower until uploaded.
 *   - Title                 — defaults to the project's build-time title.
 *   - Description           — defaults to the project's build-time summary.
 *   - Social image (OG)     — defaults to the icon (so links always preview).
 *
 * "Default" here means the worker reads the build-time `title` / `summary`
 * when the matching `site_*` field is empty (see
 * `src/routes/api/public/host-lookup.ts`). We mirror that by pre-populating
 * the inputs with the build-time values so the user sees what visitors will
 * see and can tweak from there.
 */
import { useEffect, useRef, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Loader2, Image as ImageIcon, Upload, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { type ProjectRow } from "@/lib/projects";
import { updateSiteInfo, uploadSiteImage } from "@/lib/site-info";
import { describeAppFallback, iconPromptFor, isAssistantNarration } from "@/lib/site-info-copy";
import { generateSiteInfo } from "@/lib/site-info.functions";
import { supabase } from "@/integrations/supabase/client";
import petalLogo from "@/assets/petal-logo.png";

const TITLE_LIMIT = 60;
const DESC_LIMIT = 160;

/** Build-time summaries are written to the user ("I've built…"); never show
 *  that as the site description — clean it into app-facing copy first. */
function defaultDescription(project: ProjectRow): string {
  const saved = (project.site_description ?? "").trim();
  if (saved) return saved;
  const summary = (project.summary ?? "").trim();
  if (!summary) return "";
  return isAssistantNarration(summary) ? describeAppFallback(summary) : summary.slice(0, DESC_LIMIT);
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRow;
  onChange: (next: ProjectRow) => void;
};

export function WebsiteInfoSheet({ open, onOpenChange, project, onChange }: Props) {
  // Pre-populate inputs with the *effective* values visitors currently see —
  // i.e. the user's saved override, falling back to the project's build-time
  // title/summary. Empty string in state == "use the default".
  const initialTitle = (project.site_title ?? "").trim() || project.title || "";
  const initialDesc = defaultDescription(project);
  const initialIcon = project.site_icon_url ?? null;
  const initialOg = project.site_og_image_url ?? null;

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDesc);
  const [iconUrl, setIconUrl] = useState<string | null>(initialIcon);
  const [ogUrl, setOgUrl] = useState<string | null>(initialOg);
  const [iconUploading, setIconUploading] = useState(false);
  const [ogUploading, setOgUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false);
  const [drawingIcon, setDrawingIcon] = useState(false);

  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const ogInputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed the form whenever the sheet re-opens for a different project.
  useEffect(() => {
    if (!open) return;
    setTitle((project.site_title ?? "").trim() || project.title || "");
    setDescription(defaultDescription(project));
    setIconUrl(project.site_icon_url ?? null);
    setOgUrl(project.site_og_image_url ?? null);
  }, [open, project]);

  /** Ask Petal to write the title + description from what the app actually is. */
  async function writeWithAi() {
    setWriting(true);
    try {
      const result = await generateSiteInfo({
        data: {
          title: project.title || title,
          summary: project.summary || "",
          prompt: description || "",
        },
      });
      if (result.title) setTitle(result.title.slice(0, TITLE_LIMIT));
      if (result.description) setDescription(result.description.slice(0, DESC_LIMIT));
      toast.success("Petal wrote your title & description");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write it");
    } finally {
      setWriting(false);
    }
  }

  /** Generate a favicon/app icon that matches the project. */
  async function drawIconWithAi() {
    setDrawingIcon(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const resp = await fetch("/api/generate-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: iconPromptFor(title || project.title || "", description),
          aspectRatio: "1:1",
          projectId: project.id,
        }),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Couldn't generate icon (${resp.status})`);
      }
      const { url } = (await resp.json()) as { url: string };
      setIconUrl(url);
      toast.success("Icon generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate icon");
    } finally {
      setDrawingIcon(false);
    }
  }


  async function handleIconPick(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      toast.error("Icon must be under 1 MB.");
      return;
    }
    setIconUploading(true);
    try {
      const url = await uploadSiteImage(project.id, "icon", file);
      setIconUrl(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload icon");
    } finally {
      setIconUploading(false);
    }
  }

  async function handleOgPick(file: File | undefined) {
    if (!file) return;
    if (file.size > 4_000_000) {
      toast.error("Social image must be under 4 MB.");
      return;
    }
    setOgUploading(true);
    try {
      const url = await uploadSiteImage(project.id, "og", file);
      setOgUrl(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload image");
    } finally {
      setOgUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      // Send `null` when the user cleared the field back to "use default".
      // We treat the input matching the build-time fallback as "still
      // default" so we don't store a redundant copy that would later fight
      // the project title if the user renamed the project.
      const titleOverride =
        title.trim() && title.trim() !== (project.title || "").trim()
          ? title.trim()
          : null;
      const descOverride =
        description.trim() &&
        description.trim() !== (project.summary || "").trim()
          ? description.trim()
          : null;

      const result = await updateSiteInfo({
        projectId: project.id,
        site_title: titleOverride,
        site_description: descOverride,
        site_icon_url: iconUrl,
        site_og_image_url: ogUrl,
      });
      onChange({
        ...project,
        site_title: result.project.site_title,
        site_description: result.project.site_description,
        site_icon_url: result.project.site_icon_url,
        site_og_image_url: result.project.site_og_image_url,
      } as ProjectRow);
      toast.success("Website info saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  // Effective preview values — what the worker will actually inject right now.
  const previewIcon = iconUrl || petalLogo;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="sr-only">Website info</DrawerTitle>

        <div className="mt-2">
          <h2 className="text-xl font-semibold tracking-tight">Website info</h2>
          <p className="text-xs text-muted-foreground">
            How your site appears in browser tabs, search results, and shared links.
          </p>
        </div>

        {/* Let Petal write the copy and draw the icon from the project itself */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={writeWithAi}
            disabled={writing}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted disabled:opacity-60"
          >
            {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Write with Petal
          </button>
          <button
            type="button"
            onClick={drawIconWithAi}
            disabled={drawingIcon}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted disabled:opacity-60"
          >
            {drawingIcon ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate icon
          </button>
        </div>

        {/* Icon + title row, mirroring the Lovable publish dialog layout */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Icon &amp; title</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {title.length}/{TITLE_LIMIT}
            </span>
          </div>
          <div className="flex items-stretch gap-2">
            {/* Icon — click to upload */}
            <button
              type="button"
              onClick={() => iconInputRef.current?.click()}
              disabled={iconUploading || drawingIcon}
              className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-card transition hover:bg-muted disabled:opacity-60"
              aria-label="Change icon"
              title="Change icon"
            >
              {iconUploading || drawingIcon ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <img
                  src={previewIcon}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
            </button>

            <input
              ref={iconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                handleIconPick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_LIMIT))}
              placeholder={project.title || "Your site title"}
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
          </div>
          {iconUrl && (
            <button
              type="button"
              onClick={() => setIconUrl(null)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to Petal logo
            </button>
          )}
        </div>

        {/* Description */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Description</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {description.length}/{DESC_LIMIT}
            </span>
          </div>
          <textarea
            value={description}
            onChange={(e) =>
              setDescription(e.target.value.slice(0, DESC_LIMIT))
            }
            placeholder={project.summary || "What is your site about?"}
            rows={3}
            className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </div>

        {/* Social image */}
        <div className="mt-4 space-y-2">
          <span className="text-sm font-medium">Social image</span>
          <button
            type="button"
            onClick={() => ogInputRef.current?.click()}
            disabled={ogUploading}
            className="relative flex aspect-[1.91/1] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-card text-muted-foreground transition hover:bg-muted disabled:opacity-60"
          >
            {ogUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : ogUrl ? (
              <img src={ogUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs">
                <ImageIcon className="h-5 w-5" />
                <span>1200×630 recommended · tap to upload</span>
              </div>
            )}
          </button>
          <input
            ref={ogInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              handleOgPick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {ogUrl && (
            <button
              type="button"
              onClick={() => setOgUrl(null)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Remove social image
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || iconUploading || ogUploading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Save
          </button>
        </div>

      </DrawerContent>
    </Drawer>
  );
}
