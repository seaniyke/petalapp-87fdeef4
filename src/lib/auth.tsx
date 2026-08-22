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
  /**
   * Optimistic answer to "is this person signed in?" available on the first
   * client frame, before `getSession()` resolves. Derived from the presence of
   * a Supabase token in storage. Use it for LAYOUT decisions only (which hero
   * to render) — never for anything that must be trusted.
   */
  likelyAuthed: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** True when a Supabase auth token is sitting in localStorage for this project. */
function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = window.localStorage.getItem(key);
        if (raw && raw.length > 2) return true;
      }
    }
  } catch {
    /* storage blocked (private mode, embedded iframe) — assume signed out */
  }
  return false;
}

/**
 * Hard ceiling on how long the UI is allowed to sit in an unknown auth state.
 * `getSession()` talks to the network when it needs to refresh a token, and on
 * a flaky connection that promise can hang indefinitely — which used to leave
 * the landing page showing nothing but a skeleton.
 */
const AUTH_READY_TIMEOUT_MS = 1500;


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
