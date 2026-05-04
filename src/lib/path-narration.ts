/**
 * Turn a file path Petal is currently writing into a single warm,
 * human sentence — so the activity card "talks" while building, instead
 * of dumping a raw `src/routes/foo.tsx` path at the user.
 *
 * Pure, dependency-free, runs on every keystroke of the SSE stream.
 * Safe for both client and server.
 *
 * Style: present-continuous, lower-case verb, no trailing period.
 * Examples:
 *   src/routes/diagnose.tsx          → "Building the diagnose page"
 *   src/components/UploadCard.tsx    → "Adding the upload card"
 *   src/routes/api/analyze.ts        → "Wiring the analyze endpoint"
 *   src/server/vision.server.ts      → "Wiring the vision server logic"
 *   supabase/migrations/...sql       → "Setting up the database"
 *   src/styles.css                   → "Polishing the visual design"
 */

const COMPONENT_VERBS = ["Adding", "Crafting", "Building", "Designing"];
const ROUTE_VERBS = ["Building", "Setting up", "Creating"];
const API_VERBS = ["Wiring", "Connecting", "Hooking up"];

function humanize(name: string): string {
  // FooBarCard → "foo bar card"; foo-bar → "foo bar"; foo_bar → "foo bar".
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pick<T>(arr: T[], seed: string): T {
  // Deterministic pick so the same path always yields the same verb —
  // avoids the verb flickering on every keystroke as React re-renders.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}

export function pathToNarration(path: string | undefined | null): string | null {
  if (!path) return null;
  const p = path.replace(/^\/+/, "");

  // Database / backend infra
  if (p.startsWith("supabase/migrations/")) return "Setting up the database";
  if (p === "supabase/config.toml") return "Configuring the backend";
  if (p.startsWith("supabase/functions/")) {
    const name = humanize(p.split("/")[2] ?? "function");
    return `Deploying the ${name} backend function`;
  }

  // Styles / design tokens
  if (p === "src/styles.css" || p === "tailwind.config.ts") {
    return "Polishing the visual design";
  }
  if (p.endsWith(".css")) return "Refining the styles";

  // Server functions / RPC
  if (p.startsWith("src/server/") || /\.server\.tsx?$/.test(p)) {
    const base = p.split("/").pop()!.replace(/\.server\.tsx?$/, "").replace(/\.tsx?$/, "");
    const name = humanize(base);
    return `${pick(API_VERBS, p)} the ${name} server logic`;
  }

  // API routes
  if (p.startsWith("src/routes/api/")) {
    const base = p.split("/").pop()!.replace(/\.tsx?$/, "");
    const name = humanize(base.replace(/^\$/, ""));
    return `${pick(API_VERBS, p)} the ${name} endpoint`;
  }

  // Page routes
  if (p.startsWith("src/routes/")) {
    const base = p.split("/").pop()!.replace(/\.tsx?$/, "");
    if (base === "index" || base === "__root") return "Crafting the home page";
    if (base === "_app") return "Setting up the app shell";
    const name = humanize(base.replace(/^\$/, "").replace(/^_/, ""));
    return `${pick(ROUTE_VERBS, p)} the ${name} page`;
  }

  // Components
  if (p.startsWith("src/components/")) {
    const base = p.split("/").pop()!.replace(/\.tsx?$/, "");
    const name = humanize(base);
    return `${pick(COMPONENT_VERBS, p)} the ${name}`;
  }

  // Hooks
  if (p.startsWith("src/hooks/")) {
    const base = p.split("/").pop()!.replace(/\.tsx?$/, "");
    const name = humanize(base.replace(/^use-?/i, ""));
    return `Adding the ${name} hook`;
  }

  // Lib / utils
  if (p.startsWith("src/lib/") || p.startsWith("src/utils/")) {
    const base = p.split("/").pop()!.replace(/\.tsx?$/, "");
    const name = humanize(base);
    return `Adding the ${name} helper`;
  }

  // Assets / images
  if (/^src\/assets\//.test(p) || /\.(png|jpg|jpeg|webp|svg)$/i.test(p)) {
    return "Generating the artwork";
  }

  // Config files
  if (/^(vite\.config|tsconfig|package\.json|bun\.lockb)/.test(p)) {
    return "Updating the project setup";
  }

  // Fallback: humanize the filename only.
  const base = p.split("/").pop() ?? p;
  return `Working on ${humanize(base) || base}`;
}
