import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { claimWaitlistReferral } from "@/lib/waitlist-referral.functions";

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
    void claimWaitlistReferral().catch(() => {
      /* never block sign-in on rewards */
    });
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
          setSession(nextSession);
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


  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    loading: !isReady,
    isReady,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthReady() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthReady must be used inside <AuthProvider>");
  return ctx;
}

export function useAuth() {
  return useAuthReady();
}
