import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductProgressItem = {
  id: string;
  label: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "REJECTED" | "SUPERSEDED";
};

/** Read the evidence-derived requirement progress stored on the project's PRD. */
export const getProductProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS: only the owner can see the project.
    const { data: owned } = await context.supabase.from("projects").select("id").eq("id", data.projectId).maybeSingle();
    if (!owned) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: bp } = await (supabaseAdmin as any)
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", data.projectId)
      .maybeSingle();
    const prd = bp?.blueprint?.prd?.prd;
    const reqs = (prd?.requirements ?? []) as Array<{ id: string; description: string; status: ProductProgressItem["status"] }>;
    const live = reqs.filter((r) => r.status !== "REJECTED" && r.status !== "SUPERSEDED");
    if (!live.length) return null;
    return {
      productName: String(prd.productName ?? "Your app"),
      completed: live.filter((r) => r.status === "COMPLETED").length,
      total: live.length,
      items: live.map((r) => ({ id: r.id, label: r.description, status: r.status })) as ProductProgressItem[],
    };
  });
