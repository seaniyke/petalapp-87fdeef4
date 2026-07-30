/**
 * The two moments that matter in publishing: "we're pushing it" and
 * "it's live, go tell people".
 *
 * Both are rendered as the ONLY content of <PublishSheet /> while they're
 * active, so the sheet becomes a focused, celebratory beat instead of a
 * status line buried above a settings list.
 */
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function PublishingCard({ isUpdate }: { isUpdate: boolean }) {
  return (
    <div className="px-2 py-10 text-center sm:py-14">
      <span
        className="mx-auto block h-9 w-9 animate-spin rounded-full border-[3px] border-muted-foreground/25 border-t-foreground motion-reduce:animate-none"
        aria-hidden
      />
      <h3 className="mt-6 text-lg font-extrabold tracking-tight">
        {isUpdate ? "Updating your project" : "Publishing your project"}
      </h3>
      <p className="mx-auto mt-2 max-w-[19rem] text-[15px] font-medium leading-snug text-muted-foreground">
        This can take a minute or two. You can close this and keep chatting with Petal.
      </p>
    </div>
  );
}

type ShareTarget = {
  id: string;
  label: string;
  href: (url: string, text: string) => string;
  icon: (props: { className?: string }) => React.ReactElement;
};

const SHARE_TARGETS: ShareTarget[] = [
  {
    id: "x",
    label: "Share on X",
    href: (url, text) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    icon: ({ className }) => (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    id: "linkedin",
    label: "Share on LinkedIn",
    href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    icon: ({ className }) => (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.71h.05c.53-.95 1.83-1.96 3.77-1.96 4.03 0 4.78 2.5 4.78 5.76V21h-4v-5.6c0-1.34-.03-3.07-1.9-3.07-1.9 0-2.2 1.46-2.2 2.97V21H9z" />
      </svg>
    ),
  },
  {
    id: "reddit",
    label: "Share on Reddit",
    href: (url, text) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
    icon: ({ className }) => (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M22 11.2a2.3 2.3 0 0 0-3.9-1.63c-1.5-.98-3.5-1.6-5.7-1.68l1.12-3.53 3.03.71a1.85 1.85 0 1 0 .2-1.2l-3.5-.82a.6.6 0 0 0-.7.4l-1.34 4.23c-2.3.05-4.4.68-5.96 1.7A2.3 2.3 0 1 0 2.9 13.5a4 4 0 0 0-.05.63c0 3.35 4.1 6.07 9.15 6.07s9.15-2.72 9.15-6.07c0-.2-.02-.4-.05-.6A2.3 2.3 0 0 0 22 11.2zM7.6 13.3a1.4 1.4 0 1 1 2.8 0 1.4 1.4 0 0 1-2.8 0zm8.35 4.06c-1.04.9-2.5 1.18-3.95 1.18s-2.91-.28-3.95-1.18a.55.55 0 1 1 .72-.83c.77.66 1.98.9 3.23.9s2.46-.24 3.23-.9a.55.55 0 1 1 .72.83zm-.35-2.66a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8z" />
      </svg>
    ),
  },
  {
    id: "whatsapp",
    label: "Share on WhatsApp",
    href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    icon: ({ className }) => (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12.04 2A9.9 9.9 0 0 0 2.1 11.9c0 1.75.46 3.46 1.34 4.96L2 22l5.28-1.38a9.9 9.9 0 0 0 4.76 1.21h.01a9.9 9.9 0 0 0 9.94-9.9A9.9 9.9 0 0 0 12.04 2zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.13.82.84-3.05-.2-.31a8.2 8.2 0 1 1 6.97 3.87zm4.5-6.14c-.24-.12-1.45-.72-1.68-.8-.22-.09-.39-.13-.55.12s-.63.8-.78.96c-.14.17-.28.18-.52.06a6.7 6.7 0 0 1-1.98-1.22 7.4 7.4 0 0 1-1.36-1.7c-.14-.24 0-.37.11-.5l.36-.42c.12-.14.16-.24.24-.4.08-.17.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3c-.22.25-.85.83-.85 2.02s.87 2.35.99 2.51c.12.17 1.71 2.61 4.15 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.45-.59 1.65-1.17.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z" />
      </svg>
    ),
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
    <div className="px-1 pb-1 pt-6 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_20%,oklch(0.72_0.19_320),oklch(0.68_0.22_20)_70%)] text-white shadow-lg animate-fade-in motion-reduce:animate-none">
        <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
      </span>

      <h3 className="mt-5 text-xl font-extrabold tracking-tight">
        {isUpdate ? "Your website was updated" : "Your website is live"}
      </h3>
      <p className="mt-1.5 text-[15px] font-medium text-muted-foreground">
        {isUpdate ? "Share what's new." : "Share what you built."}
      </p>

      {url && (
        <div className="mt-5 flex items-center justify-center gap-5">
          {SHARE_TARGETS.map((t) => (
            <a
              key={t.id}
              href={t.href(url, shareText)}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t.label}
              title={t.label}
              className="grid h-10 w-10 place-items-center rounded-full text-foreground/80 transition hover:bg-muted hover:text-foreground active:scale-95"
            >
              <t.icon className="h-5 w-5" />
            </a>
          ))}
        </div>
      )}

      {/* Live social/SEO preview — exactly what a link unfurl will show. */}
      <div className="mt-6 rounded-2xl border border-border/70 bg-muted/25 text-left">
        <div className="p-4">
          <div className="flex items-center gap-2">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="h-4 w-4 rounded-sm object-cover" />
            ) : (
              <span className="h-4 w-4 rounded-sm bg-primary/25" aria-hidden />
            )}
            <span className="truncate text-[15px] font-bold text-primary">{title}</span>
          </div>
          {display && (
            <p className="mt-1 truncate text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
              {display}
            </p>
          )}
          {description && (
            <p className="mt-1.5 line-clamp-2 text-[13px] font-medium text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {onEditWebsiteInfo && (
          <button
            type="button"
            onClick={onEditWebsiteInfo}
            className="flex w-full items-center gap-2 border-t border-border/70 px-4 py-3 text-left text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <span className="grid h-4 w-4 place-items-center rounded-full border border-current text-[10px]">
              i
            </span>
            Ask Petal to edit your title, description &amp; icon
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={copy}
          disabled={!url}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-[15px] font-bold transition hover:bg-muted disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noreferrer noopener"
          className={`inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-3 text-[15px] font-bold text-background transition hover:opacity-90 ${
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
          className="mt-3 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Back to publish settings
        </button>
      )}
    </div>
  );
}
