/**
 * Stream-time autofixer (Tier 2).
 *
 * Runs over each generated/patched file's content AFTER the AI emits it and
 * BEFORE we hand it to the build. Pure regex — no model call, <10ms per file.
 *
 * Fixes known footguns we keep seeing in generated apps:
 *   1. Direct imports from "react-router-dom"        → "@/components/ui/router"
 *   2. Direct imports from "@supabase/supabase-js"   → "@/integrations/backend/client"
 *      only when the backend kit is present (type-only imports stay alone)
 *   3. <input type="date">                           → noted (cannot rewrite JSX safely; logged)
 *   4. lucide-react icons that don't exist           → swapped for nearest valid icon
 *   5. Petal-image:// placeholders > 6 unique        → first 6 kept, rest stripped to picsum
 *
 * Each fix logs to the returned report so we can surface a "auto-corrected N
 * issues" status in the chat.
 */

// @ts-expect-error — lucide-react ships this manifest without a .d.ts entry.
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import type { ProjectFile } from "@/server/generate.server";

export interface AutofixReport {
  fixedCount: number;
  notes: string[];
}

/**
 * Build the valid lucide icon set DYNAMICALLY from lucide-react's official
 * names manifest. This is the only source of truth that won't drift as
 * lucide adds/removes icons. The manifest ships kebab-case names; convert
 * to PascalCase to match how the AI imports them.
 */
const VALID_LUCIDE_ICONS: Set<string> = (() => {
  const set = new Set<string>();
  const names = (dynamicIconImports as Record<string, unknown>) ?? {};
  for (const kebab of Object.keys(names)) {
    const pascal = kebab
      .split("-")
      .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
      .join("");
    if (pascal) set.add(pascal);
  }
  // Aliases / categories not in the manifest but exported by lucide-react.
  set.add("Icon");
  return set;
})();

/** Always-present safe fallback icon. */
const FALLBACK_ICON = "Circle";

/** Common typo → canonical mapping for icons we frequently see broken. */
const ICON_REPAIR_MAP: Record<string, string> = {
  Trashcan: "Trash2",
  Pencil: "Edit3",
  Cog: "Settings",
  Gear: "Settings",
  Cross: "X",
  Tick: "Check",
  Magnifier: "Search",
  Magnify: "Search",
  Bin: "Trash2",
  Cart: "ShoppingCart",
  Bag: "ShoppingBag",
  Picture: "Image",
  Photo: "Camera",
  Cogs: "Settings2",
  Hamburger: "Menu",
  Burger: "Menu",
  Close: "X",
  Dismiss: "X",
  Send2: "Send",
  Envelope: "Mail",
  Email: "Mail",
  Trashbin: "Trash2",
  Refresh: "RefreshCw",
  Reload: "RotateCw",
  Notification: "Bell",
  Notify: "Bell",
  Person: "User",
  People: "Users",
  Chat: "MessageCircle",
  Speech: "MessageSquare",
  Cogwheel: "Settings",
  House: "Home",
  Buildings: "LayoutGrid",
  Graph: "LineChart",
  Chart: "BarChart3",
};

function fixLucideIcons(content: string, report: AutofixReport): string {
  // Track every rename we apply so we can rewrite the same identifiers
  // throughout the rest of the file (JSX usages, type refs, etc.).
  const renames = new Map<string, string>();

  let next = content.replace(
    /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g,
    (_whole, names: string) => {
      const parts = names.split(",").map((s) => s.trim()).filter(Boolean);
      const seenLocals = new Set<string>();
      const fixedParts: string[] = [];
      for (const p of parts) {
        // Handle "Foo as Bar" — local name is Bar, import name is Foo.
        const aliasMatch = p.match(/^(\w+)\s+as\s+(\w+)$/);
        const importName = aliasMatch ? aliasMatch[1] : p;
        const localName = aliasMatch ? aliasMatch[2] : p;

        let resolved: string | null = null;
        if (VALID_LUCIDE_ICONS.has(importName)) {
          resolved = importName;
        } else if (ICON_REPAIR_MAP[importName] && VALID_LUCIDE_ICONS.has(ICON_REPAIR_MAP[importName])) {
          resolved = ICON_REPAIR_MAP[importName];
          report.fixedCount++;
          report.notes.push(`lucide icon ${importName} → ${resolved}`);
        } else {
          // Unknown icon — guarantee the build by aliasing FALLBACK_ICON
          // to the local name the file already uses. This way every JSX
          // <LocalName /> still resolves without rewriting JSX.
          resolved = FALLBACK_ICON;
          report.fixedCount++;
          report.notes.push(`lucide icon ${importName} not found → aliased ${FALLBACK_ICON} as ${localName}`);
        }

        // Re-emit as `Resolved as LocalName` (or bare `Resolved` when they match).
        const emitLocal = localName;
        const entry = resolved === emitLocal ? resolved : `${resolved} as ${emitLocal}`;

        // De-dupe: if we already emitted this local name, skip the duplicate
        // (would happen if two unknown icons both map to FALLBACK_ICON).
        if (seenLocals.has(emitLocal)) continue;
        seenLocals.add(emitLocal);
        fixedParts.push(entry);

        if (importName !== resolved && importName === localName) {
          renames.set(importName, resolved);
        }
      }
      return `import { ${fixedParts.join(", ")} } from "lucide-react"`;
    },
  );

  // Rewrite identifier usages for non-aliased renames (`Foo` → `Bar`) so any
  // JSX/type references still compile.
  for (const [from, to] of renames) {
    next = next.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return next;
}

function fixBadImports(content: string, report: AutofixReport, hasBackendKit: boolean): string {
  let out = content;

  // 1. react-router-dom → kit re-export
  const rrd = /from\s+["']react-router-dom["']/g;
  if (rrd.test(out)) {
    out = out.replace(rrd, 'from "@/components/ui/router"');
    report.fixedCount++;
    report.notes.push('react-router-dom → @/components/ui/router');
  }

  // 2. Direct supabase-js client → backend kit, but only when that kit exists.
  //    Without this guard, no-backend projects get rewritten to an alias that
  //    cannot resolve, causing the exact Vite load-fallback failure reported.
  const sbCreate = /import\s+\{[^}]*createClient[^}]*\}\s+from\s+["']@supabase\/supabase-js["']/g;
  if (hasBackendKit && sbCreate.test(out)) {
    out = out.replace(
      sbCreate,
      'import { supabase } from "@/integrations/backend/client"',
    );
    report.fixedCount++;
    report.notes.push('@supabase/supabase-js createClient → @/integrations/backend/client');
  }

  return out;
}

/** Cap petal-image:// placeholders to 6 unique slugs per file. Beyond that we
 *  swap to picsum so the AI never blows the image budget on one file. */
function capPetalImages(content: string, report: AutofixReport): string {
  const re = /petal-image:\/\/([a-zA-Z0-9_\-%]+)/g;
  const seen = new Set<string>();
  let stripped = 0;
  const out = content.replace(re, (whole, slug: string) => {
    if (seen.has(slug)) return whole; // dedupe — stays as same petal-image
    if (seen.size < 6) {
      seen.add(slug);
      return whole;
    }
    stripped++;
    // Use a deterministic picsum seed derived from slug length so swaps are
    // stable across re-renders.
    return `https://picsum.photos/seed/${slug.slice(0, 16)}/800/600`;
  });
  if (stripped > 0) {
    report.fixedCount += stripped;
    report.notes.push(`petal-image:// budget exceeded — swapped ${stripped} extras to picsum`);
  }
  return out;
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function resolveImportPath(fromPath: string, spec: string, byPath: Map<string, ProjectFile>): string | null {
  const base = spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : spec.startsWith(".")
      ? normalizePath(`${fromPath.split("/").slice(0, -1).join("/")}/${spec}`)
      : null;
  if (!base) return null;
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`];
  return candidates.find((p) => byPath.has(p)) ?? null;
}

function fixLazyNamedExports(files: ProjectFile[], report: AutofixReport): ProjectFile[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const lazyRe = /const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*\)/g;
  const additions = new Map<string, Set<string>>();

  for (const f of files) {
    if (!/\.(tsx?|jsx?)$/.test(f.path) || !f.content.includes("lazy(")) continue;
    let match: RegExpExecArray | null;
    while ((match = lazyRe.exec(f.content))) {
      const componentName = match[1];
      const targetPath = resolveImportPath(f.path, match[2], byPath);
      if (!targetPath) continue;
      const target = byPath.get(targetPath);
      if (!target || /\bexport\s+default\b/.test(target.content)) continue;
      const hasNamedExport = new RegExp(`\\bexport\\s+(?:function|const|let|class)\\s+${componentName}\\b`).test(target.content) ||
        new RegExp(`\\bexport\\s*\\{[^}]*\\b${componentName}\\b[^}]*\\}`).test(target.content);
      if (!hasNamedExport) continue;
      if (!additions.has(targetPath)) additions.set(targetPath, new Set());
      additions.get(targetPath)!.add(componentName);
    }
  }

  if (additions.size === 0) return files;
  return files.map((f) => {
    const names = additions.get(f.path);
    if (!names?.size) return f;
    const [name] = names;
    report.fixedCount++;
    report.notes.push(`React.lazy target ${f.path} default export added`);
    return { ...f, content: `${f.content.trimEnd()}\n\nexport default ${name};\n` };
  });
}

/**
 * Strip JSX comment blocks that wrap commented-out JSX elements.
 *
 * Pattern: `{ /* <Foo .../> *\/ }` (with or without inner braces / props).
 *
 * Why: esbuild's JSX parser rejects empty-comment-only expression containers
 * with "Expected ... but found }" — and even when accepted, inner braces
 * from props like `onClick={fn}` confuse downstream tooling. The model
 * occasionally produces these when it tries to disable a feature (e.g.
 * SignInCard when no backend is connected). Cleanest fix: delete the
 * commented JSX outright. Plain prose comments without a JSX tag are kept.
 */
function stripCommentedOutJsx(content: string, report: AutofixReport): string {
  const re = /\{\s*\/\*[\s\S]*?\*\/\s*\}/g;
  let fixedCount = 0;
  const out = content.replace(re, (match) => {
    const start = match.indexOf("/*") + 2;
    const end = match.lastIndexOf("*/");
    const body = match.slice(start, end);
    if (/<\/?[A-Za-z]/.test(body)) {
      fixedCount++;
      return "";
    }
    return match;
  });
  if (fixedCount > 0) {
    report.fixedCount += fixedCount;
    report.notes.push(`Stripped ${fixedCount} commented-out JSX block(s)`);
  }
  return out;
}

/** Apply autofixers to a single file. Returns the (possibly modified) file. */
export function autofixFile(file: ProjectFile, report: AutofixReport, hasBackendKit = false): ProjectFile {
  // Only run on text files we'd ship to the build. Skip binaries, lockfiles.
  if (!/\.(tsx?|jsx?|css|html|md)$/.test(file.path)) return file;
  if (file.path.startsWith("src/components/ui/") ||
      file.path.startsWith("src/components/examples/") ||
      file.path.startsWith("src/integrations/backend/")) {
    return file; // protected — never modify scaffold
  }
  let content = file.content;
  content = fixBadImports(content, report, hasBackendKit);
  content = fixLucideIcons(content, report);
  content = capPetalImages(content, report);
  if (/\.(tsx|jsx)$/.test(file.path)) {
    content = stripCommentedOutJsx(content, report);
  }
  return content === file.content ? file : { ...file, content };
}


/**
 * When no backend is present, drop any auth pages/components the model
 * scaffolded speculatively and scrub references to them from other files.
 *
 * The model has a persistent habit of emitting `src/pages/SignInPage.tsx`
 * (and friends) for marketing/landing pages with no backend, then later
 * trying to "disable" them and producing broken JSX that fails the build.
 * Without backend the right answer is to OMIT auth entirely — this is the
 * server-side enforcement of the "NO-BACKEND AUTH RULE" prompt directive.
 */
const AUTH_FILE_RE =
  /(^|\/)(SignIn|SignUp|LogIn|Login|Register|SignOut|LogOut|Logout|ForgotPassword|ResetPassword|Auth(Form|Page|Layout|Provider|Card)?|Profile|Account)(Page|View|Screen|Card|Form)?\.tsx?$/i;
const AUTH_IMPORT_RE =
  /^\s*import\s+[^;]*?from\s+["'][^"']*\/(SignIn|SignUp|LogIn|Login|Register|SignOut|LogOut|Logout|ForgotPassword|ResetPassword|Auth(Form|Page|Layout|Provider|Card)?|Profile|Account)(Page|View|Screen|Card|Form)?["'];?\s*\n?/gim;
const AUTH_ROUTE_RE =
  /<Route\b[^>]*\bpath=["']\/?(sign-?in|sign-?up|log-?in|login|register|sign-?out|log-?out|logout|forgot-password|reset-password|auth|account|profile)["'][^>]*\/?>(\s*<\/Route>)?/gi;
const AUTH_LINK_RE =
  /<(Link|NavLink|a)\b[^>]*\b(to|href)=["']\/?(sign-?in|sign-?up|log-?in|login|register|sign-?out|log-?out|logout|forgot-password|reset-password|auth|account|profile)["'][^>]*>[\s\S]*?<\/\1>/gi;

function stripAuthSurface(
  files: ProjectFile[],
  report: AutofixReport,
): ProjectFile[] {
  const dropped: string[] = [];
  const kept = files.filter((f) => {
    // Only target files under user-owned paths. Never touch the scaffold,
    // shadcn primitives, or pre-shipped examples.
    if (f.path.startsWith("src/components/ui/")) return true;
    if (f.path.startsWith("src/components/examples/")) return true;
    if (f.path.startsWith("src/integrations/")) return true;
    if (AUTH_FILE_RE.test(f.path)) {
      dropped.push(f.path);
      return false;
    }
    return true;
  });
  if (dropped.length === 0) return files;
  report.fixedCount += dropped.length;
  report.notes.push(
    `Dropped ${dropped.length} auth file(s) — no backend in this project: ${dropped.join(", ")}`,
  );
  // Scrub references to the dropped files from everything that remains.
  return kept.map((f) => {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) return f;
    let c = f.content;
    const before = c;
    c = c.replace(AUTH_IMPORT_RE, "");
    if (/\.(tsx|jsx)$/.test(f.path)) {
      c = c.replace(AUTH_ROUTE_RE, "");
      c = c.replace(AUTH_LINK_RE, "");
    }
    if (c !== before) {
      report.fixedCount += 1;
      report.notes.push(`Scrubbed auth refs from ${f.path}`);
      return { ...f, content: c };
    }
    return f;
  });
}

/** Apply autofixers across the whole file set. Returns new files + report. */
export function autofixFiles(files: ProjectFile[]): { files: ProjectFile[]; report: AutofixReport } {
  const report: AutofixReport = { fixedCount: 0, notes: [] };
  const hasBackendKit = files.some((f) => f.path === "src/integrations/backend/client.ts");
  const lazyFixed = fixLazyNamedExports(files, report);
  const authStripped = hasBackendKit ? lazyFixed : stripAuthSurface(lazyFixed, report);
  const out = authStripped.map((f) => autofixFile(f, report, hasBackendKit));
  return { files: out, report };
}
