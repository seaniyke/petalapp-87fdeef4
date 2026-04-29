/**
 * /api/site-info — read & update the project's "Website info" used by the
 * subdomain worker to render <title>, <meta description>, favicon and the
 * Open Graph card on the published site.
 *
 * Storage lives on `projects.site_title|site_description|site_icon_url|
 * site_og_image_url` (added in migration 20260429*). When any of those are
 * blank the worker falls back to the project's build-time `title` / `summary`
 * and the default Petal logo as the favicon — see
 * `src/routes/api/public/host-lookup.ts` for the read path.
 *
 * Auth: bearer token in the `Authorization` header. Owner of the project
 * only — same pattern as `/api/publish`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const NullableTrimmed = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  });

const PutBodySchema = z.object({
  projectId: z.string().uuid(),
  site_title: NullableTrimmed,
  site_description: NullableTrimmed,
  site_icon_url: NullableTrimmed,
  site_og_image_url: NullableTrimmed,
});

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

export const Route = createFileRoute("/api/site-info")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const userIdOrResp = await authorize(request);
        if (userIdOrResp instanceof Response) return userIdOrResp;
        const userId = userIdOrResp;

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = PutBodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid body" },
            { status: 400 },
          );
        }
        const { projectId, ...rest } = parsed.data;

        // Ownership check.
        const { data: project, error: projErr } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id")
          .eq("id", projectId)
          .maybeSingle();
        if (projErr) {
          return Response.json({ error: projErr.message }, { status: 500 });
        }
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        if (project.owner_id !== userId) {
          return Response.json({ error: "Not authorized" }, { status: 403 });
        }

        // Only set fields the client actually sent (undefined → leave alone).
        const updates: Database["public"]["Tables"]["projects"]["Update"] = {};
        if (rest.site_title !== undefined) updates.site_title = rest.site_title;
        if (rest.site_description !== undefined) updates.site_description = rest.site_description;
        if (rest.site_icon_url !== undefined) updates.site_icon_url = rest.site_icon_url;
        if (rest.site_og_image_url !== undefined) updates.site_og_image_url = rest.site_og_image_url;
        if (Object.keys(updates).length === 0) {
          return Response.json({ error: "Nothing to update" }, { status: 400 });
        }

        const { data: updated, error: updateErr } = await supabaseAdmin
          .from("projects")
          .update(updates)
          .eq("id", projectId)
          .select(
            "id, title, summary, site_title, site_description, site_icon_url, site_og_image_url",
          )
          .single();
        if (updateErr) {
          return Response.json({ error: updateErr.message }, { status: 500 });
        }
        return Response.json({ ok: true, project: updated });
      },
    },
  },
});
