/**
 * Client-callable access to saved project preview images.
 *
 * `getSavedThumbnails` is a cheap read used to paint galleries instantly.
 * `ensureSavedThumbnail` captures one when it is missing or stale — safe to
 * call from any surface; it is single-flighted server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const IdsSchema = z.object({ projectIds: z.array(z.string().uuid()).max(200) });
const EnsureSchema = z.object({
  projectId: z.string().uuid(),
  buildId: z.string().uuid().nullish(),
});

export const getSavedThumbnails = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IdsSchema.parse(data))
  .handler(async ({ data }) => {
    const { readSavedThumbnails } = await import("@/server/project-thumbnail.server");
    const saved = await readSavedThumbnails(data.projectIds);
    return { thumbnails: saved };
  });

export const ensureSavedThumbnail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => EnsureSchema.parse(data))
  .handler(async ({ data }) => {
    const { ensureSavedThumbnail: ensure } = await import(
      "@/server/project-thumbnail.server"
    );
    const saved = await ensure(data.projectId, data.buildId ?? null);
    return { url: saved?.url ?? null };
  });
