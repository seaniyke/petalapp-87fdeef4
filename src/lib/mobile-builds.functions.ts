/**
 * Server functions for the Tier 2 native-mobile shell — Petal-owned flow.
 *
 * Three operations:
 *  - getMobileAppStatus: cheap read for the panel UI. Returns whether the
 *    project has been provisioned, the auto-generated bundle id, and
 *    whether a signing profile exists. Replaces the old user-input setup.
 *  - startMobileBuild: zero-config build. On first call it provisions the
 *    GitHub mirror repo + Codemagic app + auto bundle id; then snapshots
 *    project files to the mirror, triggers Codemagic, charges the wallet.
 *  - upsertSigningProfile: encrypted store of Apple/Android materials for
 *    signed (App Store / Play Store) builds. Optional — unsigned builds
 *    work without it.
 *
 * Memory rule: mobile is paid-plan gated, never a top-up modal. Free users
 * get a typed `plan_required` failure so the UI routes them to Upgrade.
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
} from "@/server/mobile-service.server";
import { chargeRuntime } from "@/server/runtime-wallet.server";
import {
  ensureMirrorRepo,
  pushSnapshot,
  repoNameForProject,
} from "@/server/mobile-github.server";
import { encryptForProject } from "@/server/mobile-crypto.server";
import { CODEMAGIC_YAML } from "@/server/mobile-codemagic-template.server";
import type { ProjectFile } from "@/server/generate.server";

const PROJECT_ID = z.string().uuid();

const StartBuildSchema = z.object({
  projectId: PROJECT_ID,
  platform: z.enum(["ios", "android"]),
  kind: z.enum(["unsigned", "signed"]),
});

const StatusSchema = z.object({ projectId: PROJECT_ID });

// Signing-profile inputs are large blobs; keep limits generous but bounded.
const SigningSchema = z.object({
  projectId: PROJECT_ID,
  apple: z
    .object({
      teamId: z.string().min(1).max(32),
      bundleId: z.string().min(3).max(155),
      p12Base64: z.string().min(1).max(2_000_000), // ~1.5MB after base64
      p12Password: z.string().min(1).max(256),
      provisioningProfileBase64: z.string().min(1).max(2_000_000),
      appStoreConnectKeyId: z.string().min(1).max(32),
      appStoreConnectIssuerId: z.string().min(1).max(64),
      appStoreConnectKeyP8: z.string().min(1).max(20_000),
    })
    .optional(),
  android: z
    .object({
      keystoreBase64: z.string().min(1).max(2_000_000),
      keystorePassword: z.string().min(1).max(256),
      keyAlias: z.string().min(1).max(128),
      keyPassword: z.string().min(1).max(256),
      playServiceAccountJson: z.string().min(1).max(50_000),
    })
    .optional(),
});

/**
 * Auto-generate a stable, valid reverse-DNS bundle id for a project. We
 * use `app.petal.<8charProjectIdPrefix>` so it's deterministic, unique
 * across all Petal projects, and never collides with a real user-owned
 * domain prefix.
 */
function autoBundleId(projectId: string): string {
  const slug = projectId.replace(/-/g, "").slice(0, 8).toLowerCase();
  return `app.petal.p${slug}`;
}

export const getMobileAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: app } = await supabase
      .from("mobile_apps")
      .select("id, bundle_id, github_repo, signing_profile_id")
      .eq("project_id", data.projectId)
      .maybeSingle();
    const { data: profile } = await supabase
      .from("mobile_signing_profiles")
      .select("id, apple_team_id, android_key_alias")
      .eq("project_id", data.projectId)
      .maybeSingle();
    return {
      provisioned: !!app,
      bundleId: app?.bundle_id ?? autoBundleId(data.projectId),
      githubRepo: app?.github_repo ?? null,
      signing: {
        hasApple: !!profile?.apple_team_id,
        hasAndroid: !!profile?.android_key_alias,
      },
    };
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
    | "signing_required"
    | "insufficient_balance"
    | "project_cap_exceeded"
    | "workspace_cap_exceeded"
    | "provider_error"
    | "internal_error";
  message?: string;
};

/**
 * Idempotently provision the GitHub mirror + Codemagic app for a project.
 * Returns the canonical mobile_apps row. Safe to call from inside
 * startMobileBuild — multiple concurrent calls converge to the same row.
 */
async function ensurePetalMobileApp(projectId: string): Promise<{
  id: string;
  bundleId: string;
  codemagicAppId: string;
  workflowId: string;
  defaultBranch: string;
  githubRepo: string;
  signingProfileId: string | null;
}> {
  // Read first — happy path skips the provisioning entirely.
  const { data: existing } = await supabaseAdmin
    .from("mobile_apps")
    .select(
      "id, bundle_id, codemagic_app_id, workflow_id, default_branch, github_repo, signing_profile_id",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (
    existing &&
    existing.bundle_id &&
    existing.codemagic_app_id &&
    existing.github_repo
  ) {
    return {
      id: existing.id,
      bundleId: existing.bundle_id,
      codemagicAppId: existing.codemagic_app_id,
      workflowId: existing.workflow_id,
      defaultBranch: existing.default_branch,
      githubRepo: existing.github_repo,
      signingProfileId: existing.signing_profile_id,
    };
  }

  // Provision: GitHub mirror first (cheap if already exists).
  const repo = await ensureMirrorRepo(projectId);
  // Then Codemagic app (idempotent at the repo URL — re-creating returns
  // a duplicate-error which we map by re-reading mobile_apps).
  let codemagicAppId = existing?.codemagic_app_id ?? "";
  if (!codemagicAppId) {
    try {
      const created = await codemagicProvider.createApp({
        projectId,
        githubFullName: repo.fullName,
      });
      codemagicAppId = created.codemagicAppId;
    } catch (err) {
      // If Codemagic returns "already exists", we can safely continue —
      // the mirror repo URL is unique per project.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already.*exists|duplicate/i.test(msg)) throw err;
    }
  }
  const bundleId = existing?.bundle_id ?? autoBundleId(projectId);

  const { data: row, error } = await supabaseAdmin
    .from("mobile_apps")
    .upsert(
      {
        project_id: projectId,
        bundle_id: bundleId,
        codemagic_app_id: codemagicAppId,
        workflow_id: existing?.workflow_id ?? "petal-default",
        default_branch: repo.defaultBranch,
        github_repo: repo.fullName,
        github_default_branch: repo.defaultBranch,
      },
      { onConflict: "project_id" },
    )
    .select(
      "id, bundle_id, codemagic_app_id, workflow_id, default_branch, github_repo, signing_profile_id",
    )
    .single();
  if (error || !row) {
    throw new Error(`mobile_apps upsert failed: ${error?.message ?? "no row"}`);
  }
  return {
    id: row.id,
    bundleId: row.bundle_id ?? bundleId,
    codemagicAppId: row.codemagic_app_id ?? codemagicAppId,
    workflowId: row.workflow_id,
    defaultBranch: row.default_branch,
    githubRepo: row.github_repo ?? repo.fullName,
    signingProfileId: row.signing_profile_id,
  };
}

/**
 * Snapshot the project's source files to the mirror repo. The first commit
 * also injects the petal-mobile-shell `codemagic.yaml` so Codemagic can
 * discover the build workflow.
 */
async function pushProjectSnapshot(args: {
  projectId: string;
  fullName: string;
  branch: string;
}): Promise<void> {
  const { data: rows, error } = await supabaseAdmin
    .from("project_files")
    .select("path, content")
    .eq("project_id", args.projectId);
  if (error) throw new Error(`project_files read failed: ${error.message}`);
  const files: ProjectFile[] = (rows ?? []).map((r) => ({
    path: r.path,
    content: r.content ?? "",
  }));
  // Always include the codemagic config — overrides any user-authored one
  // so the workflow definitions stay under Petal control.
  const withCodemagic = files
    .filter((f) => f.path !== "codemagic.yaml")
    .concat({ path: "codemagic.yaml", content: CODEMAGIC_YAML });
  await pushSnapshot({
    fullName: args.fullName,
    branch: args.branch,
    files: withCodemagic,
    message: `petal: snapshot for build ${new Date().toISOString()}`,
  });
}

/**
 * Build the Codemagic environment-variable map for a signed build by
 * decrypting the project's signing profile. Only called when kind="signed".
 * Uses base64-encoded blobs as-is (workflow decodes them to disk).
 */
async function loadSigningEnv(
  projectId: string,
  platform: MobilePlatform,
): Promise<Record<string, string> | null> {
  const { data: profile } = await supabaseAdmin
    .from("mobile_signing_profiles")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!profile) return null;

  const { decryptForProject } = await import("./mobile-crypto.server");
  const env: Record<string, string> = {};

  if (platform === "ios") {
    if (
      !profile.apple_team_id ||
      !profile.apple_p12_ciphertext ||
      !profile.apple_provisioning_profile_ciphertext
    ) {
      return null;
    }
    env.APPLE_TEAM_ID = profile.apple_team_id;
    env.APPLE_BUNDLE_ID = profile.apple_bundle_id ?? "";
    env.APPLE_P12_BASE64 = await decryptForProject(
      projectId,
      profile.apple_p12_ciphertext,
    );
    env.APPLE_P12_PASSWORD = await decryptForProject(
      projectId,
      profile.apple_p12_password_ciphertext ?? "",
    );
    env.APPLE_PROVISIONING_PROFILE_BASE64 = await decryptForProject(
      projectId,
      profile.apple_provisioning_profile_ciphertext,
    );
    if (profile.apple_app_store_connect_key_ciphertext) {
      env.APP_STORE_CONNECT_KEY_ID =
        profile.apple_app_store_connect_key_id ?? "";
      env.APP_STORE_CONNECT_ISSUER_ID =
        profile.apple_app_store_connect_issuer_id ?? "";
      env.APP_STORE_CONNECT_KEY_P8 = await decryptForProject(
        projectId,
        profile.apple_app_store_connect_key_ciphertext,
      );
    }
  } else {
    if (!profile.android_keystore_ciphertext || !profile.android_key_alias) {
      return null;
    }
    env.ANDROID_KEYSTORE_BASE64 = await decryptForProject(
      projectId,
      profile.android_keystore_ciphertext,
    );
    env.ANDROID_KEYSTORE_PASSWORD = await decryptForProject(
      projectId,
      profile.android_keystore_password_ciphertext ?? "",
    );
    env.ANDROID_KEY_ALIAS = profile.android_key_alias;
    env.ANDROID_KEY_PASSWORD = await decryptForProject(
      projectId,
      profile.android_key_password_ciphertext ?? "",
    );
    if (profile.android_play_service_account_ciphertext) {
      env.PLAY_SERVICE_ACCOUNT_JSON = await decryptForProject(
        projectId,
        profile.android_play_service_account_ciphertext,
      );
    }
  }
  return env;
}

export const startMobileBuild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StartBuildSchema.parse(input))
  .handler(async ({ data, context }): Promise<StartBuildOk | StartBuildFail> => {
    const { supabase, userId } = context;
    const platform = data.platform as MobilePlatform;
    const kind = data.kind as MobileBuildKind;

    // 1. Paid-plan gate. Mobile is paid-only, like backend/email/domain.
    const { data: wallet, error: walletErr } = await supabase
      .from("user_wallets")
      .select("plan_code")
      .eq("user_id", userId)
      .maybeSingle();
    if (walletErr) return { ok: false, reason: "internal_error", message: walletErr.message };
    if ((wallet?.plan_code ?? "free") === "free") {
      return { ok: false, reason: "plan_required" };
    }

    // 2. Provision (idempotent) — GitHub mirror + Codemagic app + bundle id.
    let app: Awaited<ReturnType<typeof ensurePetalMobileApp>>;
    try {
      app = await ensurePetalMobileApp(data.projectId);
    } catch (err) {
      console.error("[mobile] provisioning failed", err);
      return {
        ok: false,
        reason: "provider_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 3. For signed builds, ensure a signing profile is on file.
    let signingEnv: Record<string, string> | undefined;
    if (kind === "signed") {
      const env = await loadSigningEnv(data.projectId, platform);
      if (!env) return { ok: false, reason: "signing_required" };
      signingEnv = env;
    }

    // 4. Push a fresh snapshot of project files to the mirror so Codemagic
    //    builds the latest version, not whatever was there last time.
    try {
      await pushProjectSnapshot({
        projectId: data.projectId,
        fullName: app.githubRepo,
        branch: app.defaultBranch,
      });
    } catch (err) {
      console.error("[mobile] snapshot push failed", err);
      return {
        ok: false,
        reason: "provider_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 5. Kick the Codemagic build. Use the signed workflow when applicable
    //    so the YAML can branch on signing steps.
    let codemagicBuildId: string;
    let estimatedCostUsd: number;
    try {
      const result = await codemagicProvider.startBuild({
        projectId: data.projectId,
        platform,
        kind,
        bundleId: app.bundleId,
        codemagicAppId: app.codemagicAppId,
        workflowId:
          kind === "signed" ? `${app.workflowId}-signed` : app.workflowId,
        branch: app.defaultBranch,
        signingEnv,
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

    // 6. Charge the wallet only after Codemagic confirms the queue.
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
      console.warn("[mobile] wallet charge failed after Codemagic queue", charge);
      return { ok: false, reason: charge.reason, message: charge.message };
    }

    // 7. Persist the build row (service role).
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
        signing_profile_id: kind === "signed" ? app.signingProfileId : null,
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

    // 8. Update mobile_apps.latest_build_id (best effort).
    await supabaseAdmin
      .from("mobile_apps")
      .update({ latest_build_id: build.id })
      .eq("id", app.id);

    return { ok: true, buildId: build.id, codemagicBuildId, estimatedCostUsd };
  });

/**
 * Upsert encrypted signing materials for a project. Called from the
 * "Add signing certificate" advanced sheet. Either `apple` or `android`
 * (or both) may be present per call — we merge with whatever's already
 * there so users can fill in iOS first and Android later.
 */
export const upsertSigningProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SigningSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify ownership via RLS-respecting client before we touch encrypted data.
    const { data: ok } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!ok) return { ok: false as const, reason: "not_owner" as const };

    const enc = (s: string) => encryptForProject(data.projectId, s);
    const update: Record<string, unknown> = { project_id: data.projectId };

    if (data.apple) {
      update.apple_team_id = data.apple.teamId;
      update.apple_bundle_id = data.apple.bundleId;
      update.apple_p12_ciphertext = await enc(data.apple.p12Base64);
      update.apple_p12_password_ciphertext = await enc(data.apple.p12Password);
      update.apple_provisioning_profile_ciphertext = await enc(
        data.apple.provisioningProfileBase64,
      );
      update.apple_app_store_connect_key_id = data.apple.appStoreConnectKeyId;
      update.apple_app_store_connect_issuer_id = data.apple.appStoreConnectIssuerId;
      update.apple_app_store_connect_key_ciphertext = await enc(
        data.apple.appStoreConnectKeyP8,
      );
    }
    if (data.android) {
      update.android_keystore_ciphertext = await enc(data.android.keystoreBase64);
      update.android_keystore_password_ciphertext = await enc(
        data.android.keystorePassword,
      );
      update.android_key_alias = data.android.keyAlias;
      update.android_key_password_ciphertext = await enc(data.android.keyPassword);
      update.android_play_service_account_ciphertext = await enc(
        data.android.playServiceAccountJson,
      );
    }

    const { data: row, error } = await supabaseAdmin
      .from("mobile_signing_profiles")
      .upsert(update as never, { onConflict: "project_id" })
      .select("id")
      .single();
    if (error || !row) {
      return { ok: false as const, reason: "internal_error" as const, message: error?.message };
    }
    // Link back to mobile_apps so the build path can find it.
    await supabaseAdmin
      .from("mobile_apps")
      .update({ signing_profile_id: row.id })
      .eq("project_id", data.projectId);
    return { ok: true as const, signingProfileId: row.id };
  });
