/**
 * POST /api/mobile/eas-build
 *
 * Triggers an EAS Build under PETAL'S Expo org account on behalf of
 * the user — they never connect their own Expo account. Output is a
 * downloadable .apk (Android) or .ipa (iOS, ad-hoc) the user can
 * install directly, or hand off to Play / TestFlight at the publish
 * step (where their own store credentials become required).
 *
 * Requires: EXPO_ACCESS_TOKEN (personal access token from Petal's
 * Expo org with `builds:write` scope).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BuildRequest = z.object({
  projectId: z.string().min(1).max(255),
  platform: z.enum(["android", "ios"]),
  profile: z.enum(["preview", "production"]).default("preview"),
});

export const Route = createFileRoute("/api/mobile/eas-build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.EXPO_ACCESS_TOKEN;
        if (!token) {
          return Response.json(
            {
              error: "mobile_builds_unavailable",
              message:
                "Petal's mobile build pipeline isn't connected yet. Try again shortly.",
            },
            { status: 503 }
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BuildRequest.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_input", issues: parsed.error.issues },
            { status: 400 }
          );
        }

        // TODO (next PR): call EAS Build's GraphQL endpoint with the
        // project's app.json + selected profile, using the Petal
        // EXPO_ACCESS_TOKEN. Return { buildId, status: 'queued',
        // logsUrl, artifactUrl (once finished) }.
        return Response.json(
          {
            error: "not_implemented",
            message:
              "EAS Build trigger is wired but the GraphQL handoff lands in the next PR.",
          },
          { status: 501 }
        );
      },
    },
  },
});
