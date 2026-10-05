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
  CreditCard,
  Store,
  ChevronsUpDown,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useMarketplaceFeature } from "@/hooks/use-marketplace-feature";

import { PetalBrand } from "@/components/PetalBrand";
import { ThemeToggle } from "@/components/ThemeToggle";



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
  const { user, isReady, likelyAuthed, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { enabled: marketplaceEnabled } = useMarketplaceFeature();
  const navigate = useNavigate();
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
        className={`sticky top-0 z-50 w-full transition-[background-color,border-color] duration-200 ${
          scrolled ? "border-b border-border/50 bg-background/75 backdrop-blur-xl" : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-2 px-3.5 sm:h-14 sm:gap-4 sm:px-6 lg:px-8">
          {user ? (
            <Link
              to="/projects"
              className="inline-flex h-8 max-w-[60vw] items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 py-1 pl-1 pr-2 backdrop-blur-xl"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                {initial}
              </span>
              <span className="truncate text-xs font-semibold">
                {(user.email ?? "My").split("@")[0]}'s Kimble
              </span>
              <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
            </Link>
          ) : (
            <Link to="/" className="flex items-center">
              <PetalBrand size="xs" />
            </Link>
          )}


          {/* Desktop nav: marketing links when signed-out, product cluster when signed-in */}
          <nav className="hidden flex-1 items-center justify-center gap-1 text-[13px] md:flex">
            {!user ? (
              <>
                <a
                  href="/#features"
                  className="rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  Features
                </a>
                <a
                  href="/#how"
                  className="rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  How it works
                </a>
                {/* Templates / Packs / Themes intentionally hidden — Kimble picks them automatically. */}
                <Link
                  to="/gallery"
                  className="rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  Gallery
                </Link>
                {marketplaceEnabled && (
                  <Link
                    to="/marketplace"
                    className="rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    Marketplace
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link
                  to="/projects"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  activeProps={{ className: "bg-muted/60 text-foreground" }}
                >
                  <FolderOpen className="h-4 w-4" /> Projects
                </Link>
                {/* Templates / Packs / Themes intentionally hidden — Kimble picks them automatically. */}
                <Link
                  to="/gallery"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  activeProps={{ className: "bg-muted/60 text-foreground" }}
                >
                  <ImageIcon className="h-4 w-4" /> Gallery
                </Link>
                {marketplaceEnabled && (
                  <Link
                    to="/marketplace"
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    activeProps={{ className: "bg-muted/60 text-foreground" }}
                  >
                    <Store className="h-4 w-4" /> Marketplace
                  </Link>
                )}

              </>
            )}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="hidden sm:inline-flex">
              <ThemeToggle variant="icon" />
            </span>




            {/* Only a RETURNING visitor (token in storage) waits behind a
                placeholder. A first-time visitor has nothing to resolve, so
                showing them a pulsing grey pill for a second is pure noise —
                they get the real signed-out call to action immediately. */}
            {!isReady && likelyAuthed ? (
              <div
                aria-hidden="true"
                className="h-7 w-16 rounded-md bg-muted/40 animate-pulse"
              />
            ) : user ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Account menu"
                      className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg bg-accent text-xs font-medium text-accent-foreground ring-1 ring-border transition hover:brightness-105"
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
                    <DropdownMenuItem onSelect={() => setBillingOpen(true)}>
                      <CreditCard className="mr-2 h-4 w-4" /> Credits
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
                  className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border border-border bg-card/60 px-2.5 text-xs font-medium transition-colors hover:bg-card"
                >
                  Log in
                </Link>
                <Link
                  to="/auth"
                  search={{ mode: "signup", redirect: undefined }}
                  className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md bg-foreground px-2.5 text-xs font-semibold text-background shadow-[var(--shadow-soft)] transition hover:opacity-90"
                >
                  Get started
                </Link>
              </>

            )}

            {/* Mobile hamburger — sits at the far right on small screens */}
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileNavOpen(true)}
              className={`grid h-7 w-7 place-items-center rounded-md text-foreground transition hover:bg-muted/60 hover:text-foreground md:hidden ${user ? "hidden" : ""}`}
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        onOpenBilling={() => setBillingOpen(true)}
        marketplaceEnabled={marketplaceEnabled}
      />
      <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
    </>
  );
}
