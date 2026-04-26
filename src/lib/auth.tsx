import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
  const restoredSession = useRef(false);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (restoredSession.current) setIsReady(true);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      restoredSession.current = true;
      setSession(data.session);
      setIsReady(true);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
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
