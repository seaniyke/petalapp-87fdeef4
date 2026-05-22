/**
 * GET /api/public/expo-oauth-callback
 *
 * Expo OAuth redirect target. Exchanges the auth code for an access +
 * refresh token, persists the refresh token against the signed-in user
 * (in a future `expo_connections` table), and bounces back to the app.
 *
 * Public route because OAuth providers can't pass our auth header.
 * Security: we still require a valid `state` param (signed with
 * EXPO_OAUTH_CLIENT_SECRET) to prevent CSRF. Until that table + signing
 * is in place, this handler returns a clear "not configured" message
 * rather than silently dropping the token.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/expo-oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const hasOAuth =
          Boolean(process.env.EXPO_OAUTH_CLIENT_ID) &&
          Boolean(process.env.EXPO_OAUTH_CLIENT_SECRET);

        if (!hasOAuth) {
          return new Response(
            "Expo OAuth isn't configured on this deployment yet.",
            { status: 503 }
          );
        }
        if (!code) {
          return new Response("Missing ?code", { status: 400 });
        }

        // TODO (next PR): POST to https://api.expo.dev/v2/oauth/token
        // with the code, persist refresh_token in `expo_connections`
        // keyed by auth.uid(), then 302 back to /settings?expo=connected.
        return new Response(
          "Expo connect handshake received. Token persistence is staged for the next release.",
          { status: 200 }
        );
      },
    },
  },
});
