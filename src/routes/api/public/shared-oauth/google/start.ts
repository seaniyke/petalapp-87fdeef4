/**
 * Site-visitor Google sign-in — step 1.
 *   GET /api/public/shared-oauth/google/start?project=<id>&key=<site key>&redirect=<page on the site>
 * Opened by the site as a full-page navigation (no headers possible), so the
 * site's public key travels as a query param. The return page must be on the
 * site's own hosts; a nonce cookie binds the callback to this browser.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { googleConfigured } from "@/server/shared-auth-rules";

const Query = z.object({
  project: z.string().uuid(),
  key: z.string().min(8).max(200),
  redirect: z.string().url().max(2000),
});

const page = (msg: string, status: number) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in</title><p style="font-family:system-ui;padding:2rem">${msg}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

export const Route = createFileRoute("/api/public/shared-oauth/google/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = Query.safeParse(Object.fromEntries(url.searchParams));
        if (!q.success) return page("This sign-in link is incomplete.", 400);
        if (!googleConfigured(process.env)) return page("Google sign-in isn't available yet.", 503);

        const { googleCallbackUrl, isAllowedSiteAddress, signGoogleState } = await import("@/server/shared-auth.server");
        // The nonce cookie must live on the callback's origin: hop there first.
        const callback = new URL(googleCallbackUrl());
        if (url.origin !== callback.origin) {
          return Response.redirect(`${callback.origin}${url.pathname}${url.search}`, 302);
        }
        const { resolveProjectAccess } = await import("@/server/shared-backend.server");
        if ((await resolveProjectAccess(q.data.project, q.data.key)) !== "ok") {
          return page("This site can't use sign-in right now.", 401);
        }
        if (!(await isAllowedSiteAddress(q.data.project, q.data.redirect))) {
          return page("Google sign-in only returns to this site's own pages.", 400);
        }
        const { state, nonce } = await signGoogleState(q.data.project, q.data.redirect);
        const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        google.searchParams.set("client_id", process.env.PETAL_GOOGLE_CLIENT_ID!);
        google.searchParams.set("redirect_uri", callback.toString());
        google.searchParams.set("response_type", "code");
        google.searchParams.set("scope", "openid email profile");
        google.searchParams.set("state", state);
        google.searchParams.set("prompt", "select_account");
        return new Response(null, {
          status: 302,
          headers: {
            Location: google.toString(),
            "Set-Cookie": `petal_g_nonce=${nonce}; Path=/api/public/shared-oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
