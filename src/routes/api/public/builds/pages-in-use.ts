/**
 * Which hosting slots still belong to a live Petal project.
 *
 * The hosting account caps how many sites it holds. When the build service
 * hits that cap it lists its `petal-<12 hex>` slots and asks here which ones
 * still map to an existing project; only the rest may be reclaimed. Signed with
 * the same HMAC scheme as the build callback. An unknown answer keeps a slot.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifySignature } from "@/server/builder.server";

const Body = z.object({ names: z.array(z.string().regex(/^petal-[0-9a-f]{12}$/)).max(2000) });

export async function handlePagesInUse(request: Request): Promise<Response> {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return new Response("Server misconfigured", { status: 500 });
  const raw = await request.text();
  if (!verifySignature(secret, raw, request.headers.get("x-petal-timestamp"), request.headers.get("x-petal-signature"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const r = Body.safeParse(parsed);
  if (!r.success) return new Response("Invalid body", { status: 400 });

  const prefixes = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("projects").select("id").range(from, from + 999);
    if (error) return new Response("Lookup failed", { status: 503 });
    for (const p of data ?? []) prefixes.add(`petal-${String(p.id).replace(/-/g, "").slice(0, 12).toLowerCase()}`);
    if (!data || data.length < 1000) break;
  }
  return Response.json({ inUse: r.data.names.filter((n) => prefixes.has(n)) });
}

export const Route = createFileRoute("/api/public/builds/pages-in-use")({
  server: { handlers: { POST: ({ request }) => handlePagesInUse(request) } },
});
