/**
 * Expo / EAS Build integration — server-side readiness check.
 *
 * Petal runs EAS Build under its OWN Expo organization account, not
 * the user's. That means we don't need OAuth, we just need a single
 * server-side `EXPO_ACCESS_TOKEN` (a personal access token from
 * Petal's Expo org with `builds:write` scope).
 *
 * This is the same pattern Bolt and Rork use for "no setup" mobile
 * builds — the heavy infra (build runners, build queue) lives on the
 * platform's account, and the user's account is only requested at the
 * point of actually submitting to the App Store / Play Store (because
 * Apple and Google legally require the app owner's identity).
 *
 * Add the secret via the secrets tool when ready:
 *   EXPO_ACCESS_TOKEN
 */
import { createServerFn } from "@tanstack/react-start";

export const getMobileBuildReady = createServerFn({ method: "GET" }).handler(
  async () => {
    const ready = Boolean(process.env.EXPO_ACCESS_TOKEN);
    return {
      ready,
      // If true → Petal can run EAS Build for the user with zero setup.
      // If false → "Petal is finishing its mobile build pipeline" copy.
    };
  }
);
