import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { listCreditPauses, parkCreditPause, resumeCreditPause } from "@/server/credit-pause.server";

async function userId(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!auth?.startsWith("Bearer ") || !url || !key) return null;
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: auth } } });
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

export const Route = createFileRoute("/api/credit-pauses")({
  server: { handlers: {
    GET: async ({ request }) => {
      const uid = await userId(request);
      if (!uid) return new Response("Unauthorized", { status: 401 });
      const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
      const pauses = await listCreditPauses(uid, projectId);
      return Response.json({ pauses: pauses.map((p) => ({ id: p.id, turnId: p.turn_id, projectId: p.project_id, requiredCredits: Number(p.required_credits), status: p.status, createdAt: p.created_at })) });
    },
    POST: async ({ request }) => {
      const uid = await userId(request);
      if (!uid) return new Response("Unauthorized", { status: 401 });
      const body = await request.json().catch(() => null) as { id?: string; action?: string } | null;
      if (!body?.id || !["park", "resume"].includes(body.action ?? "")) return new Response("Invalid request", { status: 400 });
      const own = (await listCreditPauses(uid)).some((p) => p.id === body.id);
      if (!own) return new Response("Not found", { status: 404 });
      if (body.action === "park") return Response.json({ ok: await parkCreditPause(body.id, uid) });
      return Response.json(await resumeCreditPause(body.id));
    },
  } },
});