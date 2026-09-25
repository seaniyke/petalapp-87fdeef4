import type { ReactNode } from "react";

/** Raised panel that follows the Kimble Test System card rules. */
export function Surface({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">{children}</div>
  );
}
