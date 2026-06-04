/**
 * Phase 13 — Data + state defaults.
 *
 * Ships the substance layer every modern React app needs:
 *   - TanStack Query (`QueryClient` + `QueryClientProvider`)
 *   - Zustand example store (typed + persisted)
 *   - nuqs `useQueryState` wrapper for URL-synced filters/tabs/dialogs
 *   - A single `<AppProviders>` that composes them with sonner Toaster
 *
 * The AI imports these from stable paths and never has to invent the
 * QueryClient wiring or hand-roll `useEffect + fetch + useState` ad-hoc data
 * fetching that every model defaults to without scaffolded primitives.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// ---------------------------------------------------------------------------
// TanStack Query — shared QueryClient factory
// ---------------------------------------------------------------------------
const QUERY_CLIENT = `import { QueryClient } from "@tanstack/react-query";

/**
 * Single shared QueryClient instance for the app.
 *
 * Sensible defaults:
 *   - staleTime: 30s  → avoid refetching the moment a component re-renders
 *   - gcTime:    5m   → keep recently-unmounted queries warm for nav back
 *   - retry:     1    → don't hammer broken endpoints
 *   - refetchOnWindowFocus: false → off by default (most product surfaces
 *     don't want it). Flip on per-query with \`refetchOnWindowFocus: true\`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});
`;

// ---------------------------------------------------------------------------
// Providers — wraps QueryClient + nuqs URL state adapter + Toaster
// ---------------------------------------------------------------------------
const APP_PROVIDERS = `import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/query-client";

/**
 * Top-level providers. Wrap your <App /> tree with this once in main.tsx:
 *
 *   import { AppProviders } from "@/components/providers/app-providers";
 *   createRoot(el).render(<AppProviders><App /></AppProviders>);
 *
 * Includes:
 *   - TanStack Query (data fetching + caching)
 *   - nuqs (typed URL search-params for filters/tabs/dialogs)
 *   - sonner <Toaster /> (toast notifications)
 *
 * The NuqsAdapter is the react-router-v6 variant since the scaffold ships
 * react-router-dom. If the project drops the router, swap to
 * \`nuqs/adapters/react\` (plain history adapter).
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
`;

// ---------------------------------------------------------------------------
// Zustand example store — typed + persisted
// ---------------------------------------------------------------------------
const EXAMPLE_STORE = `import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Reference Zustand store. Copy/rename for app-specific state (cart, filters,
 * playback, wizard step, etc.). Keep slices small and colocated with the
 * feature that owns them — do NOT make this a god-store.
 *
 * Pattern:
 *   const count = useExampleStore((s) => s.count);   // subscribe to one slice
 *   const inc = useExampleStore((s) => s.increment); // stable action ref
 */
type ExampleState = {
  count: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
};

export const useExampleStore = create<ExampleState>()(
  persist(
    (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
      decrement: () => set((s) => ({ count: s.count - 1 })),
      reset: () => set({ count: 0 }),
    }),
    {
      name: "petal-example-store",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
`;

// ---------------------------------------------------------------------------
// nuqs — URL-synced state hooks
// ---------------------------------------------------------------------------
const USE_QUERY_STATE = `/**
 * Re-export the nuqs hooks under \`@/hooks/use-query-state\` so the AI has a
 * stable, discoverable path for URL-synced state. Use this for anything that
 * should survive a page reload or be shareable via link:
 *
 *   - active tab           useQueryState("tab", parseAsString.withDefault("overview"))
 *   - search input         useQueryState("q")
 *   - dialog open state    useQueryState("dialog", parseAsString)
 *   - filters / sort       useQueryStates({ sort: parseAsString, dir: parseAsStringEnum(["asc","desc"]) })
 *
 * nuqs is debounced + SSR-safe + type-safe. Prefer it over useState for any
 * piece of UI state that maps to a URL.
 */
export {
  useQueryState,
  useQueryStates,
  parseAsString,
  parseAsInteger,
  parseAsFloat,
  parseAsBoolean,
  parseAsIsoDateTime,
  parseAsArrayOf,
  parseAsJson,
  parseAsStringEnum,
  parseAsStringLiteral,
} from "nuqs";
`;

// ---------------------------------------------------------------------------
// Reference: useQuery + server-action pattern doc (model copies from this)
// ---------------------------------------------------------------------------
const DATA_PATTERNS_DOC = `# Data fetching — the default Petal pattern

The scaffold ships TanStack Query, Zustand, and nuqs. Use them in this order
before reaching for \`useEffect + fetch + useState\` (which you should basically
never write):

## 1. Server state → TanStack Query

\`\`\`tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

function ProjectsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<Project[]>;
    },
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorState />;
  return <ul>{data!.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;
}
\`\`\`

Mutations invalidate keys to refetch:

\`\`\`tsx
const qc = useQueryClient();
const create = useMutation({
  mutationFn: (input: NewProject) => fetch("/api/projects", { method: "POST", body: JSON.stringify(input) }).then(r => r.json()),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
});
\`\`\`

## 2. Client/global state → Zustand

Cart, playback, wizard step, theme overrides, ephemeral UI. Keep slices small.
See \`@/lib/stores/example-store.ts\`.

## 3. URL state → nuqs

Tabs, filters, search input, "open dialog" toggles — anything that should
survive reload or be sharable.

\`\`\`tsx
import { useQueryState, parseAsString } from "@/hooks/use-query-state";

const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("all"));
<Tabs value={tab} onValueChange={setTab}>...</Tabs>
\`\`\`

## 4. Local component state → useState

Only for state that is genuinely local and ephemeral (hover, focus, controlled
input mid-edit). Everything else belongs in 1/2/3 above.

---

Wire providers ONCE at the root:

\`\`\`tsx
// src/main.tsx
import { AppProviders } from "@/components/providers/app-providers";
import { BrowserRouter } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AppProviders>
      <App />
    </AppProviders>
  </BrowserRouter>,
);
\`\`\`
`;

export const KIT_DATA_FILES: KitFile[] = [
  { path: "src/lib/query-client.ts", content: QUERY_CLIENT, overwrite: true },
  { path: "src/components/providers/app-providers.tsx", content: APP_PROVIDERS, overwrite: true },
  { path: "src/lib/stores/example-store.ts", content: EXAMPLE_STORE, overwrite: true },
  { path: "src/hooks/use-query-state.ts", content: USE_QUERY_STATE, overwrite: true },
  { path: "src/components/examples/DATA_PATTERNS.md", content: DATA_PATTERNS_DOC, overwrite: true },
];
