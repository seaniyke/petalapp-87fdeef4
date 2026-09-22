/**
 * Auth API alignment — make generated page code call auth helpers that
 * actually exist in the backend kit the project received.
 *
 * Root cause this fixes: Kimble ships two backend kits (dedicated Supabase
 * and shared starter). Every build prompt teaches the Supabase-style names
 * (`signInWithPassword`, `signUpWithPassword`, …). When a model reaches for a
 * name the installed kit does not export — or invents one (`login`, `logout`,
 * `register`) — the code still compiles and only explodes when a real person
 * presses the button: `x.signInWithPassword is not a function`.
 *
 * This pass is deterministic, AI-free and idempotent:
 *   1. read the installed kit (`src/integrations/backend/{auth.tsx,client.ts}`)
 *      and collect the helper names it genuinely exposes;
 *   2. in every app file, rewrite calls to helpers that do not exist to the
 *      closest available equivalent from a fixed alias table;
 *   3. leave everything alone when the kit is absent or the name is valid.
 */
import type { ProjectFile } from "@/server/generate.server";

const KIT_FILES = [
  "src/integrations/backend/auth.tsx",
  "src/integrations/backend/auth.ts",
  "src/integrations/backend/client.ts",
  "src/integrations/backend/client.tsx",
];

/** Preference order: the first available name wins. */
const ALIASES: Record<string, string[]> = {
  login: ["signInWithPassword", "signIn"],
  signin: ["signInWithPassword", "signIn"],
  logIn: ["signInWithPassword", "signIn"],
  signIn: ["signInWithPassword"],
  signInWithEmail: ["signInWithPassword", "signIn"],
  signInWithPassword: ["signIn"],
  loginWithPassword: ["signInWithPassword", "signIn"],
  register: ["signUpWithPassword", "signUp"],
  signup: ["signUpWithPassword", "signUp"],
  signUp: ["signUpWithPassword"],
  signUpWithEmail: ["signUpWithPassword", "signUp"],
  signUpWithPassword: ["signUp"],
  createAccount: ["signUpWithPassword", "signUp"],
  logout: ["signOut"],
  logOut: ["signOut"],
  signout: ["signOut"],
  getUser: ["me"],
  currentUser: ["me"],
};

/** Collect helper names the installed kit actually exposes. */
export function availableAuthHelpers(files: ProjectFile[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) {
    if (!KIT_FILES.includes(f.path)) continue;
    // Object-literal keys and shorthand methods: `signIn: async (`, `async signIn(`.
    for (const m of f.content.matchAll(
      /(?:^|[\s,{])(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*(?:async\s*)?\(|\()/g,
    )) {
      names.add(m[1]);
    }
  }
  return names;
}

function isKitFile(path: string): boolean {
  return path.startsWith("src/integrations/backend/");
}

function isCodeFile(path: string): boolean {
  return /\.(tsx?|jsx?)$/.test(path) && !path.endsWith(".d.ts");
}

export function alignAuthApi(files: ProjectFile[]): { files: ProjectFile[]; notes: string[] } {
  const available = availableAuthHelpers(files);
  if (available.size === 0) return { files, notes: [] };

  const notes: string[] = [];
  let totalFixes = 0;

  const out = files.map((f) => {
    if (!isCodeFile(f.path) || isKitFile(f.path)) return f;
    if (!/\bauth\s*\./.test(f.content)) return f;

    let changed = 0;
    // `auth.NAME(`, `backend.auth.NAME(` — never `supabase.auth.NAME(`, which
    // is a different (real) API surface handled elsewhere.
    const content = f.content.replace(
      /(^|[^.\w$])((?:[\w$]+\.)?auth)\.([A-Za-z_$][\w$]*)\s*\(/g,
      (full, lead: string, obj: string, name: string) => {
        if (obj.endsWith("supabase.auth")) return full;
        if (available.has(name)) return full;
        const target = (ALIASES[name] ?? []).find((c) => available.has(c));
        if (!target) return full;
        changed++;
        return `${lead}${obj}.${target}(`;
      },
    );

    if (!changed) return f;
    totalFixes += changed;
    notes.push(`auth-api-align: ${f.path} — rewrote ${changed} call(s) to helpers the backend exposes`);
    return { ...f, content };
  });

  if (totalFixes === 0) return { files, notes: [] };
  return { files: out, notes };
}
