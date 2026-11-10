/**
 * Site-visitor Google sign-in — step 2 (Google redirects here).
 * Verifies the signed state + this browser's nonce cookie, exchanges the code,
 * requires a Google-verified email, finds or creates the visitor's account,
 * and returns to the site page with the sign-in token in the #fragment.
 */
import { createFileRoute } from "@tanstack/react-router";
import { googleConfigured, withFragment } from "@/server/shared-auth-rules";

const page = (msg: string, status: number) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in</title><p style="font-family:system-ui;padding:2rem">${msg}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearCookie },
  });
const clearCookie = "petal_g_nonce=; Path=/api/public/shared-oauth; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

function cookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export const Route = createFileRoute("/api/public/shared-oauth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!googleConfigured(process.env)) return page("Google sign-in isn't available yet.", 503);
        const url = new URL(request.url);
        const { verifyGoogleState, googleCallbackUrl, visitorForGoogle, isAllowedSiteAddress } = await import(
          "@/server/shared-auth.server"
        );
        const state = await verifyGoogleState(url.searchParams.get("state"), cookie(request, "petal_g_nonce"));
        if (!state) return page("This sign-in link has expired. Go back to the site and try again.", 400);
        const back = (key: string, value: string) =>
          new Response(null, {
            status: 302,
            headers: { Location: withFragment(state.r, key, value), "Set-Cookie": clearCookie, "Cache-Control": "no-store" },
          });
        if (url.searchParams.get("error")) return back("petal_auth_error", "cancelled");
        const code = url.searchParams.get("code");
        if (!code) return back("petal_auth_error", "failed");
        // Re-check: a domain may have been removed since the start.
        if (!(await isAllowedSiteAddress(state.p, state.r))) return page("This site address is no longer valid.", 400);

        try {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: process.env.PETAL_GOOGLE_CLIENT_ID!,
              client_secret: process.env.PETAL_GOOGLE_CLIENT_SECRET!,
              redirect_uri: googleCallbackUrl(),
              grant_type: "authorization_code",
            }),
            signal: AbortSignal.timeout(10_000),
          });
          const tokens = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
          if (!tokenRes.ok || !tokens.access_token) return back("petal_auth_error", "failed");
          const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            signal: AbortSignal.timeout(10_000),
          });
          const info = (await infoRes.json().catch(() => ({}))) as { email?: string; email_verified?: boolean; name?: string };
          if (!infoRes.ok || !info.email || info.email_verified !== true) return back("petal_auth_error", "unverified_email");

          const { resolveProjectAccess, issueUserToken } = await import("@/server/shared-backend.server");
          const { data: backend } = await (await import("@/integrations/supabase/client.server")).supabaseAdmin
            .from("shared_backends")
            .select("api_key")
            .eq("project_id", state.p)
            .maybeSingle();
          if (!backend || (await resolveProjectAccess(state.p, backend.api_key as string)) !== "ok") {
            return back("petal_auth_error", "unavailable");
          }
          const visitor = await visitorForGoogle({ projectId: state.p, email: info.email, name: info.name?.slice(0, 120) ?? null });
          return back("petal_token", await issueUserToken(state.p, visitor.id));
        } catch (e) {
          console.error("[shared-oauth/google] callback failed", e instanceof Error ? e.message : String(e));
          return back("petal_auth_error", "failed");
        }
      },
    },
  },
});
