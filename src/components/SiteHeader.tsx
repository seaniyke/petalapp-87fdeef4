import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, FolderOpen, User as UserIcon, Settings, Wallet } from "lucide-react";
import petalLogo from "@/assets/petal-logo.png";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { CreditBadge } from "@/components/CreditBadge";
import { CloudBalanceSheet } from "@/components/CloudBalanceSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const { user, isReady, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [cloudBalanceOpen, setCloudBalanceOpen] = useState(false);

  // Lift the header (heavier blur + hairline) once the user has scrolled.
  // This mirrors Lovable's quiet, premium header behaviour.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const initial = (user?.email ?? "?")[0]?.toUpperCase() ?? "?";

  return (
    <>
    <header
      className={`sticky top-0 z-50 w-full transition-[background-color,border-color,box-shadow] duration-200 ${
        scrolled
          ? "border-b border-border/60 bg-background/80 shadow-[0_1px_0_0_hsl(var(--border)/0.4)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/65"
          : "border-b border-transparent bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/45"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6 lg:px-8">
        <Link to="/" className="group flex items-center gap-2.5">
          <img
            src={petalLogo}
            alt="Petal"
            className="h-7 w-7 object-contain transition-transform duration-300 group-hover:rotate-[8deg] sm:h-8 sm:w-8"
          />
          <span className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            Petal
          </span>
        </Link>

        <nav className="hidden items-center gap-1 text-sm md:flex">
          <a
            href="/#features"
            className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            Features
          </a>
          <a
            href="/#how"
            className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            How it works
          </a>
          <Link
            to="/gallery"
            className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            Gallery
          </Link>
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {!isReady ? (
            // Neutral placeholder while the session restores from storage.
            // Prevents a flash of the signed-out CTAs on refresh.
            <div
              aria-hidden="true"
              className="h-9 w-24 rounded-full bg-muted/40 animate-pulse"
            />
          ) : user ? (
            <>
              <Link
                to="/projects"
                className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:inline-flex"
              >
                <FolderOpen className="h-4 w-4" />
                Projects
              </Link>
              <CreditBadge />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Account menu"
                    className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-sm font-medium text-background ring-1 ring-foreground/10 transition hover:brightness-110 hover:ring-foreground/20"
                  >
                    {initial}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate({ to: "/projects" })}>
                    <FolderOpen className="mr-2 h-4 w-4" /> My projects
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCloudBalanceOpen(true)}>
                    <Wallet className="mr-2 h-4 w-4" /> Cloud &amp; AI balance
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
                    <UserIcon className="mr-2 h-4 w-4" /> Profile
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}>
                      <Settings className="mr-2 h-4 w-4" /> Admin
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
                className="hidden h-9 items-center rounded-full px-4 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                to="/auth"
                search={{ mode: "signup", redirect: undefined }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background shadow-sm ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:ring-foreground/20"
              >
                <UserIcon className="h-3.5 w-3.5" />
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
    <CloudBalanceSheet open={cloudBalanceOpen} onOpenChange={setCloudBalanceOpen} />
    </>
  );
}
