/**
 * Deterministic missing-import repair.
 *
 * Adds an import ONLY for a name the real TypeScript checker proved is
 * undeclared (TS2304) AND that has exactly one known provider:
 *   - React hooks/helpers → "react"
 *   - router names → the router this project already uses
 *   - starter-kit symbols exported by exactly one kit module
 *   - a fixed list of real lucide-react icons, only when the project already uses lucide-react
 * Anything unknown or ambiguous is left for the writer. Never renames,
 * never invents icon names outside that list, never touches application modules.
 */

export const REACT_NAMES = [
  "useState", "useEffect", "useMemo", "useRef", "useCallback", "useContext",
  "useReducer", "useLayoutEffect", "useId", "useTransition", "useDeferredValue",
  "Fragment", "createContext", "forwardRef", "memo", "lazy", "Suspense",
];

export const ROUTER_NAMES = [
  "Link", "NavLink", "Navigate", "Outlet", "useNavigate", "useParams",
  "useLocation", "useSearchParams",
];

/** Real, stable lucide-react export names (not guessed: a fixed list of the library's own exports). */
export const LUCIDE_NAMES = [
  "ArrowRight", "ArrowLeft", "ArrowUpRight", "Check", "CheckCircle", "CheckCircle2", "ChevronDown",
  "ChevronUp", "ChevronLeft", "ChevronRight", "Menu", "X", "Search", "Plus", "Minus", "Star", "Heart",
  "Mail", "Phone", "MapPin", "Clock", "Calendar", "User", "Users", "Settings", "Home", "LogOut", "LogIn",
  "Trash2", "Pencil", "Edit", "Eye", "EyeOff", "Lock", "Shield", "ShieldCheck", "Sparkles", "Loader2",
  "Info", "AlertCircle", "AlertTriangle", "ExternalLink", "Download", "Upload", "Filter", "Bell",
  "ShoppingCart", "ShoppingBag", "CreditCard", "Instagram", "Facebook", "Twitter", "Linkedin", "Youtube",
  "Globe", "Quote", "Award", "Zap", "TrendingUp", "BarChart3", "FileText", "Image", "Send", "MessageCircle",
];

/** name → module specifier, only for names with exactly one provider. */
export function buildProviders(args: {
  /** Router module the project already imports router names from, or null. */
  routerModule: string | null;
  /** symbol → kit specs exporting it (non-barrel). */
  kitOwners?: Map<string, string[]>;
  /** True when the project already imports from lucide-react. */
  usesLucide?: boolean;
}): Map<string, string> {
  const out = new Map<string, string>();
  const ambiguous = new Set<string>();
  const add = (name: string, spec: string) => {
    if (ambiguous.has(name)) return;
    const prev = out.get(name);
    if (prev && prev !== spec) { out.delete(name); ambiguous.add(name); return; }
    out.set(name, spec);
  };
  for (const n of REACT_NAMES) add(n, "react");
  if (args.routerModule) for (const n of ROUTER_NAMES) add(n, args.routerModule);
  for (const [name, specs] of args.kitOwners ?? []) {
    if (specs.length !== 1) continue;
    // React names always come from React; a kit re-export never overrides it.
    if (REACT_NAMES.includes(name)) continue;
    // Router names: only the project's own router module counts.
    if (ROUTER_NAMES.includes(name)) {
      if (args.routerModule && specs[0] === args.routerModule) add(name, specs[0]!);
      continue;
    }
    add(name, specs[0]!);
  }
  // Icons last: a kit module exporting the same name makes it ambiguous → left to the writer.
  if (args.usesLucide) for (const n of LUCIDE_NAMES) if (!(args.kitOwners?.has(n))) add(n, "lucide-react");
  return out;
}

/** The router module the project's files already import router names from. */
export function detectRouterModule(files: Iterable<[string, string]>): string | null {
  const found = new Set<string>();
  const rx = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const [, c] of files) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(c))) {
      const names = m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, ""));
      if (names.some((n) => n === "Routes" || n === "Route" || n === "Link" || n === "useNavigate")) found.add(m[2]!);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Names from `providers` that appear in the file and are not imported in it (cheap pre-filter). */
export function importCandidates(content: string, providers: Map<string, string>): string[] {
  const imported = new Set<string>();
  for (const m of content.matchAll(/import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) imported.add(m[1]);
    for (const p of (m[2] ?? "").split(",")) {
      const local = p.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (local) imported.add(local);
    }
  }
  const out: string[] = [];
  for (const name of providers.keys()) {
    if (imported.has(name)) continue;
    if (new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(content)) out.push(name);
  }
  return out;
}

/**
 * Add imports for `undefinedNames` that have a provider. Merges into an
 * existing named import from the same module when there is one.
 */
export function addMissingImports(
  content: string,
  undefinedNames: string[],
  providers: Map<string, string>,
): { content: string; added: Array<{ name: string; spec: string }> } | null {
  const bySpec = new Map<string, string[]>();
  for (const n of new Set(undefinedNames)) {
    const spec = providers.get(n);
    if (!spec) continue;
    (bySpec.get(spec) ?? bySpec.set(spec, []).get(spec)!).push(n);
  }
  if (!bySpec.size) return null;
  let next = content;
  const added: Array<{ name: string; spec: string }> = [];
  for (const [spec, names] of bySpec) {
    const esc = spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const existing = new RegExp(`import\\s+(?:([A-Za-z_$][\\w$]*)\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*(["'])${esc}\\3`).exec(next);
    if (existing) {
      const body = existing[2]!.trim().replace(/,\s*$/, "");
      const merged = body ? `${body}, ${names.join(", ")}` : names.join(", ");
      const stmt = existing[0].replace(/\{[^}]*\}/, `{ ${merged} }`);
      next = next.slice(0, existing.index) + stmt + next.slice(existing.index + existing[0].length);
    } else {
      const line = `import { ${names.join(", ")} } from "${spec}";\n`;
      // After the leading import block (or a "use client" directive), else at the top.
      const lines = next.split("\n");
      let at = 0;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!.trim();
        if (/^import\s/.test(l) || /^["']use (client|strict)["'];?$/.test(l)) {
          // Multi-line import: advance to its closing line.
          let j = i;
          while (j < lines.length && !/from\s*["'][^"']+["'];?\s*$|^import\s*["'][^"']+["'];?\s*$/.test(lines[j]!.trim())) j++;
          at = Math.min(j, lines.length - 1) + 1;
          i = j;
        } else if (l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*")) break;
      }
      lines.splice(at, 0, line.trimEnd());
      next = lines.join("\n");
    }
    for (const n of names) added.push({ name: n, spec });
  }
  return { content: next, added };
}
