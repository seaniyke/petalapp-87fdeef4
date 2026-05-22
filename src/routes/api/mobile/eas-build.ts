/**
 * POST /api/mobile/eas-build
 *
 * Triggers an EAS Build for the current project. Requires a connected
 * Expo account (OAuth refresh token stored server-side) — until that's
 * wired, this endpoint cleanly returns 503 with actionable copy so the
 * UI can tell the user what's missing instead of failing opaquely.
 *
 * When `EXPO_OAUTH_CLIENT_ID`/`EXPO_OAUTH_CLIENT_SECRET` are present
 * AND the user has completed the OAuth callback (token persisted in
 * `expo_connections`), this will:
 *   1. Resolve the user's Expo access token (refresh via OAuth if stale)
 *   2. POST to EAS Build GraphQL with the project's app.json + profile
 *   3. Return { buildId, status: 'queued', logsUrl }
 *
 * Same shape Bolt/Rork use — keeps Petal out of the build path and
 * leverages Expo's free 30-builds/month tier.
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
        const hasOAuth =
          Boolean(process.env.EXPO_OAUTH_CLIENT_ID) &&
          Boolean(process.env.EXPO_OAUTH_CLIENT_SECRET);

        if (!hasOAuth) {
          return Response.json(
            {
              error: "expo_not_connected",
              message:
                "Expo OAuth isn't configured yet. Add EXPO_OAUTH_CLIENT_ID and EXPO_OAUTH_CLIENT_SECRET, then connect your Expo account.",
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

        // TODO (next PR): look up the user's Expo refresh token from
        // `expo_connections`, exchange for an access token, then POST
        // to EAS Build's GraphQL endpoint with the project app.json.
        return Response.json(
          {
            error: "not_implemented",
            message:
              "EAS Build trigger is staged but not yet wired. Connect your Expo account first, then we'll hand off to EAS.",
          },
          { status: 501 }
        );
      },
    },
  },
});
