/**
 * Codemagic → Petal webhook for mobile builds.
 *
 * The codemagic.yaml `publishing.scripts` step posts the build outcome
 * here, signed HMAC-SHA256 over `${timestamp}.${rawBody}` using
 * MOBILE_CODEMAGIC_WEBHOOK_SECRET. Updates `mobile_builds.status` and
 * stores the artifact URL so the UI can show a Download link.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PayloadSchema = z.object({
  codemagicBuildId: z.string().min(1).max(128),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  artifactUrl: z.string().max(1000).optional().default(""),
});

const MAX_SKEW_SECONDS = 300;

function verify(
  secret: string,
  rawBody: string,
  ts: string | null,
  sig: string | null,
): boolean {
  if (!ts || !sig) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/mobile/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.MOBILE_CODEMAGIC_WEBHOOK_SECRET;
        if (!secret) {
          console.error("MOBILE_CODEMAGIC_WEBHOOK_SECRET missing");
          return new Response("Server misconfigured", { status: 500 });
        }
        const rawBody = await request.text();
        const ts = request.headers.get("x-petal-timestamp");
        const sig = request.headers.get("x-petal-signature");
        if (!verify(secret, rawBody, ts, sig)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let json: unknown;
        try {
          json = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = PayloadSchema.safeParse(json);
        if (!parsed.success) {
          return new Response("Invalid body", { status: 400 });
        }
        const { codemagicBuildId, status, artifactUrl } = parsed.data;

        const update: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString(),
        };
        if (artifactUrl) update.artifact_url = artifactUrl;

        const { error } = await supabaseAdmin
          .from("mobile_builds")
          .update(update)
          .eq("codemagic_build_id", codemagicBuildId);
        if (error) {
          console.error("[mobile/callback] update failed", error);
          return new Response("DB error", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});
