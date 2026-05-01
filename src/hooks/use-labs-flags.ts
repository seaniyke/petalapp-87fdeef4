/**
 * Client-side helpers for the Labs feature toggles.
 *
 * Flags are stored per-user in the `labs_flags` table. Admins see all flags
 * forced on regardless of their own row. The list of valid flag names is
 * intentionally narrow — any unknown flag is treated as off.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";

export const LABS_FLAGS = {
  integrations_marketplace: {
    title: "Integrations marketplace",
    description:
      "Adds a per-project marketplace where you can install Resend, Plausible, and more with one click.",
  },
  pwa_template: {
    title: "PWA template (prompt-triggered)",
    description:
      "Lets the chat assistant scaffold a Progressive Web App with manifest, offline cache, and push notifications when you ask for it.",
  },
  staged_pipeline: {
    title: "Staged build pipeline (experimental)",
    description:
      "New 3-stage build pipeline (plan → parallel scaffold → wire-up) that breaks each app into smaller, isolated AI calls. Reduces truncation and prose-only failures. Off by default while we measure it.",
  },
} as const;

export type LabsFlagName = keyof typeof LABS_FLAGS;
export type LabsFlags = Partial<Record<LabsFlagName, boolean>>;

async function fetchFlags(): Promise<LabsFlags> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return {};
  const res = await fetch("/api/labs", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const json = (await res.json()) as { flags?: LabsFlags };
  return json.flags ?? {};
}

async function persistFlags(flags: LabsFlags): Promise<LabsFlags> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return flags;
  const res = await fetch("/api/labs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ flags }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { flags: LabsFlags };
  return json.flags;
}

/** Read all labs flags for the current user. Admins see every flag forced on. */
export function useLabsFlags(): {
  flags: LabsFlags;
  loading: boolean;
  setFlag: (name: LabsFlagName, value: boolean) => Promise<void>;
} {
  const { user, isReady } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [flags, setFlags] = useState<LabsFlags>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!isReady) return;
    if (!user) {
      setFlags({});
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchFlags().then((f) => {
      if (cancelled) return;
      setFlags(f);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isReady, user]);

  const setFlag = useCallback(
    async (name: LabsFlagName, value: boolean) => {
      const next = { ...flags, [name]: value };
      setFlags(next);
      try {
        const saved = await persistFlags(next);
        setFlags(saved);
      } catch (e) {
        // Roll back on failure.
        setFlags(flags);
        throw e;
      }
    },
    [flags],
  );

  // Admins see every flag forced on so we can dogfood without flipping per-user toggles.
  const effective: LabsFlags = isAdmin
    ? Object.fromEntries(
        (Object.keys(LABS_FLAGS) as LabsFlagName[]).map((k) => [k, true]),
      )
    : flags;

  return { flags: effective, loading, setFlag };
}

/** Quick check for a single flag. */
export function useLabsFlag(name: LabsFlagName): boolean {
  const { flags } = useLabsFlags();
  return Boolean(flags[name]);
}
