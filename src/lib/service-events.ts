/**
 * Service activation event bus.
 *
 * When a service (Petal Email, managed backend, custom domain, etc.) is
 * enabled from anywhere in the app, fire `emitServiceEnabled(...)`. The
 * builder route listens and streams a friendly assistant message into the
 * active chat — letting users feel the activation rather than just seeing a
 * toast that disappears.
 */

export type ServiceKind = "email" | "backend" | "domain" | "shield" | string;

export type ServiceEnabledDetail = {
  /** Project the service was enabled for. The builder ignores events that
   *  don't match its currently-open project. */
  projectId: string;
  /** Short slug identifying the service (used for icon / phrasing). */
  service: ServiceKind;
  /** Human-readable service name, e.g. "Petal Email". */
  label: string;
  /** Optional one-line summary of what just got turned on. */
  summary?: string;
};

const EVENT_NAME = "petal:service-enabled";

export function emitServiceEnabled(detail: ServiceEnabledDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ServiceEnabledDetail>(EVENT_NAME, { detail }));
}

export function onServiceEnabled(handler: (detail: ServiceEnabledDetail) => void) {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<ServiceEnabledDetail>;
    if (ce.detail) handler(ce.detail);
  };
  window.addEventListener(EVENT_NAME, wrapped);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}
