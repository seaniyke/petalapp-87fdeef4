/**
 * Expo / EAS Build integration — server-side status + OAuth start.
 *
 * Real publishing flow lives in `src/routes/api/mobile/eas-build.ts`.
 * This module just tells the client whether the prerequisites are in
 * place so the "Connect Expo account" button can render its true state
 * instead of a permanent "Coming soon".
 *
 * Prerequisites checked here:
 *   - EXPO_OAUTH_CLIENT_ID
 *   - EXPO_OAUTH_CLIENT_SECRET
 *
 * Add them via the secrets tool when the user is ready to ship.
 */
import { createServerFn } from "@tanstack/react-start";

export const getExpoConnectStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const hasOAuth =
      Boolean(process.env.EXPO_OAUTH_CLIENT_ID) &&
      Boolean(process.env.EXPO_OAUTH_CLIENT_SECRET);
    return {
      ready: hasOAuth,
      // OAuth start URL — Expo's OAuth endpoint follows the standard
      // authorization code flow (see https://docs.expo.dev/accounts/oauth/).
      // We only build it when secrets are present so we never leak a
      // half-configured redirect.
      authorizeUrl: hasOAuth
        ? `https://api.expo.dev/v2/oauth/authorize?response_type=code` +
          `&client_id=${encodeURIComponent(process.env.EXPO_OAUTH_CLIENT_ID!)}` +
          `&scope=${encodeURIComponent("builds:write builds:read")}` +
          `&redirect_uri=${encodeURIComponent(
            (process.env.APP_BASE_URL ?? "https://buildwithpetal.com") +
              "/api/public/expo-oauth-callback"
          )}`
        : null,
    };
  }
);
