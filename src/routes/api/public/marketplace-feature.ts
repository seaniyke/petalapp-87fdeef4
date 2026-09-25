import { createFileRoute } from "@tanstack/react-router";
import { isMarketplaceEnabled } from "@/server/marketplace-feature.server";

export const Route = createFileRoute("/api/public/marketplace-feature")({
  server: {
    handlers: {
      GET: async () => {
        const enabled = await isMarketplaceEnabled().catch(() => false);
        return Response.json(
          { enabled },
          { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } },
        );
      },
    },
  },
});