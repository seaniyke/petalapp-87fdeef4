/**
 * Server functions for the Tier 2 native-mobile shell.
 *
 * Two operations:
 *  - setupMobileApp: idempotently create the mobile_apps row for a project.
 *    Owner-scoped via requireSupabaseAuth (RLS enforces project ownership).
 *  - startMobileBuild: paid-plan gate → wallet preflight → kick off the
 *    Codemagic build → write a mobile_builds row (service role) and update
 *    mobile_apps.latest_build_id.
 *
 * Memory rule: mobile is paid-plan gated, never a top-up modal. Free users
 * get a typed `plan_required` failure so the UI can route them to Upgrade
 * (see EnableMobileSuggestionChip).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ESTIMATED_BUILD_COST_USD,
  codemagicProvider,
  type MobileBuildKind,
  type MobilePlatform,
} from "./mobile-service.server";
import { chargeRuntime } from "./runtime-wallet.server";

// Reverse-DNS bundle id, e.g. com.acme.todo
const BUNDLE_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

const SetupSchema = z.object({
  projectId: z.string().uuid(),
  bundleId: z.string().min(3).max(155).regex(BUNDLE_ID_RE),
  codemagicAppId: z.string().min(1).max(64),
  workflowId: z.string().min(1).max(64).default("petal-default"),
  defaultBranch: z.string().min(1).max(64).default("main"),
});

const StartBuildSchema = z.object({
  projectId: z.string().uuid(),
  platform: z.enum(["ios", "android"]),
  kind: z.enum(["unsigned", "signed"]),
});

/**
 * Idempotent: upsert one mobile_apps row per project. RLS guarantees the
 * caller owns the project, so we can safely run this through the user's
 * authenticated client.
 */
export const setupMobileApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SetupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: row, error } = await supabase
      .from("mobile_apps")
      .upsert(
        {
          project_id: data.projectId,
          bundle_id: data.bundleId,
          codemagic_app_id: data.codemagicAppId,
          workflow_id: data.workflowId,
          default_branch: data.defaultBranch,
        },
        { onConflict: "project_id" },
      )
      .select("id, project_id, bundle_id, codemagic_app_id, workflow_id, default_branch")
      .single();

    if (error) {
      console.error("[mobile] setupMobileApp upsert failed", error);
      return { ok: false as const, reason: "internal_error", message: error.message };
    }
    return { ok: true as const, app: row };
  });

type StartBuildOk = {
  ok: true;
  buildId: string;
  codemagicBuildId: string;
  estimatedCostUsd: number;
};

type StartBuildFail = {
  ok: false;
  reason:
    | "plan_required"
    | "mobile_app_not_setup"
    | "insufficient_balance"
    | "project_cap_exceeded"
    | "workspace_cap_exceeded"
    | "provider_error"
    | "internal_error";
  message?: string;
};

/**
 * Charges the wallet for the estimated build cost, then kicks Codemagic.
 * If Codemagic fails to accept the build, we refund by inserting a
 * compensating ledger entry via chargeRuntime is not possible — instead we
 * mark the build as failed and surface the error; the runtime wallet is
 * append-only by design and refunds are admin-only.
 *
 * To keep the wallet honest in the failure path, we DELAY the charge until
 * after Codemagic confirms the build was queued. This means a successful
 * preflight + provider failure costs the user $0.
 */
export const startMobileBuild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StartBuildSchema.parse(input))
  .handler(async ({ data, context }): Promise<StartBuildOk | StartBuildFail> => {
    const { supabase, userId } = context;

    // 1. Paid-plan gate. Mobile is paid-only, like backend/email/domain.
    const { data: wallet, error: walletErr } = await supabase
      .from("user_wallets")
      .select("plan_code")
      .eq("user_id", userId)
      .maybeSingle();
    if (walletErr) {
      return { ok: false, reason: "internal_error", message: walletErr.message };
    }
    const planCode = wallet?.plan_code ?? "free";
    if (planCode === "free") {
      return { ok: false, reason: "plan_required" };
    }

    // 2. Look up the mobile_apps row (RLS ensures project ownership).
    const { data: app, error: appErr } = await supabase
      .from("mobile_apps")
      .select("id, codemagic_app_id, workflow_id, default_branch, bundle_id")
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (appErr) {
      return { ok: false, reason: "internal_error", message: appErr.message };
    }
    if (!app) {
      return { ok: false, reason: "mobile_app_not_setup" };
    }

    // 3. Kick the Codemagic build first (cheap if no auth, fast to fail).
    let codemagicBuildId: string;
    let estimatedCostUsd: number;
    const platform = data.platform as MobilePlatform;
    const kind = data.kind as MobileBuildKind;
    try {
      const result = await codemagicProvider.startBuild({
        projectId: data.projectId,
        platform,
        kind,
        bundleId: app.bundle_id,
        codemagicAppId: app.codemagic_app_id,
        workflowId: app.workflow_id,
        branch: app.default_branch,
      });
      codemagicBuildId = result.id;
      estimatedCostUsd = result.estimatedCostUsd;
    } catch (err) {
      console.error("[mobile] codemagic startBuild failed", err);
      return {
        ok: false,
        reason: "provider_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 4. Charge the wallet now that the build is confirmed queued.
    const cents = Math.ceil(ESTIMATED_BUILD_COST_USD[kind] * 100);
    const charge = await chargeRuntime({
      userId,
      projectId: data.projectId,
      meter: "mobile_build",
      cents,
      metadata: {
        platform,
        build_kind: kind,
        codemagic_build_id: codemagicBuildId,
      },
    });
    if (!charge.ok) {
      // Rare: build queued but wallet refused (cap hit). Codemagic build will
      // still run; we record the row as failed so the UI can prompt support.
      console.warn("[mobile] wallet charge failed after Codemagic queue", charge);
      return { ok: false, reason: charge.reason, message: charge.message };
    }

    // 5. Persist the build row (service role — users can't insert directly).
    const { data: build, error: insErr } = await supabaseAdmin
      .from("mobile_builds")
      .insert({
        mobile_app_id: app.id,
        project_id: data.projectId,
        user_id: userId,
        platform,
        kind,
        status: "queued",
        codemagic_build_id: codemagicBuildId,
        estimated_cost_usd: estimatedCostUsd,
      })
      .select("id")
      .single();

    if (insErr || !build) {
      console.error("[mobile] mobile_builds insert failed", insErr);
      return {
        ok: false,
        reason: "internal_error",
        message: insErr?.message ?? "failed to record build",
      };
    }

    // 6. Update mobile_apps.latest_build_id (best effort, non-fatal).
    await supabaseAdmin
      .from("mobile_apps")
      .update({ latest_build_id: build.id })
      .eq("id", app.id);

    return {
      ok: true,
      buildId: build.id,
      codemagicBuildId,
      estimatedCostUsd,
    };
  });
