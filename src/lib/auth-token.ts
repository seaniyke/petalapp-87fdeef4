import { supabase } from "@/integrations/supabase/client";

let inFlightTokenRead: Promise<string | null> | null = null;

function isAuthLockRace(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /lock:sb-.*auth-token|request stole it|lock.*released/i.test(message);
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  if (!inFlightTokenRead) {
    inFlightTokenRead = supabase.auth
      .getSession()
      .then(({ data }) => data.session?.access_token ?? null)
      .catch(async (error) => {
        if (!isAuthLockRace(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 80));
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      })
      .finally(() => {
        inFlightTokenRead = null;
      });
  }
  return inFlightTokenRead;
}