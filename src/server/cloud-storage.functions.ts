/**
 * Cloud panel — Storage view server function.
 * Lists buckets and (optionally) the first page of objects in a bucket.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
  makeManagedClient,
} from "./cloud-managed-client.server";

const Input = z.object({ projectId: z.string().uuid() });

export type CloudBucket = {
  id: string;
  name: string;
  isPublic: boolean;
  createdAt: string;
};

export type CloudStorageResult = {
  available: boolean;
  reason?: "NO_BACKEND" | "NOT_READY" | "ERROR";
  buckets: CloudBucket[];
};

export const listProjectBuckets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CloudStorageResult> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    let info;
    try {
      info = await getManagedBackendForProject(data.projectId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ERROR";
      return {
        available: false,
        reason: msg === "NO_BACKEND" || msg === "NOT_MANAGED" ? "NO_BACKEND" : "NOT_READY",
        buckets: [],
      };
    }

    const client = makeManagedClient(info);
    try {
      const { data: list, error } = await client.storage.listBuckets();
      if (error) throw error;
      const buckets: CloudBucket[] = (list ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        isPublic: b.public,
        createdAt: b.created_at,
      }));
      return { available: true, buckets };
    } catch (e) {
      console.error("[cloud-storage] list failed", e);
      return { available: false, reason: "ERROR", buckets: [] };
    }
  });
