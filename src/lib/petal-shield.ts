/**
 * Petal Shield — static security analyzer for the user's project files.
 *
 * Differentiator: Bolt/Lovable/v0/Replit have all been hit by the "12 security
 * issues with vibe-coded apps" wave. We catch the most common offenders BEFORE
 * the user publishes:
 *   - service-role / secret keys leaked into client code
 *   - Supabase migrations creating tables WITHOUT enable row level security
 *   - webhook routes that don't verify a signature
 *   - public storage buckets used for sensitive uploads
 *   - dangerouslySetInnerHTML on user-controlled input
 *   - eval / new Function on user input
 *   - admin routes without an auth guard
 *
 * Pure client-side scan over ProjectFile[] — zero cost, instant feedback,
 * runs in the builder before every publish.
 */
import type { ProjectFile } from "@/server/generate.server";

export type ShieldSeverity = "critical" | "high" | "medium" | "low";

export type ShieldFinding = {
  id: string;
  ruleId: string;
  title: string;
  severity: ShieldSeverity;
  file: string;
  line?: number;
  snippet?: string;
  fix: string;
};

export type ShieldReport = {
  findings: ShieldFinding[];
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  scannedFiles: number;
  generatedAt: number;
};

const SEVERITY_WEIGHT: Record<ShieldSeverity, number> = {
  critical: 30,
  high: 15,
  medium: 6,
  low: 2,
};

function gradeFromScore(score: number): ShieldReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function lineOf(content: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function snippetOf(content: string, idx: number): string {
  const start = content.lastIndexOf("\n", idx) + 1;
  const endRaw = content.indexOf("\n", idx);
  const end = endRaw === -1 ? content.length : endRaw;
  return content.slice(start, end).trim().slice(0, 180);
}

function pushMatch(
  out: ShieldFinding[],
  file: ProjectFile,
  re: RegExp,
  rule: Omit<ShieldFinding, "id" | "file" | "line" | "snippet">,
) {
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = r.exec(file.content)) !== null) {
    const ln = lineOf(file.content, m.index);
    if (seen.has(ln)) continue;
    seen.add(ln);
    out.push({
      ...rule,
      id: `${rule.ruleId}:${file.path}:${ln}`,
      file: file.path,
      line: ln,
      snippet: snippetOf(file.content, m.index),
    });
  }
}

const CLIENT_PATH = /^src\/(?!server\/|.*\.server\.)/;
const SERVER_PATH = /(\.server\.|^src\/server\/|^src\/routes\/api\/)/;

export function analyzeProject(files: ProjectFile[]): ShieldReport {
  const findings: ShieldFinding[] = [];

  for (const f of files) {
    const isClient = CLIENT_PATH.test(f.path) && !SERVER_PATH.test(f.path);
    const isServerOrRoute = SERVER_PATH.test(f.path);
    const isMigration = f.path.startsWith("supabase/migrations/");

    // ── 1. Leaked secrets in client code ───────────────────────────────
    if (isClient) {
      pushMatch(findings, f, /SUPABASE_SERVICE_ROLE_KEY|service_role/i, {
        ruleId: "leak-service-role",
        title: "Supabase service role key referenced in client code",
        severity: "critical",
        fix: "Move all service-role usage to a server function or .server.ts file. Never bundle it into the browser.",
      });
      pushMatch(findings, f, /sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}/, {
        ruleId: "leak-stripe",
        title: "Stripe secret key in client bundle",
        severity: "critical",
        fix: "Replace with the publishable key in client code; keep secret keys in a server route only.",
      });
      pushMatch(findings, f, /AIza[0-9A-Za-z_\-]{30,}/, {
        ruleId: "leak-google-api",
        title: "Hardcoded Google API key",
        severity: "high",
        fix: "Move the key into a server function and proxy the call, or restrict the key by referrer in Google Cloud Console.",
      });
      pushMatch(findings, f, /process\.env\.[A-Z_]+/, {
        ruleId: "process-env-client",
        title: "process.env used in client code",
        severity: "medium",
        fix: "Use import.meta.env.VITE_* in client code — process.env is undefined in the browser and may leak server config.",
      });
    }

    // ── 2. dangerouslySetInnerHTML / eval ──────────────────────────────
    pushMatch(findings, f, /dangerouslySetInnerHTML/, {
      ruleId: "dangerous-html",
      title: "dangerouslySetInnerHTML used",
      severity: "high",
      fix: "Sanitize the HTML with DOMPurify, or render as plain text. Never pass user input directly.",
    });
    pushMatch(findings, f, /\beval\s*\(|new\s+Function\s*\(/, {
      ruleId: "eval-usage",
      title: "eval() or new Function() detected",
      severity: "high",
      fix: "Remove dynamic code execution. Refactor to a switch/lookup table instead.",
    });

    // ── 3. Webhook routes without signature verification ──────────────
    if (f.path.includes("/api/public/") && /webhook|callback/i.test(f.path)) {
      const hasVerify = /timingSafeEqual|verifySignature|createHmac|x-.*-signature/i.test(
        f.content,
      );
      if (!hasVerify) {
        findings.push({
          id: `webhook-unsigned:${f.path}`,
          ruleId: "webhook-unsigned",
          title: "Public webhook does not verify a signature",
          severity: "critical",
          file: f.path,
          fix: "Verify the provider's signature header with crypto.timingSafeEqual before processing the request body.",
        });
      }
    }

    // ── 4. Admin routes without auth guard ────────────────────────────
    if (/^src\/routes\/admin/.test(f.path)) {
      const hasGuard = /useAdminGuard|requireSupabaseAuth|has_role|is_admin/.test(
        f.content,
      );
      if (!hasGuard) {
        findings.push({
          id: `admin-unguarded:${f.path}`,
          ruleId: "admin-unguarded",
          title: "Admin route missing role check",
          severity: "critical",
          file: f.path,
          fix: "Wrap the route with useAdminGuard() or check has_role(user_id, 'admin') server-side. Never gate admin UI on client-side flags only.",
        });
      }
    }

    // ── 5. Server routes lacking input validation ─────────────────────
    if (isServerOrRoute && /createServerFn|createFileRoute/.test(f.content)) {
      const hasValidator = /inputValidator|z\.object\(|zod/i.test(f.content);
      const acceptsBody = /request\.json\(\)|\.text\(\)|\.formData\(\)/.test(f.content);
      if (acceptsBody && !hasValidator) {
        findings.push({
          id: `no-input-validation:${f.path}`,
          ruleId: "no-input-validation",
          title: "Server route accepts a request body without validation",
          severity: "medium",
          file: f.path,
          fix: "Validate the parsed body with Zod (min/max lengths, allowed shapes) before using it.",
        });
      }
    }

    // ── 6. Supabase migrations ────────────────────────────────────────
    if (isMigration) {
      const createTables = [
        ...f.content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi),
      ];
      for (const m of createTables) {
        const table = m[1];
        const enableRls = new RegExp(
          `alter\\s+table\\s+(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`,
          "i",
        );
        if (!enableRls.test(f.content)) {
          findings.push({
            id: `rls-missing:${f.path}:${table}`,
            ruleId: "rls-missing",
            title: `Table public.${table} created without RLS enabled`,
            severity: "critical",
            file: f.path,
            fix: `Add "ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;" plus owner-scoped policies. Never ship a table without RLS.`,
          });
        }
      }
      pushMatch(findings, f, /create\s+policy[\s\S]{1,200}?using\s*\(\s*true\s*\)/i, {
        ruleId: "policy-permissive",
        title: "RLS policy uses USING (true) — allows everyone",
        severity: "high",
        fix: "Restrict the policy with auth.uid() = user_id (or has_role) so users only see their own rows.",
      });
      pushMatch(findings, f, /storage\.buckets[\s\S]{0,80}true\s*\)/i, {
        ruleId: "public-bucket",
        title: "Storage bucket created as public",
        severity: "medium",
        fix: "If the bucket holds user uploads, set public=false and gate downloads via signed URLs.",
      });
    }

    // ── 7. localStorage-only auth flags ───────────────────────────────
    if (isClient) {
      pushMatch(findings, f, /localStorage\.(get|set)Item\(['"`](isAdmin|admin|role)/i, {
        ruleId: "client-role-flag",
        title: "Role flag stored in localStorage",
        severity: "high",
        fix: "Validate roles server-side using a user_roles table + has_role() function. Client storage is trivially editable.",
      });
    }
  }

  // Score: start at 100, subtract weighted severity, cap at 0
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    findings,
    score,
    grade: gradeFromScore(score),
    scannedFiles: files.length,
    generatedAt: Date.now(),
  };
}

export const SEVERITY_LABEL: Record<ShieldSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
