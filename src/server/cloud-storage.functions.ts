/**
 * Cloud panel — Storage management server functions.
 * Buckets + object operations against the project's managed Supabase backend.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
  makeManagedClient,
} from "./cloud-managed-client.server";

const ProjectInput = z.object({ projectId: z.string().uuid() });

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

async function backendOrUnavailable(projectId: string) {
  try {
    return { ok: true as const, info: await getManagedBackendForProject(projectId) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return {
      ok: false as const,
      reason:
        msg === "NO_BACKEND" || msg === "NOT_MANAGED"
          ? ("NO_BACKEND" as const)
          : ("NOT_READY" as const),
    };
  }
}

export const listProjectBuckets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ProjectInput.parse(data))
  .handler(async ({ data, context }): Promise<CloudStorageResult> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    const r = await backendOrUnavailable(data.projectId);
    if (!r.ok) return { available: false, reason: r.reason, buckets: [] };

    const client = makeManagedClient(r.info);
    try {
      const { data: list, error } = await client.storage.listBuckets();
      if (error) throw error;
      return {
        available: true,
        buckets: (list ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          isPublic: b.public,
          createdAt: b.created_at,
        })),
      };
    } catch (e) {
      console.error("[cloud-storage] list failed", e);
      return { available: false, reason: "ERROR", buckets: [] };
    }
  });

const CreateBucketInput = ProjectInput.extend({
  name: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
      message:
        "Use lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.",
    }),
  isPublic: z.boolean().default(false),
});

export const createProjectBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CreateBucketInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    const { error } = await client.storage.createBucket(data.name, {
      public: data.isPublic,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const BucketInput = ProjectInput.extend({
  bucket: z.string().min(1).max(63),
});

export const deleteProjectBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BucketInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    // Empty first so deletion succeeds.
    await client.storage.emptyBucket(data.bucket).catch(() => undefined);
    const { error } = await client.storage.deleteBucket(data.bucket);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ListObjectsInput = BucketInput.extend({
  prefix: z.string().max(1024).default(""),
  limit: z.number().int().min(1).max(200).default(100),
});

export type CloudObject = {
  name: string;
  size: number | null;
  updatedAt: string | null;
  createdAt: string | null;
  isFolder: boolean;
};

export const listProjectObjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ListObjectsInput.parse(data))
  .handler(
    async ({ data, context }): Promise<{ objects: CloudObject[]; isPublic: boolean }> => {
      const { supabase, userId } = context;
      await assertOwnsProject(supabase, data.projectId, userId);
      const info = await getManagedBackendForProject(data.projectId);
      const client = makeManagedClient(info);

      const { data: list, error } = await client.storage
        .from(data.bucket)
        .list(data.prefix, { limit: data.limit, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(error.message);

      // Bucket public flag (used to decide whether to show public URLs).
      const { data: bucketRow } = await client.storage.getBucket(data.bucket);

      const objects: CloudObject[] = (list ?? []).map((o) => ({
        name: o.name,
        size:
          (o.metadata as { size?: number } | null)?.size ?? null,
        updatedAt: o.updated_at ?? null,
        createdAt: o.created_at ?? null,
        // Folders are returned with id=null by Supabase storage.
        isFolder: o.id === null,
      }));
      return { objects, isPublic: bucketRow?.public ?? false };
    },
  );

const ObjectInput = BucketInput.extend({
  path: z.string().min(1).max(2048),
});

export const deleteProjectObject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ObjectInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    const { error } = await client.storage.from(data.bucket).remove([data.path]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createProjectObjectUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ObjectInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    const { data: signed, error } = await client.storage
      .from(data.bucket)
      .createSignedUploadUrl(data.path);
    if (error || !signed) throw new Error(error?.message ?? "upload url failed");
    return { signedUrl: signed.signedUrl, token: signed.token, path: signed.path };
  });

const SignedDownloadInput = ObjectInput.extend({
  expiresIn: z.number().int().min(30).max(3600).default(300),
});

export const createProjectObjectDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => SignedDownloadInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    // Public buckets return a stable URL; private buckets need a signed URL.
    const { data: bucketRow } = await client.storage.getBucket(data.bucket);
    if (bucketRow?.public) {
      const { data: pub } = client.storage.from(data.bucket).getPublicUrl(data.path);
      return { url: pub.publicUrl, isPublic: true };
    }
    const { data: signed, error } = await client.storage
      .from(data.bucket)
      .createSignedUrl(data.path, data.expiresIn);
    if (error || !signed) throw new Error(error?.message ?? "download url failed");
    return { url: signed.signedUrl, isPublic: false };
  });
