/**
 * Server functions for /admin/ai-providers.
 *
 * Reads / writes the `ai_provider_settings` table. All routes are guarded by:
 *   1. requireSupabaseAuth — must be signed in.
 *   2. Explicit `has_role(uid, 'admin')` check inside the handler — RLS would
 *      also block non-admins, but we surface a clean 403 instead of an opaque
 *      Postgres error.
 *
 * After any write we call `invalidateProviderCache()` so the next AI request
 * reflects the change immediately, instead of waiting up to 30s for the cache
 * to expire on each Worker instance.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ALL_AI_FEATURES,
  invalidateProviderCache,
  type AiFeature,
} from "@/server/ai-provider.server";

type Provider = "lovable" | "openrouter";

export type AiFeatureRow = {
  feature: AiFeature;
  /** Effective provider after DB → env → default cascade. */
  effective: Provider;
  /** What the DB actually has (null = no override, falls back to env/default). */
  override: Provider | null;
  /** What the env vars say, for transparency. */
  envChoice: Provider | null;
  /** Locked features can't be changed (currently: image gen). */
  locked: boolean;
};

function envChoiceFor(feature: AiFeature): Provider | null {
  const perFeature = process.env[`AI_PROVIDER_${feature.toUpperCase()}`]?.toLowerCase();
  const global = process.env.AI_PROVIDER?.toLowerCase();
  const choice = perFeature || global;
  if (choice === "openrouter") return "openrouter";
  if (choice === "lovable") return "lovable";
  return null;
}

async function assertAdmin(supabase: ReturnType<typeof supabaseAdmin.from> extends never ? never : any, userId: string): Promise<void> {
  // Use the admin client with an explicit role check to avoid silent RLS fails.
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error("Admin check failed");
  if (!data) throw new Error("Forbidden: admin only");
}

/**
 * List every feature with its current effective provider + override status.
 * Returns the source-of-truth admins need to render the toggles correctly.
 */
export const listAiProviderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: AiFeatureRow[]; openrouterKeyConfigured: boolean }> => {
    await assertAdmin(context.supabase, context.userId);

    const { data, error } = await supabaseAdmin
      .from("ai_provider_settings")
      .select("feature, provider");
    if (error) throw new Error(error.message);

    const overrides = new Map<string, Provider>();
    for (const row of data ?? []) {
      if (row.provider === "openrouter" || row.provider === "lovable") {
        overrides.set(row.feature, row.provider);
      }
    }

    const rows: AiFeatureRow[] = ALL_AI_FEATURES.map((feature) => {
      const locked = feature === "image"; // image gen is hard-pinned to Lovable
      const override = overrides.get(feature) ?? null;
      const envChoice = envChoiceFor(feature);
      const effective: Provider = locked
        ? "lovable"
        : override ?? envChoice ?? "lovable";
      return { feature, effective, override, envChoice, locked };
    });

    return {
      rows,
      openrouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    };
  });

/**
 * Set (or clear) the override for a single feature.
 * Pass `provider: null` to remove the override and fall back to env/default.
 */
export const setAiProviderSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { feature: AiFeature; provider: Provider | null }) => {
    if (!ALL_AI_FEATURES.includes(input.feature)) {
      throw new Error(`Unknown feature: ${input.feature}`);
    }
    if (input.feature === "image") {
      throw new Error("Image generation is hard-pinned to Lovable AI and cannot be changed.");
    }
    if (input.provider !== null && input.provider !== "lovable" && input.provider !== "openrouter") {
      throw new Error("provider must be 'lovable', 'openrouter', or null");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.supabase, context.userId);

    if (data.provider === null) {
      const { error } = await supabaseAdmin
        .from("ai_provider_settings")
        .delete()
        .eq("feature", data.feature);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("ai_provider_settings")
        .upsert(
          {
            feature: data.feature,
            provider: data.provider,
            updated_at: new Date().toISOString(),
            updated_by: context.userId,
          },
          { onConflict: "feature" },
        );
      if (error) throw new Error(error.message);
    }

    invalidateProviderCache();
    return { ok: true };
  });
