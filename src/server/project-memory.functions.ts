/**
 * Project memory client-callable server functions.
 *
 * Surfaces the per-project memory rows (`project_memory`) to the UI so
 * users can see "what Petal remembers" and forget individual entries.
 * Reads/writes go through the authenticated Supabase client; RLS
 * enforces ownership.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProjectMemoryRow = {
  id: string;
  key: string;
  value: string;
  updated_at: string;
};

export const listProjectMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("project_memory")
      .select("id, key, value, updated_at")
      .eq("project_id", data.projectId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      console.warn("[project-memory] list failed:", error.message);
      return { entries: [] as ProjectMemoryRow[] };
    }
    return { entries: (rows ?? []) as ProjectMemoryRow[] };
  });

export const forgetProjectMemoryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ projectId: z.string().uuid(), entryId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("project_memory")
      .delete()
      .eq("project_id", data.projectId)
      .eq("id", data.entryId);
    if (error) {
      console.warn("[project-memory] delete failed:", error.message);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

export const forgetAllProjectMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("project_memory")
      .delete()
      .eq("project_id", data.projectId);
    if (error) {
      console.warn("[project-memory] clear failed:", error.message);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });
