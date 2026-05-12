/**
 * Mobile hamburger sheet — replicates the avatar dropdown + marketing nav so
 * mobile users have a single discoverable entry point to every product
 * surface. Reuses BillingSheet / CloudBalanceSheet via callback props (does
 * not mount its own copies — the parent SiteHeader owns those instances).
 */
import { Link, useNavigate } from "@tanstack/react-router";
import {
  FolderOpen,
  Sparkles,
  Wallet,
  User as UserIcon,
  Settings,
  LogOut,
  Image as ImageIcon,
  Plus,
  BookOpen,
  LogIn,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { CreditBadge } from "@/components/CreditBadge";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenBilling: () => void;
  onOpenCloudBalance: () => void;
};

export function MobileNavSheet({ open, onOpenChange, onOpenBilling, onOpenCloudBalance }: Props) {
  const { user, isReady, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();

  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-[88vw] max-w-sm flex-col p-0">
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-left text-base">Menu</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[max(2rem,env(safe-area-inset-bottom))]">
          {isReady && user && (
            <div className="border-b border-border/60 px-5 py-4">
              <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
                Signed in as
              </p>
              <p className="mt-0.5 truncate text-sm font-medium">{user.email}</p>
              <div className="mt-3">
                <CreditBadge />
              </div>
            </div>
          )}

          <Section title="Product">
            <RowLink to="/" onClick={close} icon={<Sparkles className="h-4 w-4" />} label="Home" />
            {user && (
              <RowLink
                to="/projects"
                onClick={close}
                icon={<FolderOpen className="h-4 w-4" />}
                label="My projects"
              />
            )}
            <RowLink
              to="/templates"
              onClick={close}
              icon={<Sparkles className="h-4 w-4" />}
              label="Templates"
            />
            <RowLink
              to="/packs"
              onClick={close}
              icon={<Sparkles className="h-4 w-4" />}
              label="Industry packs"
            />
            <RowLink
              to="/themes"
              onClick={close}
              icon={<Sparkles className="h-4 w-4" />}
              label="Themes & snippets"
            />
            <RowLink
              to="/gallery"
              onClick={close}
              icon={<ImageIcon className="h-4 w-4" />}
              label="Gallery"
            />
            {user && (
              <RowButton
                onClick={() => {
                  close();
                  navigate({ to: "/", search: { focus: "composer" } });
                }}
                icon={<Plus className="h-4 w-4" />}
                label="New project"
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
                icon={<Sparkles className="h-4 w-4" />}
                label="Plans & credits"
              />
              <RowButton
                onClick={() => {
                  close();
                  onOpenCloudBalance();
                }}
                icon={<Wallet className="h-4 w-4" />}
                label="Cloud & AI balance"
              />
              <RowLink
                to="/profile"
                onClick={close}
                icon={<UserIcon className="h-4 w-4" />}
                label="Profile"
              />
              {isAdmin && (
                <RowLink
                  to="/admin"
                  onClick={close}
                  icon={<Settings className="h-4 w-4" />}
                  label="Admin"
                />
              )}
            </Section>
          )}

          <Section title="Help">
            <RowLink
              to="/docs"
              onClick={close}
              icon={<BookOpen className="h-4 w-4" />}
              label="Documentation"
            />
            <RowLink
              to="/gallery"
              onClick={close}
              icon={<ImageIcon className="h-4 w-4" />}
              label="What's new"
            />
          </Section>

          {isReady && !user && (
            <div className="mt-auto border-t border-border/60 px-5 pt-4">
              <Link
                to="/auth"
                search={{ mode: "signin", redirect: undefined }}
                onClick={close}
                className="flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium hover:bg-muted/50"
              >
                <LogIn className="h-4 w-4" /> Sign in
              </Link>
              <Link
                to="/auth"
                search={{ mode: "signup", redirect: undefined }}
                onClick={close}
                className="mt-2 flex h-11 items-center justify-center gap-2 rounded-full bg-foreground text-sm font-medium text-background"
              >
                Get started
              </Link>
            </div>
          )}

          {isReady && user && (
            <div className="mt-auto border-t border-border/60 px-5 pt-4">
              <button
                type="button"
                onClick={async () => {
                  close();
                  await signOut();
                  navigate({ to: "/" });
                }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium text-muted-foreground hover:text-foreground"
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
    <div className="px-2 py-3">
      <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
  to: "/" | "/projects" | "/gallery" | "/profile" | "/admin" | "/docs" | "/templates" | "/packs" | "/themes";
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
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
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function RowExternal({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </a>
  );
}

// Re-export X for any consumer that wants the close icon (kept for symmetry).
export { X };
