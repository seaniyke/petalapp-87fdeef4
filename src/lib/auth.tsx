import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { claimWaitlistReferral } from "@/lib/waitlist-referral.functions";
import { clearReferral, readReferral } from "@/lib/referral";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isReady: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);
  const claimedFor = useRef<string | null>(null);

  /** One-shot referral payout per signed-in user — safe to call repeatedly. */
  function claimReferral(next: Session | null) {
    const uid = next?.user?.id;
    if (!uid || claimedFor.current === uid) return;
    claimedFor.current = uid;
    const ref = readReferral() ?? undefined;
    void claimWaitlistReferral({ data: { ref } })
      .then(() => clearReferral())
      .catch(() => {
        /* never block sign-in on rewards */
      });
  }

  // Supabase fires an auth event every time the tab regains focus (it
  // revalidates / refreshes the token on visibility change). Each event hands
  // us a NEW session object even when nothing actually changed. Storing it
  // blindly changes the context identity, re-renders every consumer and
  // re-runs their effects — which is exactly the "the whole app reloads when I
  // come back to the tab" symptom. Only commit a session that is genuinely
  // different.
  function sameSession(a: Session | null, b: Session | null) {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.user?.id === b.user?.id &&
      a.access_token === b.access_token &&
      a.expires_at === b.expires_at
    );
  }

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | undefined;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setIsReady(true);
        claimReferral(data.session);

        const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setSession((prev) => (sameSession(prev, nextSession) ? prev : nextSession));
          setIsReady(true);
          claimReferral(nextSession);
        });
        subscription = sub.subscription;
      })
      .catch(() => {
        if (mounted) setIsReady(true);
      });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);


  // Stable context identity: a token refresh that yields an equivalent session
  // must not cascade re-renders through every consumer.
  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading: !isReady,
      isReady,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, isReady],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// A missing provider must never be able to crash a render. Before, this threw,
// so a single consumer rendered outside the tree (an error component, a portal
// during SSR) took the whole server render down instead of degrading to a
// signed-out shell. Fall back to a stable, never-ready, signed-out context.
const FALLBACK_AUTH: AuthContextValue = {
  user: null,
  session: null,
  loading: true,
  isReady: false,
  signOut: async () => {
    await supabase.auth.signOut();
  },
};

export function useAuthReady() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    if (typeof window !== "undefined") {
      console.warn("useAuthReady used outside <AuthProvider> — falling back to signed-out state");
    }
    return FALLBACK_AUTH;
  }
  return ctx;
}

export function useAuth() {
  return useAuthReady();
}
