/**
 * CloudEmptyState — shared empty/error message reused by Cloud sub-views
 * when the project has no managed backend or the backend isn't ready yet.
 */
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  description: string;
  /** Optional callback rendered as a primary CTA. */
  ctaLabel?: string;
  onCta?: () => void;
};

export function CloudEmptyState({ title, description, ctaLabel, onCta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-muted/40 p-8 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground">
        <CloudOff className="h-5 w-5" />
      </div>
      <div>
        <div className="text-base font-semibold">{title}</div>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {ctaLabel && onCta && (
        <Button size="sm" onClick={onCta} className="mt-1">
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
