import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LogOut,
  FolderOpen,
  User as UserIcon,
  Settings,
  Wallet,
  Menu,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";

import { CloudBalanceSheet } from "@/components/CloudBalanceSheet";
import { BillingSheet } from "@/components/BillingSheet";
import { MobileNavSheet } from "@/components/MobileNavSheet";
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
  const [billingOpen, setBillingOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
  // Pull a profile picture from Google OAuth (or any provider that sets it).
  // Supabase exposes provider metadata under user_metadata; check both common
  // keys. Falls back to the initial letter chip when no avatar is present.
  const meta = (user as unknown as { user_metadata?: Record<string, unknown> } | null | undefined)
    ?.user_metadata;
  const avatarUrl =
    (typeof meta?.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta?.picture === "string" && (meta.picture as string)) ||
    "";

  return (
    <>
      <header
        className={`sticky top-0 z-50 w-full transition-[background-color,border-color,box-shadow] duration-200 ${
          scrolled
            ? "border-b border-border/60 bg-background/80 shadow-[0_1px_0_0_hsl(var(--border)/0.4)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/65"
            : "border-b border-transparent bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/45"
        }`}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6 lg:px-8">
          <Link to="/" className="group flex items-center">
            <span className="font-display text-xl font-black tracking-[-0.03em] text-foreground transition-opacity group-hover:opacity-80 sm:text-2xl">
              Petal
            </span>
          </Link>

          {/* Desktop nav: marketing links when signed-out, product cluster when signed-in */}
          <nav className="hidden flex-1 items-center justify-center gap-1 text-sm md:flex">
            {!user ? (
              <>
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
                {/* Templates / Packs / Themes intentionally hidden — Petal picks them automatically. */}
                <Link
                  to="/gallery"
                  className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  Gallery
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/projects"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  activeProps={{ className: "bg-muted/60 text-foreground" }}
                >
                  <FolderOpen className="h-4 w-4" /> Projects
                </Link>
                {/* Templates / Packs / Themes intentionally hidden — Petal picks them automatically. */}
                <Link
                  to="/gallery"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  activeProps={{ className: "bg-muted/60 text-foreground" }}
                >
                  <ImageIcon className="h-4 w-4" /> Gallery
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {!isReady ? (
              <div
                aria-hidden="true"
                className="h-9 w-24 rounded-full bg-muted/40 animate-pulse"
              />
            ) : user ? (
              <>
                {/* Desktop-only Cloud quick action mirrors the Credits pill */}
                <button
                  type="button"
                  onClick={() => setCloudBalanceOpen(true)}
                  aria-label="Open Cloud and AI balance"
                  className="hidden h-9 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 md:inline-flex"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span className="hidden text-xs text-muted-foreground lg:inline">Cloud</span>
                </button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Account menu"
                      className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-foreground text-sm font-medium text-background ring-1 ring-foreground/10 transition hover:brightness-110 hover:ring-foreground/20"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={user.email ?? "Account"}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        initial
                      )}
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
                    <DropdownMenuItem onSelect={() => setBillingOpen(true)}>
                      <Settings className="mr-2 h-4 w-4" /> Plans &amp; credits
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
                      <UserIcon className="mr-2 h-4 w-4" /> Profile
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}>
                        <Settings className="mr-2 h-4 w-4" /> Admin
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
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

      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        onOpenBilling={() => setBillingOpen(true)}
        onOpenCloudBalance={() => setCloudBalanceOpen(true)}
      />
      <CloudBalanceSheet
        open={cloudBalanceOpen}
        onOpenChange={setCloudBalanceOpen}
        onOpenBilling={() => {
          setCloudBalanceOpen(false);
          setBillingOpen(true);
        }}
      />
      <BillingSheet
        open={billingOpen}
        onOpenChange={setBillingOpen}
        onOpenCloudBalance={() => {
          setBillingOpen(false);
          setCloudBalanceOpen(true);
        }}
      />
    </>
  );
}
