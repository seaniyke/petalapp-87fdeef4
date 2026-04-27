import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";

/**
 * Shared admin route guard. Redirects to /auth when signed-out and to /
 * (with a toast) when signed-in but not an admin.
 *
 * Returns `{ ready }` — true once the auth + role check has settled and the
 * caller can safely render admin content. While `ready` is false, callers
 * should render a loading state.
 */
export function useAdminGuard(redirectTo: string): { ready: boolean; isAdmin: boolean } {
  const { user, isReady } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      navigate({ to: "/auth", search: { mode: "signin", redirect: redirectTo } });
      return;
    }
    if (!adminLoading && !isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [isReady, user, adminLoading, isAdmin, navigate, redirectTo]);

  const ready = isReady && !adminLoading && Boolean(user) && isAdmin;
  return { ready, isAdmin };
}
