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
import { classifyBuildFailure, isInfrastructureBuildError } from "@/lib/friendly-errors";
import { verifySignature } from "@/server/builder.server";
import { judgeDefects } from "@/server/defect-judge.server";
import { routeJudgedDefects, summarizeRouting } from "@/server/agents/qa-board";

import { probeDeployedUrl } from "@/server/deploy-verify.server";
import { scoreVisualQA } from "@/server/visual-qa.server";
import { scoreCraftQA, type CraftContract } from "@/server/craft-qa.server";
import { recordBuildOutcome } from "@/server/turn-completion.server";
import { evaluateReadiness } from "@/server/readiness.server";
import { loadCasesForBuild } from "@/server/test-results.server";
import { runBackendAcceptance } from "@/server/backend-acceptance.server";
import { backendAcceptanceEnabled } from "@/server/completion-flags.server";
import { attachBuildEconomicsByProject } from "@/server/turn-economics.server";
import { warmProjectThumbnail } from "@/server/project-thumbnail.server";

/**
 * Pull the committed design contract for a project so craft QA judges the app
 * against what Kimble promised to build, not against generic taste. Missing
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
      productName: pic.understanding?.domain ?? null,
      summary: pic.understanding?.summary ?? null,
      palette: design
        ? [design.colors?.primary, design.colors?.accent, design.colors?.background]
            .map((role) => role?.light)
            .filter((c): c is string => typeof c === "string" && c.length > 0)
        : null,
      typography: design
        ? `${design.typography?.displayFont ?? ""} / ${design.typography?.bodyFont ?? ""}`.trim()
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
      // Keep this aligned with builder/src/verify.ts VISUAL_MAX_SHOTS.
      // Three widths across four routes is the normal quality-review payload.
      .max(12)
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
    .select("id, project_id, created_at")
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

  // Internal economics: how long this build occupied the builder, and how
  // long the browser check ran. Used to value build compute per request.
  const buildMs = existing.created_at
    ? Date.now() - new Date(existing.created_at).getTime()
    : null;
  const verifyMs =
    typeof payload.verification?.durationMs === "number"
      ? payload.verification.durationMs
      : null;
  void attachBuildEconomicsByProject({
    projectId: payload.projectId,
    buildId: payload.buildId,
    buildMs,
    verifyMs,
    result: payload.status === "ready" ? "ready" : "failed",
  });

  if (payload.status === "ready") {
    // AI Generation Bible §8 — the builder's own "ready" is a claim, not
    // evidence. Fetch the URL we are about to advertise as live and confirm
    // it serves a real app. A failed probe becomes an honest build failure;
    // crucially we do NOT repoint `latest_build_id`, so the last known-good
    // preview survives.
    const probe = await probeDeployedUrl(payload.url);
    // The live-site check goes through the ONE build decision like every
    // other outcome; there is no separate status path for it.
    const { decideBuildStatus: decideProbe } = await import("@/lib/build-status");
    const probeDecision = probe.ok
      ? null
      : decideProbe({
          built: true,
          deployProbeOk: false,
          blockingDefects: [],
          blockingIsEdgeNoiseOnly: false,
          hasPlaceholderFiles: false,
        });
    if (probeDecision && probeDecision.status === "failed") {
      console.warn(
        `[builds/callback] deploy verification failed for ${payload.buildId}: ${probe.reason} (${probe.status ?? "no status"})`,
      );
      await supabaseAdmin
        .from("project_builds")
        .update({
          status: probeDecision.status,
          dist_path: payload.url,
          error_message: `${probe.message} Kimble kept your previous preview live instead of shipping a broken one.`,
        })
        .eq("id", payload.buildId);
      await refundRolledBackBuild(payload.projectId, payload.buildId);
      await recordBuildOutcome({
        projectId: payload.projectId,
        buildId: payload.buildId,
        shipped: false,
        blockingDefects: [`The deployed app did not respond correctly: ${probe.reason}`],
        reason: "deploy probe failed",
      });
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
      // Only the "is it broken?" check can block shipping, so only it runs
      // before the preview goes live. Craft review is advisory — it runs
      // after the build is marked ready (see below) and joins the defect list
      // for the polish pass without delaying the first usable result.
      const broken = await scoreVisualQA({ shots, projectId: payload.projectId }).catch(() => [] as string[]);
      visualDefects = [...broken];
      if (visualDefects.length) {
        console.warn(
          `[builds/callback] visual QA found ${broken.length} defect(s) for ${payload.buildId}`,
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

    // Phase 4 — backend acceptance. The browser check proves pages render;
    // this proves the app's own database queries actually work with the key
    // it ships with. Findings join the same defect list the judge consumes.
    const acceptance = backendAcceptanceEnabled()
      ? await runBackendAcceptance({ projectId: payload.projectId })
      : { defects: [], evidence: [], ran: false };
    if (acceptance.ran && verification) {
      verification.defects = sanitizeVerificationDefects([
        ...verification.defects,
        ...acceptance.defects,
      ]);
      verification.ok = verification.defects.length === 0;
      (verification as Record<string, unknown>).backendAcceptance = {
        defects: acceptance.defects,
        evidence: acceptance.evidence,
      };
    }

    // A successful upload is only a candidate. Blank routes, uncaught errors,
    // and failed required flows fail closed so consumers that ask for the last
    // healthy build keep showing the previous working preview. Visual-only
    // craft findings remain attached for a later polish pass without taking a
    // functioning app offline.
    // Severity is judged semantically (W2) with the regex partition as the
    // deterministic prior and fallback — see `defect-judge.server.ts`.
    const partitioned = await judgeDefects({
      defects: verification?.defects ?? (acceptance.ran ? acceptance.defects : undefined),
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
    // producing 52x on every route. Kimble's own probe above already fetched
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
    // Incomplete generation (an import-resolver stand-in still saved) can
    // never be ready, whatever the browser saw.
    const { count: placeholderCount } = await supabaseAdmin
      .from("project_files")
      .select("path", { count: "exact", head: true })
      .eq("project_id", payload.projectId)
      .like("content", "%Auto-generated stub by % import-resolver%");
    const { decideBuildStatus } = await import("@/lib/build-status");
    const decision = decideBuildStatus({
      built: true,
      deployProbeOk: true,
      blockingDefects: partitioned.blocking,
      blockingIsEdgeNoiseOnly: edgeNoiseOnly,
      hasPlaceholderFiles: (placeholderCount ?? 0) > 0,
    });
    if (decision.status === "failed") {
      const message = [
        decision.reason === "incomplete generation"
          ? "The deployment completed, but the app is incomplete — some files are missing."
          : "The deployment completed, but Kimble's browser check found a runtime failure.",
        ...partitioned.blocking.slice(0, 8).map((defect) => `- ${defect}`),
        "Kimble kept the previous healthy preview live.",
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
      await recordBuildOutcome({
        projectId: payload.projectId,
        buildId: payload.buildId,
        shipped: false,
        blockingDefects: partitioned.blocking,
        reason: decision.reason,
      });
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
        // `evidence` is the human-readable proof Kimble reports back to the
        // user: "completed" without proof is exactly the claim we stopped
        // trusting from the builder.
        verification: verification
          ? ({
              ...verification,
              // Runtime-safe visual findings do not take the deployment
              // offline, but they must remain actionable so the existing
              // silent repair loop actually consumes the craft review.
              ok: partitioned.visual.length === 0,
              evidence: buildEvidence(verification),
            } as never)
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

    // Capture the app's preview image once, now that it is live, so gallery
    // and project cards never render a screenshot on demand. Best-effort: if
    // the worker cuts this short, the cron sweep backfills it.
    warmProjectThumbnail(payload.projectId, payload.buildId);

    // Craft review, now that the preview is live. Advisory only: findings are
    // appended for the polish pass; they never change ready/failed.
    if (payload.verification?.visual?.length && verification) {
      const craftStarted = Date.now();
      const craft = await loadCraftContract(payload.projectId)
        .then((contract) =>
          scoreCraftQA({ shots: payload.verification!.visual!, contract, projectId: payload.projectId }),
        )
        .catch(() => [] as string[]);
      console.info(
        `[builds/callback] craft QA post-ready notes=${craft.length} ms=${Date.now() - craftStarted} for ${payload.buildId}`,
      );
      if (craft.length) {
        const defects = sanitizeVerificationDefects([...verification.defects, ...craft]);
        await supabaseAdmin
          .from("project_builds")
          .update({
            verification: {
              ...verification,
              defects,
              ok: false,
              evidence: buildEvidence({ ...verification, defects }),
            } as never,
          })
          .eq("id", payload.buildId)
          .then(({ error }) => {
            if (error) console.warn("[builds/callback] craft QA save failed", error.message);
          });
      }
    }

    // Acceptance (phase 6): shipping is necessary, not sufficient. When the
    // Test Lab ran for this build, its must-work results decide the verdict —
    // and "could not check" never counts as ready. With no run recorded the
    // readiness helper reproduces the previous rule exactly.
    // Phase 5 — run the Test Lab against the app that is now live, scoped to
    // what this turn changed. Fails open: a testing problem never fails a
    // healthy deploy, it just leaves the verdict unverified.
    await runTestLabForBuild({
      projectId: payload.projectId,
      buildId: payload.buildId,
      url: payload.url,
    }).catch((err: unknown) => console.warn("[builds/callback] test lab failed", err));

    const labCases = await loadCasesForBuild(payload.buildId);
    const readiness = evaluateReadiness({
      shipped: true,
      blockingDefects: [],
      results: labCases,
    });
    {
      // Build + browser gates of the verification pipeline, judged on the
      // DEPLOYED app. "Could not check" is UNAVAILABLE, never PASS or FAIL.
      const { buildGate, browserGate } = await import("@/server/verification/gates");
      const b = buildGate("succeeded");
      const w = browserGate(readiness);
      console.info(`[verification] build=${b.verdict} browser=${w.verdict} build=${payload.buildId}${w.reasons[0] ? ` — ${w.reasons[0]}` : ""}`);
    }
    await recordBuildOutcome({
      projectId: payload.projectId,
      buildId: payload.buildId,
      shipped: true,
      blockingDefects: [],
      readiness,
      evidence: verification ? buildEvidence(verification) : ["Deployed URL served a real app"],
    });
  } else {
    // status === "failed"
    const message = payload.logs
      ? `${payload.errorMessage}\n\n--- logs ---\n${payload.logs}`
      : payload.errorMessage;

    // BUILD FAILURE RECOVERY (bounded, deterministic): an import of a real
    // package that package.json doesn't list is fixed by adding the package
    // and rebuilding ONCE (shares the build's single retry claim). No AI.
    {
      const failure = classifyBuildFailure(message);
      const pkgs = failure.kind === "missing_dependency" ? failure.packages : [];
      if (!payload.verification && pkgs.length) {
        try {
          const { data: row } = await supabaseAdmin
            .from("project_files")
            .select("content")
            .eq("project_id", payload.projectId)
            .eq("path", "package.json")
            .maybeSingle();
          if (row?.content) {
            const { addMissingDeps } = await import("@/server/engine/deps");
            const next = addMissingDeps(row.content as string, Array.from(new Set(pkgs)));
            if (next !== row.content) {
              await supabaseAdmin
                .from("project_files")
                .update({ content: next })
                .eq("project_id", payload.projectId)
                .eq("path", "package.json");
              const { retryStalledBuild } = await import("@/server/build-retry.server");
              const res = await retryStalledBuild(payload.buildId, { minStuckMs: 0, source: "callback-missing-dep", adoptCurrentRevision: true });
              console.warn(`[build-recovery] added ${pkgs.join(",")} → ${res.outcome}`);
              if (res.outcome === "retried" || res.outcome === "already_claimed") {
                return new Response("ok", { status: 200 });
              }
            }
          }
        } catch (err) {
          console.warn("[build-recovery] missing-dependency rebuild failed", err);
        }
      }
    }

    // Infrastructure failures (hosting edge unreachable, upstream timeout,
    // Cloudflare 5xx) have nothing to do with the user's app. Never surface
    // them: re-run the identical build immediately and silently while the
    // retry budget lasts. Only an exhausted budget writes a failed row, and
    // the retry helper owns that calm message.
    if (!payload.verification && isInfrastructureBuildError(message)) {
      try {
        const { retryStalledBuild } = await import("@/server/build-retry.server");
        const res = await retryStalledBuild(payload.buildId, {
          minStuckMs: 0,
          source: "callback-infra",
        });
        if (res.outcome === "retried" || res.outcome === "already_claimed") {
          console.warn(
            `[builds/callback] silently requeued ${payload.buildId} after infrastructure failure`,
          );
          return new Response("ok", { status: 200 });
        }
      } catch (err) {
        console.warn("[builds/callback] infrastructure requeue failed", err);
      }
    }



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
    const failedBlocking = Array.isArray(failedVerification?.blocking)
      ? (failedVerification.blocking as string[])
      : [];
    await recordBuildOutcome({
      projectId: payload.projectId,
      buildId: payload.buildId,
      shipped: false,
      blockingDefects: failedBlocking.length
        ? failedBlocking
        : [payload.errorMessage.slice(0, 500)],
      reason: "build failed",
    });
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
  if (!out.length) out.push("Deployed URL served a real app on Kimble's own probe");
  return out;
}

/**
 * Trust hygiene: a build the user cannot use must not stay on their bill.
 * When Kimble rolls a candidate back (failed probe or a browser-check failure),
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

/**
 * Phase 5 — drive the Test Lab over the freshly deployed app.
 *
 * Scope comes from the turn: the most recent recorded edit tells us which
 * files changed, so an edit only re-runs the must-work checks plus the pages
 * it touched. A first build (no edit record) gets the whole plan.
 *
 * Everything here is best-effort. Any failure leaves no recorded run, which
 * the readiness gate reads as "no Test Lab evidence" — unverified, not ready.
 */
async function runTestLabForBuild(args: {
  projectId: string;
  buildId: string;
  url: string;
}): Promise<void> {
  const { isBrowseConfigured } = await import("@/server/browse-client.server");
  if (!isBrowseConfigured()) return;

  const { data: rows } = await supabaseAdmin
    .from("project_files")
    .select("path, content")
    .eq("project_id", args.projectId);
  const files = (rows ?? []) as Array<{ path: string; content: string }>;
  if (!files.length) return;

  let changedPaths: string[] = [];
  let turnId: string | null = null;
  try {
    const { listEdits } = await import("@/server/edit-history.server");
    const recent = await listEdits(args.projectId, 1);
    const latest = recent?.[0] as
      | { changed_paths?: string[] | null; turn_id?: string | null }
      | undefined;
    if (latest) {
      changedPaths = latest.changed_paths ?? [];
      turnId = latest.turn_id ?? null;
    }
  } catch {
    /* no edit record — treat as a full run */
  }

  const { buildVerifyPlan } = await import("@/server/verify-plan.server");
  const verify = await buildVerifyPlan({
    files,
    projectId: args.projectId,
    skipFlows: true,
  }).catch(() => null);

  const { runTestLab } = await import("@/server/test-lab.server");
  const outcome = await runTestLab({
    projectId: args.projectId,
    buildId: args.buildId,
    turnId,
    baseUrl: args.url,
    files,
    verify,
    changedPaths,
  });
  if (!outcome.ran) {
    console.info(`[builds/callback] test lab skipped for ${args.buildId}: ${outcome.reason}`);
  }
}
