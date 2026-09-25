import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function isMarketplaceEnabled(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "features.marketplace")
    .maybeSingle();

  if (error) return false;
  return data?.value === true;
}