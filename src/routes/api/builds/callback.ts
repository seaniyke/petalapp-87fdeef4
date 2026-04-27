/**
 * Backward-compatible builder webhook path.
 *
 * Older builder deployments may still have PETAL_CALLBACK_URL configured as
 * /api/builds/callback. Keep accepting that signed webhook and route it through
 * the same handler as /api/public/builds/callback so successful builds don't
 * remain pending until the 10-minute stalled-build reaper marks them failed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleBuildCallback } from "@/routes/api/public/builds/callback";

export const Route = createFileRoute("/api/builds/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBuildCallback(request),
    },
  },
});
