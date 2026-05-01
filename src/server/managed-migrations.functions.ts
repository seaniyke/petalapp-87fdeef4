/**
 * Server functions for the managed-backend migration runner.
 *
 * Exposes:
 *   - runProjectMigrations: applies any pending migrations for a project the
 *     caller owns. Called from the chat pipeline after a generate turn writes
 *     files, and from the Cloud panel "Retry" button.
 *   - getMigrationHistory: read-only history list for the Cloud panel.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  applyPendingMigrations,
  listMigrationHistory,
  type MigrationOutcome,
} from "./managed-migrations.server";

const ProjectIdSchema = z.object({ projectId: z.string().uuid() });

async function assertOwns(
  // Authenticated supabase client from middleware (RLS as user)
  supabase: ReturnType<
    typeof import("@/integrations/supabase/auth-middleware")["requireSupabaseAuth"] extends never
      ? never
      : any
  >,
  projectId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not your project.");
}

export const runProjectMigrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ProjectIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<MigrationOutcome> => {
    const { supabase, userId } = context;
    await assertOwns(supabase, data.projectId, userId);
    return applyPendingMigrations(data.projectId);
  });

export const getMigrationHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ProjectIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwns(supabase, data.projectId, userId);
    return { entries: await listMigrationHistory(data.projectId) };
  });
