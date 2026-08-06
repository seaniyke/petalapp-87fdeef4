/**
 * H3 — copy an assistant message to the clipboard.
 *
 * Deliberately always present in the DOM (not hover-only) so it is reachable
 * by keyboard and on touch, but it sits at low contrast until hovered or
 * focused so it never competes with the message itself.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  if (!text.trim()) return null;

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      aria-label={copied ? "Message copied" : "Copy message"}
      className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
