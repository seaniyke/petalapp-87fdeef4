import { createRouter, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";

/**
 * After a redeploy, in-memory dynamic imports point at chunk filenames that
 * no longer exist on the CDN (`assets/projects-CXT8dJWd.js → 404`). The
 * browser surfaces this as a `ChunkLoadError` / "Failed to fetch dynamically
 * imported module" / "error loading dynamically imported module". A hard
 * reload pulls a fresh `index.html` whose <script> tags reference the new
 * hashed chunks, which fixes the issue without any user action.
 *
 * We guard with sessionStorage so a *real* error (not a stale-chunk one) that
 * happens to match the heuristic doesn't put us in an infinite reload loop.
 */
const RELOAD_GUARD_KEY = "petal:chunk-reload-attempted";

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \S+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Unable to preload CSS/i.test(msg)
  );
}

function tryReloadOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    /* sessionStorage may be unavailable — fall through to reload anyway */
  }
  // Bypass any HTTP cache so we get the freshly-deployed index.html.
  window.location.reload();
  return true;
}

function clearReloadGuard() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* ignore */
  }
}

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const chunkError = isChunkLoadError(error);

  // Auto-recover from stale-chunk errors after a redeploy by hard-reloading
  // once. If the reload still fails we fall through to the manual error UI
  // (the guard prevents an infinite loop).
  useEffect(() => {
    if (chunkError) {
      tryReloadOnce();
    } else {
      // Any non-chunk error means we successfully rendered new code, so reset
      // the guard for future deploys.
      clearReloadGuard();
    }
  }, [chunkError]);

  // While the reload is in flight, render a neutral splash instead of the
  // alarming "Something went wrong" card.
  if (chunkError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Updating to the latest version…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Catch dynamic-import failures that happen *outside* the router error
 * boundary (e.g. a Suspense lazy() in a component, an event handler, a
 * background prefetch). Same recovery strategy: one silent hard reload.
 */
function installGlobalChunkErrorRecovery() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __petalChunkRecoveryInstalled?: boolean };
  if (w.__petalChunkRecoveryInstalled) return;
  w.__petalChunkRecoveryInstalled = true;

  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.error ?? event.message)) {
      tryReloadOnce();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      tryReloadOnce();
    }
  });
}

installGlobalChunkErrorRecovery();

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
