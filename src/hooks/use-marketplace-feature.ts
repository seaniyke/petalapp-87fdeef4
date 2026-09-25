import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type MarketplaceRpcClient = {
  rpc: (name: "marketplace_is_enabled") => Promise<{
    data: boolean | null;
    error: { message: string } | null;
  }>;
};

export function useMarketplaceFeature(): { enabled: boolean; loading: boolean } {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (supabase as unknown as MarketplaceRpcClient)
      .rpc("marketplace_is_enabled")
      .then(({ data, error }) => {
        if (!cancelled) setEnabled(!error && data === true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, loading };
}