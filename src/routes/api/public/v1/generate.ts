/**
 * POST /api/public/v1/generate — start a build for an API-owned project.
 *
 * Body: { projectId, prompt, history?: [{role, content}], webhookUrl?, planFirst? }
 * Response: the engine's live Server-Sent Events stream (turn_id, phase,
 * status, result, done …). When `webhookUrl` is given, a signed POST is also
 * sent when the turn reaches its terminal `done` event.
 *
 * The request is forwarded to the unchanged /api/generate pipeline with a
 * real service-account session, so every gate, checkpoint and billing rule
 * still applies.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  CORS_HEADERS,
  deliverWebhook,
  isAllowedWebhookUrl,
  json,
  loadOwnedProject,
  loadProjectFiles,
  preflight,
  serviceAccessToken,
  verifyServiceKey,
} from "@/server/service-api.server";

const Body = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(60_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(60_000) }))
    .max(100)
    .optional(),
  webhookUrl: z.string().url().max(2000).optional(),
  planFirst: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/v1/generate")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const { projectId, prompt, history, webhookUrl, planFirst } = parsed.data;
        if (webhookUrl && !isAllowedWebhookUrl(webhookUrl)) {
          return json({ error: "webhook_url_not_allowed" }, 400);
        }
        const project = await loadOwnedProject(projectId);
        if (!project) return json({ error: "project_not_found" }, 404);

        const [token, files] = await Promise.all([serviceAccessToken(), loadProjectFiles(projectId)]);
        const now = Date.now();
        const inner = new Request(new URL("/api/generate", request.url), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            projectId,
            messages: [
              ...(history ?? []).map((m, i) => ({ ...m, ts: now - (history!.length - i) * 1000 })),
              { role: "user", content: prompt, ts: now },
            ],
            currentFiles: files,
            autoPlan: planFirst ?? false,
            planFirst: planFirst ?? false,
          }),
        });

        const { handleGenerateRequest } = await import("@/routes/api/generate");
        const res = await handleGenerateRequest(inner);
        if (!res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
          const text = await res.text();
          return new Response(text, {
            status: res.status,
            headers: { "Content-Type": res.headers.get("content-type") ?? "application/json", ...CORS_HEADERS },
          });
        }

        // Tap the stream: forward every byte, remember turn id + result, fire webhook on `done`.
        let turnId: string | null = null;
        let result: Record<string, unknown> | null = null;
        let fired = false;
        let buf = "";
        const decoder = new TextDecoder();
        const fire = async (status: string) => {
          if (fired || !webhookUrl) return;
          fired = true;
          await deliverWebhook(webhookUrl, {
            event: "turn.completed",
            projectId,
            turnId,
            status,
            committedRevision: result?.committedRevision ?? null,
            persisted: result?.persisted ?? false,
            creditsCharged: result?.creditsCharged ?? null,
            summary: result?.summary ?? null,
          });
        };
        const tap = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            controller.enqueue(chunk);
            buf += decoder.decode(chunk, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";
            for (const block of parts) {
              const line = block.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
                if (evt.type === "turn_id" && typeof evt.turnId === "string") turnId = evt.turnId;
                if (evt.type === "result") {
                  const { files: _f, ...rest } = evt;
                  result = rest;
                }
                if (evt.type === "done") await fire(String(evt.status ?? "unknown"));
              } catch {
                /* non-JSON keepalive */
              }
            }
          },
          async flush() {
            await fire(result ? "succeeded" : "disconnected");
          },
        });
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        return new Response(res.body.pipeThrough(tap), { status: res.status, headers });
      },
    },
  },
});
