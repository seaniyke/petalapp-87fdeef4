/**
 * Webhook called by the Railway builder when a build finishes (or fails).
 *
 * The builder signs every callback with HMAC-SHA256 using BUILDER_SHARED_SECRET.
 * We verify the signature before doing anything with the body — see
 * `src/server/builder.server.ts` for the matching `signRequest()` helper used
 * in the outgoing direction.
 *
 * URL: /api/public/builds/callback (under /api/public/* so platform auth
 *      doesn't shield it from Railway).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  allBlockingDefectsAreTransientEdge,
  
  sanitizeVerificationDefects,
} from "@/lib/verification-report";
import { verifySignature } from "@/server/builder.server";
import { judgeDefects } from "@/server/defect-judge.server";
import { routeJudgedDefects, summarizeRouting } from "@/server/agents/qa-board";

import { probeDeployedUrl } from "@/server/deploy-verify.server";
import { scoreVisualQA } from "@/server/visual-qa.server";
import { scoreCraftQA, type CraftContract } from "@/server/craft-qa.server";

/**
 * Pull the committed design contract for a project so craft QA judges the app
 * against what Petal promised to build, not against generic taste. Missing
 * intelligence is fine — the reviewer falls back to general craft standards.
 */
async function loadCraftContract(projectId: string): Promise<CraftContract | null> {
  try {
    const { loadPic } = await import("@/server/pic/pic-store.server");
    const stored = await loadPic(projectId);
    const pic = stored?.pic;
    if (!pic) return null;
    const design = pic.design;
    return {
      productName: pic.productName ?? null,
      summary: pic.understanding?.summary ?? null,
      palette: design
        ? [design.colors?.primary, design.colors?.accent, design.colors?.background]
            .map((c) => (typeof c === "string" ? c : (c as { value?: string })?.value))
            .filter((c): c is string => typeof c === "string" && c.length > 0)
        : null,
      typography: design
        ? `${design.typography?.displayFamily ?? ""} / ${design.typography?.bodyFamily ?? ""}`.trim()
        : null,
      personality: design?.direction ?? null,
    };
  } catch {
    return null;
  }
}


/**
 * Browser-verification report. Kept loose on purpose: the builder owns the
 * shape, and a schema mismatch must never reject an otherwise-good callback.
 */
const VerificationSchema = z
  .object({
    ok: z.boolean(),
    baseUrl: z.string().max(500).optional(),
    durationMs: z.number().optional(),
    routes: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
    auth: z.record(z.string(), z.unknown()).optional(),
    flows: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
    defects: z.array(z.string().max(1000)).max(60).optional(),
    visual: z
      .array(
        z.object({
          path: z.string().max(200),
          width: z.number(),
          image: z.string().max(2_000_000),
        }),
      )
      .max(6)
      .optional(),
    skipped: z.string().max(500).optional(),
  })
  .passthrough();

const CallbackSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    buildId: z.string().uuid(),
    projectId: z.string().uuid(),
    url: z.string().url().max(500),
    verification: VerificationSchema.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    buildId: z.string().uuid(),
    projectId: z.string().uuid(),
    errorMessage: z.string().min(1).max(2000),
    logs: z.string().max(8000).optional(),
    // Present when the pre-deploy browser check is what stopped the build.
    // Carries the exact defects so a repair can be aimed at them.
    verification: VerificationSchema.optional(),
  }),

]);

export async function handleBuildCallback(request: Request): Promise<Response> {
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!sharedSecret) {
    console.error("BUILDER_SHARED_SECRET missing");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Read body as text so we can verify the signature byte-for-byte.
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-petal-timestamp");
  const signature = request.headers.get("x-petal-signature");

  if (!verifySignature(sharedSecret, rawBody, timestamp, signature)) {
    console.warn("Builder callback rejected: invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const result = CallbackSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("Builder callback rejected: invalid body", result.error.flatten());
    return new Response("Invalid body", { status: 400 });
  }
  const payload = result.data;

  // Make sure the build row actually belongs to the claimed project.
  // Defends against a compromised builder or a bug that scrambles ids.
  const { data: existing } = await supabaseAdmin
    .from("project_builds")
    .select("id, project_id")
    .eq("id", payload.buildId)
    .maybeSingle();
  if (!existing) {
    console.warn("Builder callback for unknown build", payload.buildId);
    // Acknowledge so Railway doesn't retry forever.
    return new Response("ok", { status: 200 });
  }
  if (existing.project_id !== payload.projectId) {
    console.warn("Builder callback project mismatch", payload.buildId);
    return new Response("Project mismatch", { status: 400 });
  }

  if (payload.status === "ready") {
    // AI Generation Bible §8 — the builder's own "ready" is a claim, not
    // evidence. Fetch the URL we are about to advertise as live and confirm
    // it serves a real app. A failed probe becomes an honest build failure;
    // crucially we do NOT repoint `latest_build_id`, so the last known-good
    // preview survives.
    const probe = await probeDeployedUrl(payload.url);
    if (!probe.ok) {
      console.warn(
        `[builds/callback] deploy verification failed for ${payload.buildId}: ${probe.reason} (${probe.status ?? "no status"})`,
      );
      await supabaseAdmin
        .from("project_builds")
        .update({
          status: "failed",
          dist_path: payload.url,
          error_message: `${probe.message} Petal kept your previous preview live instead of shipping a broken one.`,
        })
        .eq("id", payload.buildId);
      await refundRolledBackBuild(payload.projectId, payload.buildId);
      return new Response("ok", { status: 200 });
    }

    // Visual QA — score the deployed screenshots with a vision model and fold
    // what it sees into the same defect list the repair loop already reads.
    // The images themselves are never persisted (they are megabytes of base64).
    //
    // Craft QA (Engine 3.0, phase 5) runs alongside it against the committed
    // design contract: "is this broken?" and "does this look designed?" are
    // different questions and a single reviewer answers both badly. Craft
    // findings are advisory by construction — they queue polish, never a
    // rollback.
    let visualDefects: string[] = [];
    if (payload.verification?.visual?.length) {
      const shots = payload.verification.visual;
      const [broken, craft] = await Promise.all([
        scoreVisualQA({ shots, projectId: payload.projectId }).catch(() => []),
        loadCraftContract(payload.projectId)
          .then((contract) => scoreCraftQA({ shots, contract, projectId: payload.projectId }))
          .catch(() => [] as string[]),
      ]);
      visualDefects = [...broken, ...craft];
      if (visualDefects.length) {
        console.warn(
          `[builds/callback] visual QA found ${broken.length} defect(s) and craft QA ${craft.length} note(s) for ${payload.buildId}`,
        );
      }
    }


    const verification = payload.verification
      ? (() => {
          const { visual: _shots, ...rest } = payload.verification;
          const defects = sanitizeVerificationDefects([
            ...(payload.verification.defects ?? []),
            ...visualDefects,
          ]);
          return {
            ...rest,
            visualChecked: Boolean(payload.verification.visual?.length),
            defects,
            ok: defects.length === 0,
          };
        })()
      : null;

    // A successful upload is only a candidate. Blank routes, uncaught errors,
    // and failed required flows fail closed so consumers that ask for the last
    // healthy build keep showing the previous working preview. Visual-only
    // craft findings remain attached for a later polish pass without taking a
    // functioning app offline.
    // Severity is judged semantically (W2) with the regex partition as the
    // deterministic prior and fallback — see `defect-judge.server.ts`.
    const partitioned = await judgeDefects({
      defects: verification?.defects,
      projectId: payload.projectId,
    });
    console.info(
      `[builds/callback] severity tier=${partitioned.tier} blocking=${partitioned.blocking.length} visual=${partitioned.visual.length} advisory=${partitioned.advisory.length} for ${payload.buildId}`,
    );

    // Phase E — QA board: give every finding an owning layer plus a scoped
    // repair brief, so a repair round targets the layer that owns the defect
    // instead of re-deriving the problem class from a flat list of strings.
    const routing = routeJudgedDefects(partitioned);
    if (routing.defects.length) console.info(summarizeRouting(routing));
    if (verification && routing.defects.length) {
      (verification as Record<string, unknown>).defectRouting = {
        defects: routing.defects,
        blockingOwners: routing.blockingOwners,
        byOwner: routing.byOwner,
        brief: routing.brief,
      };
    }

    if (partitioned.noise.length > 0 && verification) {
      console.warn(
        `[builds/callback] judge dropped ${partitioned.noise.length} checker-artefact finding(s) for ${payload.buildId}`,
      );
      verification.defects = verification.defects.filter(
        (defect) => !partitioned.noise.includes(defect),
      );
      verification.ok = verification.defects.length === 0;
    }
    // The browser check can run while the hosting edge is still propagating,
    // producing 52x on every route. Petal's own probe above already fetched
    // this exact URL and got a real app, so an all-edge-transient report is
    // inconclusive, not a build failure — never fail a healthy deploy on it.
    const edgeNoiseOnly = allBlockingDefectsAreTransientEdge(partitioned.blocking);

    if (edgeNoiseOnly) {
      console.warn(
        `[builds/callback] ignoring ${partitioned.blocking.length} transient edge finding(s) for ${payload.buildId}; server probe succeeded`,
      );
      if (verification) {
        verification.defects = verification.defects.filter(
          (defect) => !partitioned.blocking.includes(defect),
        );
        verification.ok = verification.defects.length === 0;
      }
    }
    if (!edgeNoiseOnly && partitioned.blocking.length > 0) {
      const message = [
        "The deployment completed, but Petal's browser check found a runtime failure.",
        ...partitioned.blocking.slice(0, 8).map((defect) => `- ${defect}`),
        "Petal kept the previous healthy preview live.",
      ].join("\n");
      const { error: rejectedCandidateError } = await supabaseAdmin
        .from("project_builds")
        .update({
          status: "failed",
          dist_path: payload.url,
          error_message: message.slice(0, 8000),
          ready_at: new Date().toISOString(),
          verification: verification as never,
        })
        .eq("id", payload.buildId);
      if (rejectedCandidateError) {
        console.error(
          "Builder callback could not reject browser-broken build",
          rejectedCandidateError.message,
        );
        return new Response("Could not save build status", { status: 503 });
      }
      await refundRolledBackBuild(payload.projectId, payload.buildId);
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const { error: buildUpdateError } = await supabaseAdmin
      .from("project_builds")
      .update({
        status: "ready",
        dist_path: payload.url,
        error_message: null,
        ready_at: new Date().toISOString(),
        // Null when the build predates verification or the plan was empty.
        // `evidence` is the human-readable proof Petal reports back to the
        // user: "completed" without proof is exactly the claim we stopped
        // trusting from the builder.
        verification: verification
          ? ({ ...verification, ok: true, evidence: buildEvidence(verification) } as never)
          : null,
      })
      .eq("id", payload.buildId);
    if (buildUpdateError) {
      console.error("Builder callback could not mark build ready", buildUpdateError.message);
      return new Response("Could not save build status", { status: 503 });
    }

    // Always point the project at its newest build so the UI shows it.
    const { error: projectUpdateError } = await supabaseAdmin
      .from("projects")
      .update({ latest_build_id: payload.buildId })
      .eq("id", payload.projectId);
    if (projectUpdateError) {
      console.error("Builder callback could not update project build", projectUpdateError.message);
      return new Response("Could not save project status", { status: 503 });
    }
  } else {
    // status === "failed"
    const message = payload.logs
      ? `${payload.errorMessage}\n\n--- logs ---\n${payload.logs}`
      : payload.errorMessage;

    // A pre-deploy browser check failure arrives with structured defects.
    // Score its screenshots too, then persist the report so the client can
    // start a targeted repair instead of guessing from a log tail.
    let failedVerification: Record<string, unknown> | null = null;
    if (payload.verification) {
      const visualDefects = payload.verification.visual?.length
        ? await scoreVisualQA({
            shots: payload.verification.visual,
            projectId: payload.projectId,
          }).catch(() => [])
        : [];
      const { visual: _shots, ...rest } = payload.verification;
      const rawDefects = sanitizeVerificationDefects([
        ...(payload.verification.defects ?? []),
        ...visualDefects,
      ]);
      const judged = await judgeDefects({
        defects: rawDefects,
        projectId: payload.projectId,
      });
      const defects = rawDefects.filter((defect) => !judged.noise.includes(defect));
      failedVerification = {
        ...rest,
        visualChecked: Boolean(payload.verification.visual?.length),
        defects,
        ok: false,
        blocking: judged.blocking,
      };

    }

    const { error: buildUpdateError } = await supabaseAdmin
      .from("project_builds")
      .update({
        status: "failed",
        error_message: message.slice(0, 8000),
        ready_at: new Date().toISOString(),
        ...(failedVerification ? { verification: failedVerification as never } : {}),
      })
      .eq("id", payload.buildId);
    if (buildUpdateError) {
      console.error("Builder callback could not mark build failed", buildUpdateError.message);
      return new Response("Could not save build status", { status: 503 });
    }
    // The build never shipped — the user keeps their credits.
    await refundRolledBackBuild(payload.projectId, payload.buildId);
  }


  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Turn a verification report into short proof lines the UI can show under a
 * completed build. Evidence, not adjectives.
 */
function buildEvidence(verification: Record<string, unknown>): string[] {
  const out: string[] = [];
  const routes = Array.isArray(verification.routes) ? verification.routes : [];
  const flows = Array.isArray(verification.flows) ? verification.flows : [];
  if (routes.length) out.push(`${routes.length} route(s) loaded without a runtime error`);
  if (flows.length) out.push(`${flows.length} user flow(s) completed end to end`);
  if (verification.visualChecked) out.push("Screenshots reviewed for layout and craft defects");
  if (typeof verification.durationMs === "number") {
    out.push(`Browser check ran for ${Math.round(verification.durationMs / 1000)}s`);
  }
  if (!out.length) out.push("Deployed URL served a real app on Petal's own probe");
  return out;
}

/**
 * Trust hygiene: a build the user cannot use must not stay on their bill.
 * When Petal rolls a candidate back (failed probe or a browser-check failure),
 * hand the build's credits back. The RPC is idempotent per build id, so a
 * retried callback can never refund twice.
 */
async function refundRolledBackBuild(projectId: string, buildId: string): Promise<void> {
  try {
    const { data, error } = await (supabaseAdmin as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc("refund_build_charge", { _project_id: projectId, _build_id: buildId });
    if (error) {
      console.error("[builds/callback] rollback refund failed", buildId, error.message);
      return;
    }
    const amount = Number(data ?? 0);
    if (amount > 0) {
      console.info(`[builds/callback] refunded ${amount} credit(s) for rolled-back build ${buildId}`);
    }
  } catch (e) {
    console.error("[builds/callback] rollback refund threw", buildId, (e as Error).message);
  }
}

export const Route = createFileRoute("/api/public/builds/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBuildCallback(request),
    },
  },
});
