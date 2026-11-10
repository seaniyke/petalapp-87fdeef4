/**
 * POST /api/public/v1/generate — start a build for an API-owned project.
 *
 * Body: { projectId, prompt, history?: [{role, content}], webhookUrl?, planFirst?,
 *         agentId?, widgetTag? }
 * `agentId` / `widgetTag` (or a Custard widget <script> pasted in the prompt)
 * pick the AI staff member; the tag is kept with its data-* attributes and
 * ?agent= query and added to every published build of the project.
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
  followBuild,
  triggerProjectBuild,
  type PublicBuild,
  isAllowedWebhookUrl,
  json,
  loadOwnedProject,
  loadProjectFiles,
  preflight,
  previewFields,
  serviceAccessToken,
  serviceUserId,
  tailTurnEvents,
  verifyApiCaller,
} from "@/server/service-api.server";
import { turnBill, type TurnBill } from "@/server/service-billing.server";

const Body = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(60_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(60_000) }))
    .max(100)
    .optional(),
  webhookUrl: z.string().url().max(2000).optional(),
  planFirst: z.boolean().optional(),
  agentId: z.string().trim().regex(/^[A-Za-z0-9_\-.:]{1,200}$/).optional(),
  widgetTag: z.string().max(2000).optional(),
});

export const Route = createFileRoute("/api/public/v1/generate")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const { projectId, prompt, history, planFirst } = parsed.data;
        // Custard AI's agreed receiver is the default when the call omits one.
        const webhookUrl = parsed.data.webhookUrl ?? "https://custardai.dev/api/public/petal/webhook";
        if (webhookUrl && !isAllowedWebhookUrl(webhookUrl)) {
          return json({ error: "webhook_url_not_allowed" }, 400);
        }
        const project = await loadOwnedProject(projectId, request);
        if (!project) return json({ error: "project_not_found" }, 404);

        // Remember which Custard staff member this site belongs to, so every
        // published build carries the full widget tag (data-agent / ?agent=).
        {
          const w = await import("@/server/custard-widget.server");
          const tag =
            w.parseCustardWidgetTag(parsed.data.widgetTag) ??
            (parsed.data.agentId ? w.custardWidgetTagForAgent(parsed.data.agentId) : null) ??
            w.parseCustardWidgetTag(prompt);
          if (tag) await w.saveCustardWidgetTag(projectId, tag);
        }

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

        // Forward the engine stream; if the build was handed to the build
        // server (stream ends without `done`), keep following its durable
        // events. Fire the webhook once on the terminal `done`.
        let turnId: string | null = null;
        let result: Record<string, unknown> | null = null;
        let lastSeq = 0;
        let fired = false;
        let turnStatus = "unknown";
        const followDeploy = async (emit: (evt: Record<string, unknown>) => void): Promise<string | null> => {
          const revision = typeof result?.committedRevision === "number" ? result.committedRevision : null;
          const started = await triggerProjectBuild(new URL(request.url).origin, projectId, { turnId, revision });
          if (!started.ok || !started.buildId) {
            const error = started.ok ? "no_build_started" : started.error;
            emit({ type: "build", status: "failed", error });
            if (webhookUrl) {
              await deliverWebhook(webhookUrl, { event: "build.completed", projectId, turnId, buildId: null, status: "failed", deploymentUrl: null, error });
            }
            return null;
          }
          let last: PublicBuild | null = null;
          for await (const b of followBuild(projectId, started.buildId)) {
            last = b;
            emit({ type: "build", ...b });
          }
          const finished = last?.status === "ready" || last?.status === "failed";
          if (!finished) emit({ type: "build", buildId: started.buildId, status: last?.status ?? "pending", note: "still running; poll GET /api/public/v1/projects/:id/builds" });
          if (webhookUrl && finished && last) {
            await deliverWebhook(webhookUrl, {
              event: "build.completed",
              projectId,
              turnId,
              buildId: last.buildId,
              revision: last.revision,
              status: last.status,
              deploymentUrl: last.deploymentUrl,
              ...previewFields(last.deploymentUrl),
              error: last.error,
            });
          }
          return last?.deploymentUrl ?? null;
        };
        const fire = async (status: string, url: string | null = null) => {
          if (fired || !webhookUrl) return;
          fired = true;
          let billing: TurnBill | null = null;
          if (turnId) {
            billing = await serviceUserId()
              .then((owner) => turnBill(owner, turnId as string))
              .catch(() => null);
          }
          await deliverWebhook(webhookUrl, {
            event: "turn.completed",
            projectId,
            turnId,
            status,
            ...previewFields(url),
            committedRevision: result?.committedRevision ?? null,
            persisted: result?.persisted ?? false,
            creditsCharged: result?.creditsCharged ?? null,
            // Net credits this turn cost (charges minus refunds), from the ledger.
            creditsUsed: billing?.net ?? null,
            billing,
            summary: result?.summary ?? null,
          });
        };
        const observe = async (evt: Record<string, unknown>) => {
          if (evt.type === "turn_id" && typeof evt.turnId === "string") turnId = evt.turnId;
          if (typeof evt.seq === "number") lastSeq = Math.max(lastSeq, evt.seq);
          if (evt.type === "result") {
            const { files: _f, ...rest } = evt;
            result = rest;
          }
          if (evt.type === "done") {
            turnStatus = String(evt.status ?? "unknown");
            // A succeeded turn waits for its build so turn.completed carries the live address.
            if (!(turnStatus === "succeeded" && result?.persisted !== false)) await fire(turnStatus);
            return true;
          }
          return false;
        };
        const encoder = new TextEncoder();
        const source = res.body;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const decoder = new TextDecoder();
            const reader = source.getReader();
            let buf = "";
            let done = false;
            try {
              for (;;) {
                const { value, done: end } = await reader.read();
                if (end) break;
                controller.enqueue(value);
                buf += decoder.decode(value, { stream: true });
                const parts = buf.split("\n\n");
                buf = parts.pop() ?? "";
                for (const block of parts) {
                  const line = block.split("\n").find((l) => l.startsWith("data:"));
                  if (!line) continue;
                  try {
                    if (await observe(JSON.parse(line.slice(5).trim()))) done = true;
                  } catch {
                    /* keepalive */
                  }
                }
              }
              if (!done && turnId) {
                for await (const e of tailTurnEvents(turnId, lastSeq)) {
                  const evt = { type: e.kind, ...e.payload, seq: e.seq };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
                  if (await observe(evt)) {
                    done = true;
                    break;
                  }
                }
              }
              if (!done) await fire("disconnected");
              // A successful turn always continues to compile + test + deploy.
              // The build server normally starts this itself; the trigger is
              // idempotent per revision, so this only guarantees it happened
              // and lets the caller follow the build to its live address.
              if (done && turnStatus === "succeeded" && result?.persisted !== false) {
                let url: string | null = null;
                try {
                  url = await followDeploy((evt) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)));
                } finally {
                  await fire(turnStatus, url);
                }
              }
            } catch (e) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`),
              );
            } finally {
              controller.close();
            }
          },
        });
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        return new Response(stream, { status: res.status, headers });
      },
    },
  },
});
