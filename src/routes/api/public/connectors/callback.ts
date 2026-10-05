/**
 * OAuth return address for one-click connectors. Public by necessity: the
 * caller is verified through the HMAC-signed, expiring `state` minted by
 * /api/connectors for a project owner. Returns a tiny page that tells the
 * opener window the result and closes.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  CALLBACK_PATH,
  OAUTH_PROVIDERS,
  encryptToken,
  exchangeCode,
  verifyState,
} from "@/server/connectors/oauth.server";

function page(ok: boolean, message: string) {
  const payload = JSON.stringify({ type: "kimble:connector", ok, message });
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Kimble</title><body style="font-family:system-ui;padding:2rem">${
      ok ? "Connected. You can close this window." : "Connection failed. You can close this window."
    }<script>try{window.opener&&window.opener.postMessage(${payload},"*")}catch(e){}setTimeout(function(){window.close()},800)</script></body>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/connectors/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = process.env.CONNECTOR_TOKEN_KEY;
        if (!key) return page(false, "Server not configured");
        const url = new URL(request.url);
        const st = await verifyState(key, url.searchParams.get("state") ?? "");
        if (!st) return page(false, "Link expired, please try again");
        const err = url.searchParams.get("error");
        if (err) return page(false, url.searchParams.get("error_description") ?? err);
        const code = url.searchParams.get("code");
        const p = OAUTH_PROVIDERS[st.c];
        if (!code || !p) return page(false, "Missing code");

        try {
          const tok = await exchangeCode(p, code, st.r + CALLBACK_PATH);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: project } = await supabaseAdmin
            .from("projects").select("owner_id").eq("id", st.p).maybeSingle();
          if (!project || project.owner_id !== st.u) return page(false, "Forbidden");
          const expiresIn = Number(tok.expires_in);
          const { error } = await (supabaseAdmin as unknown as { from: (t: string) => any })
            .from("connector_accounts")
            .upsert(
              {
                owner_id: st.u,
                project_id: st.p,
                connector_id: st.c,
                external_account: p.accountField ? String(tok[p.accountField] ?? "") : null,
                scopes: String(tok.scope ?? p.scopes.join(" ")).split(/[ ,]+/).filter(Boolean),
                token_ciphertext: await encryptToken(key, JSON.stringify(tok)),
                expires_at: Number.isFinite(expiresIn) && expiresIn > 0
                  ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
                status: "connected",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "project_id,connector_id" },
            );
          if (error) throw new Error(error.message);
          return page(true, "Connected");
        } catch (e) {
          console.error("connector callback failed", e);
          return page(false, e instanceof Error ? e.message : "Unknown error");
        }
      },
    },
  },
});
