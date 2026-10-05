/**
 * Mobile hamburger sheet — replicates the avatar dropdown + marketing nav so
 * mobile users have a single discoverable entry point to every product
 * surface. Styled after the iOS reference: a calm full-height panel with a
 * large "Menu" title, round close button, hairline-separated uppercase
 * groups, roomy icon rows, a segmented theme control, and paired bottom
 * actions. Reuses BillingSheet via a callback prop (the parent SiteHeader
 * owns those instances).
 */
import { Link, useNavigate } from "@tanstack/react-router";
import {
  FolderOpen,
  House,
  CreditCard,
  Megaphone,
  User as UserIcon,
  Settings,
  LogOut,
  Image as ImageIcon,
  BookOpen,
  LogIn,
  X,
  Store,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { ThemeToggle } from "@/components/ThemeToggle";


type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenBilling: () => void;
  marketplaceEnabled: boolean;
};

export function MobileNavSheet({ open, onOpenChange, onOpenBilling, marketplaceEnabled }: Props) {
  const { user, isReady, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();

  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[88vw] max-w-sm flex-col p-0 [&>button]:hidden"
      >
        {/* Title row — large "Menu" + round close, like the iOS reference */}
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
          <SheetTitle className="text-xl font-semibold tracking-tight">Menu</SheetTitle>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {isReady && user && (
            <div className="border-b border-border/50 px-5 py-3.5">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Signed in as
              </p>
              <p className="mt-0.5 truncate text-sm font-medium">{user.email}</p>
            </div>
          )}

          <Section title="Product">
            <RowLink to="/" onClick={close} icon={<House className="h-[18px] w-[18px]" />} label="Home" />
            {user && (
              <RowLink
                to="/projects"
                onClick={close}
                icon={<FolderOpen className="h-[18px] w-[18px]" />}
                label="My projects"
              />
            )}
            {/* Templates / Industry packs / Themes & snippets intentionally hidden — */}
            {/* Kimble selects from them automatically based on the user's brief. */}
            <RowLink
              to="/gallery"
              onClick={close}
              icon={<ImageIcon className="h-[18px] w-[18px]" />}
              label="Gallery"
            />
            {marketplaceEnabled && (
              <RowLink
                to="/marketplace"
                onClick={close}
                icon={<Store className="h-[18px] w-[18px]" />}
                label="Marketplace"
              />
            )}
          </Section>

          {isReady && user && (
            <Section title="Account">
              <RowButton
                onClick={() => {
                  close();
                  onOpenBilling();
                }}
                icon={<CreditCard className="h-[18px] w-[18px]" />}
                label="Credits"
              />
              <RowLink
                to="/profile"
                onClick={close}
                icon={<UserIcon className="h-[18px] w-[18px]" />}
                label="Profile"
              />
              {isAdmin && (
                <RowLink
                  to="/admin"
                  onClick={close}
                  icon={<Settings className="h-[18px] w-[18px]" />}
                  label="Admin"
                />
              )}
            </Section>
          )}

          <Section title="Help">
            <RowLink
              to="/docs"
              onClick={close}
              icon={<BookOpen className="h-[18px] w-[18px]" />}
              label="Documentation"
            />
            <RowLink
              to="/changelog"
              onClick={close}
              icon={<Megaphone className="h-[18px] w-[18px]" />}
              label="What's new"
            />
          </Section>

          <Section title="Appearance">
            <div className="flex items-center justify-between px-1 py-1">
              <span className="text-[15px]">Theme</span>
              <ThemeToggle />
            </div>
          </Section>

          {isReady && !user && (
            <div className="mt-auto flex gap-2.5 border-t border-border/50 px-5 pt-4">
              <Link
                to="/auth"
                search={{ mode: "signin", redirect: undefined }}
                onClick={close}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border/70 bg-background text-sm font-medium hover:bg-muted/50"
              >
                <LogIn className="h-4 w-4" /> Log in
              </Link>
              <Link
                to="/auth"
                search={{ mode: "signup", redirect: undefined }}
                onClick={close}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background"
              >
                Get started
              </Link>
            </div>
          )}

          {isReady && user && (
            <div className="mt-auto border-t border-border/50 px-5 pt-4">
              <button
                type="button"
                onClick={async () => {
                  close();
                  await signOut();
                  navigate({ to: "/" });
                }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/50 px-4 py-3.5 last:border-b-0">
      <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function RowLink({
  to,
  onClick,
  icon,
  label,
}: {
  to: "/" | "/projects" | "/gallery" | "/marketplace" | "/sell" | "/profile" | "/admin" | "/docs" | "/templates" | "/packs" | "/themes" | "/changelog" | "/privacy" | "/terms";
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-lg px-1 py-2.5 text-[15px] transition-colors hover:bg-muted/50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function RowButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-lg px-1 py-2.5 text-left text-[15px] transition-colors hover:bg-muted/50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
