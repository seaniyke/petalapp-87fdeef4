/**
 * The most watchable moment of a build: the pictures Kimble makes, popping in
 * one at a time as each one is ready.
 */
import { ImageIcon } from "lucide-react";

type Props = {
  /** Public URLs, oldest first. */
  urls: string[];
  /** True while more pictures may still arrive — shows a waiting tile. */
  pending?: boolean;
};

export function ImageStrip({ urls, pending }: Props) {
  if (urls.length === 0 && !pending) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-3.5 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {urls.slice(-8).map((url, i) => (
        <img
          key={url}
          src={url}
          alt=""
          loading="lazy"
          style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
          className="h-11 w-14 shrink-0 animate-scale-in rounded-lg border border-border/60 object-cover motion-reduce:animate-none"
        />
      ))}
      {pending && (
        <span className="inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/40 text-muted-foreground/60">
          <ImageIcon className="h-4 w-4 animate-pulse motion-reduce:animate-none" aria-hidden />
        </span>
      )}
    </div>
  );
}
