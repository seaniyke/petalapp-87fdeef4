/**
 * "Open that part of Kimble" event bus.
 *
 * Mirrors `service-events.ts`. The server decides which area a message was
 * asking for; the builder listens here and opens it. Kept as a DOM event so
 * any surface (builder, chat, a future dashboard) can subscribe without a
 * shared store.
 */
import type { SurfaceId } from "@/lib/kimble-surfaces";

export type OpenSurfaceDetail = {
  /** Ignored by builders showing a different project. */
  projectId?: string | null;
  surface: SurfaceId;
};

const EVENT_NAME = "petal:open-surface";

export function emitOpenSurface(detail: OpenSurfaceDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenSurfaceDetail>(EVENT_NAME, { detail }));
}

export function onOpenSurface(handler: (detail: OpenSurfaceDetail) => void) {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<OpenSurfaceDetail>;
    if (ce.detail?.surface) handler(ce.detail);
  };
  window.addEventListener(EVENT_NAME, wrapped);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}
