/**
 * M1 — deferred sheet mounting.
 *
 * The builder used to mount ~20 sheets/dialogs unconditionally, so every
 * project load paid for data hooks and DOM of surfaces the user may never
 * open. `LazySheet` mounts its child the first time `open` flips true and
 * keeps it mounted afterwards, so exit animations and internal state still
 * behave exactly as before.
 */
import { useEffect, useState, type ReactNode } from "react";

export function LazySheet({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted ? <>{children}</> : null;
}
