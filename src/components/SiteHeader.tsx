import { Link, useNavigate } from "@tanstack/react-router";
import { Sparkles, LogOut, FolderOpen, User as UserIcon, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { CreditBadge } from "@/components/CreditBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();

  const initial = (user?.email ?? "?")[0]?.toUpperCase() ?? "?";

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Petal</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="/#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="/#how" className="hover:text-foreground transition-colors">How it works</a>
          <Link to="/gallery" className="hover:text-foreground transition-colors">Gallery</Link>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                to="/projects"
                className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
              >
                <FolderOpen className="h-4 w-4" />
                Projects
              </Link>
              <CreditBadge />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-sm font-medium text-background transition hover:brightness-110">
                    {initial}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate({ to: "/projects" })}>
                    <FolderOpen className="mr-2 h-4 w-4" /> My projects
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onSelect={() => navigate({ to: "/admin/billing" })}>
                      <Settings className="mr-2 h-4 w-4" /> Billing settings
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={async () => {
                      await signOut();
                      navigate({ to: "/" });
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                search={{ mode: "signin", redirect: undefined }}
                className="hidden h-9 items-center rounded-full px-4 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                to="/auth"
                search={{ mode: "signup", redirect: undefined }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
              >
                <UserIcon className="h-3.5 w-3.5" />
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
