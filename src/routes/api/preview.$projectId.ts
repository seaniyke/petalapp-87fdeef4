import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildPreviewDoc } from "@/lib/preview";
import type { ProjectFile } from "@/server/generate.server";

/**
 * Returns a self-contained HTML document for a project's current files,
 * suitable for an <iframe src> on devices where the live WebContainer preview
 * can't run (iOS Safari, low-power Android browsers, etc.).
 *
 * Auth model:
 *   - If the project is public, anyone can view it.
 *   - Otherwise the caller must be the owner (verified via Bearer token).
 *
 * Caching:
 *   - Clients should bust the cache by appending `?v=<changeId>` so updates
 *     are picked up after each generation.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

// COEP/CORP: our app sets `Cross-Origin-Embedder-Policy: require-corp`
// globally, so any same-origin iframe content needs an explicit CORP header.
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  // Don't cache aggressively — files change every generation.
  "Cache-Control": "private, max-age=0, must-revalidate",
  ...CORS_HEADERS,
};

function htmlError(status: number, message: string): Response {
  const safe = message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
  const body = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin:0; min-height:100vh; display:grid; place-items:center;
           font-family: ui-sans-serif, system-ui, sans-serif; color:#6b5f51;
           background:linear-gradient(180deg,#fff,#f7f3ee); padding:24px; text-align:center; }
    .card { max-width:340px; padding:24px; background:#fff; border:1px solid #ece6db;
            border-radius:16px; box-shadow:0 8px 24px rgba(40,30,15,.06); }
    h1 { margin:0 0 6px; font-size:15px; color:#1f1b16; font-weight:600; }
    p { margin:0; font-size:13px; line-height:1.5; }
  </style></head><body>
    <div class="card"><h1>Preview unavailable</h1><p>${safe}</p></div>
  </body></html>`;
  return new Response(body, { status, headers: HTML_HEADERS });
}

export const Route = createFileRoute("/api/preview/$projectId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request, params }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return htmlError(500, "Server is misconfigured.");
        }

        const projectId = params.projectId;
        if (!/^[0-9a-f-]{10,}$/i.test(projectId)) {
          return htmlError(400, "Invalid project ID.");
        }

        // Anonymous client first — used for the public-project lookup.
        const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: project, error: projectErr } = await anon
          .from("projects")
          .select("id, owner_id, is_public")
          .eq("id", projectId)
          .maybeSingle();

        if (projectErr) return htmlError(500, "Couldn't load this project.");
        if (!project) return htmlError(404, "Project not found.");

        // If private, require a token from the owner. Iframes can't set
        // Authorization headers, so we also accept ?t=<jwt> as a fallback.
        if (!project.is_public) {
          const auth = request.headers.get("authorization");
          const headerToken = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
          const url = new URL(request.url);
          const queryToken = url.searchParams.get("t");
          const token = headerToken ?? queryToken;
          if (!token) return htmlError(401, "Sign in to view this preview.");
          const { data: claims, error: claimsErr } = await anon.auth.getClaims(token);
          if (claimsErr || claims?.claims?.sub !== project.owner_id) {
            return htmlError(403, "You don't have access to this project.");
          }
        }

        // Read files. RLS allows public-project reads + owner reads, so the
        // anon client is sufficient here.
        const { data: rows, error: filesErr } = await anon
          .from("project_files")
          .select("path, content")
          .eq("project_id", projectId);
        if (filesErr) return htmlError(500, "Couldn't load project files.");

        const files: ProjectFile[] = (rows ?? []).map((r) => ({
          path: r.path,
          content: r.content,
        }));

        return new Response(buildPreviewDoc(files), { status: 200, headers: HTML_HEADERS });
      },
    },
  },
});
