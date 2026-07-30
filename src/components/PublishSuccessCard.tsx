/**
 * The two moments that matter in publishing: "we're pushing it" and
 * "it's live, go tell people".
 *
 * Rendered inside <PublishSheet /> above the rest of the controls so the
 * user gets a clear, celebratory beat instead of a silent toast.
 */
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function PublishingCard({ isUpdate }: { isUpdate: boolean }) {
  return (
    <div className="mt-2 rounded-2xl border border-border/70 bg-card p-6 text-center">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" aria-hidden />
      <h3 className="mt-3 text-base font-bold tracking-tight">
        {isUpdate ? "Updating your app" : "Publishing your app"}
      </h3>
      <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
        This takes a minute or two. You can close this and keep building — we'll finish in the
        background.
      </p>
    </div>
  );
}

type ShareTarget = { id: string; label: string; href: (url: string, text: string) => string };

const SHARE_TARGETS: ShareTarget[] = [
  {
    id: "x",
    label: "X",
    href: (url, text) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    href: (url, text) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
];

export function PublishSuccessCard({
  isUpdate,
  url,
  display,
  title,
  description,
  iconUrl,
  onEditWebsiteInfo,
  onDismiss,
}: {
  isUpdate: boolean;
  url: string | null;
  display: string | null;
  title: string;
  description?: string | null;
  iconUrl?: string | null;
  onEditWebsiteInfo?: () => void;
  onDismiss?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareText = isUpdate ? `Just shipped an update to ${title}` : `I just built ${title} 🌸`;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <div className="mt-2 rounded-2xl border border-border/70 bg-card p-5 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-primary animate-fade-in motion-reduce:animate-none">
        <Check className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="mt-3 text-base font-bold tracking-tight">
        {isUpdate ? "Your app was updated" : "Your app is live"}
      </h3>
      <p className="mt-1 text-sm font-medium text-muted-foreground">Share what you built.</p>

      {url && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {SHARE_TARGETS.map((t) => (
            <a
              key={t.id}
              href={t.href(url, shareText)}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold transition hover:bg-muted"
            >
              {t.label}
            </a>
          ))}
        </div>
      )}

      {/* Live social/SEO preview — exactly what a link unfurl will show. */}
      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-left">
        <div className="flex items-center gap-2">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="h-4 w-4 rounded-sm object-cover" />
          ) : (
            <span className="h-4 w-4 rounded-sm bg-primary/25" aria-hidden />
          )}
          <span className="truncate text-sm font-bold text-primary">{title}</span>
        </div>
        {display && (
          <p className="mt-0.5 truncate text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {display}
          </p>
        )}
        {description && (
          <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground">
            {description}
          </p>
        )}
        {onEditWebsiteInfo && (
          <button
            type="button"
            onClick={onEditWebsiteInfo}
            className="mt-2 text-[11px] font-semibold text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
          >
            Ask Petal to change the title, description or icon
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={!url}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold transition hover:bg-muted disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noreferrer noopener"
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 ${
            url ? "" : "pointer-events-none opacity-40"
          }`}
        >
          Visit site
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Back to publish settings
        </button>
      )}
    </div>
  );
}
