/**
 * /api/transcribe — server-side fallback for browsers without Web Speech API
 * (Safari iOS pre-17, Firefox, in-app webviews). The client records audio via
 * MediaRecorder, posts the blob here, we forward to a Whisper-class model on
 * the Lovable AI Gateway, and return plain text.
 *
 * Auth: gated to signed-in users so we don't pay for anonymous transcription.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { checkCreditBalance } from "@/server/credits.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB ≈ ~10 min of opus

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("LOVABLE_API_KEY not configured", { status: 500 });
        }
        // Lightweight auth: require a valid Supabase bearer.
        const authHeader = getRequestHeader("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("unauthorized", { status: 401 });
        }
        let userId: string;
        try {
          const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            { global: { headers: { Authorization: authHeader } } },
          );
          const { data, error } = await supabase.auth.getUser();
          if (error || !data?.user) return new Response("unauthorized", { status: 401 });
          userId = data.user.id;
        } catch {
          return new Response("unauthorized", { status: 401 });
        }
        const balance = await checkCreditBalance({ userId, amount: 0.01 });
        if (!balance.ok) return new Response("You're out of credits. Add credits to keep chatting.", { status: balance.reason === "insufficient_credits" ? 402 : 500 });

        const contentLength = Number(request.headers.get("content-length") || "0");
        if (contentLength > MAX_BYTES) {
          return new Response("audio too large (max 10 MB)", { status: 413 });
        }

        const incoming = await request.formData();
        const file = incoming.get("audio");
        if (!(file instanceof File)) {
          return new Response("missing audio file", { status: 400 });
        }
        const lang = (incoming.get("lang") as string) || "en";

        const upstream = new FormData();
        upstream.append("file", file, file.name || "audio.webm");
        upstream.append("model", "whisper-1");
        upstream.append("language", lang.split("-")[0]);
        upstream.append("response_format", "json");

        const res = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: upstream,
        });
        if (!res.ok) {
          const body = await res.text();
          console.error("[transcribe] gateway error", res.status, body);
          if (res.status === 402) return new Response("ai credits exhausted", { status: 402 });
          if (res.status === 429) return new Response("rate limited", { status: 429 });
          return new Response("transcription failed", { status: 502 });
        }
        const json = (await res.json()) as { text?: string };
        return Response.json({ text: (json.text ?? "").trim() });
      },
    },
  },
});
