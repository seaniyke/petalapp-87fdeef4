import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/** Operator console header. Kimble has no public website any more. */
export function SiteHeader() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/admin" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <img src="/kimble-logo.png" alt="" className="h-5 w-5 dark:invert" />
          Kimble Engine
        </Link>
        {user && (
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth", replace: true });
            }}
            className="h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
