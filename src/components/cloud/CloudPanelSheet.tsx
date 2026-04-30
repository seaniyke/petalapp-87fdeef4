/**
 * CloudPanelSheet — workspace-level "Cloud" hub that mirrors the Lovable
 * mobile screens. A single right-side Sheet hosts a home list and pushes
 * to sub-views in place (iOS-style), with a back chevron in the header.
 *
 * Sub-views:
 *  - ai          — full-fidelity AI usage analytics (CloudAiUsageView)
 *  - emails      — Petal Email management (placeholder pointing to settings)
 *  - database    — tables & rows in the project's managed backend (soon)
 *  - users       — auth users in the managed backend (soon)
 *  - storage     — buckets in the managed backend (soon)
 *  - secrets     — encrypted env vars (soon)
 *  - logs        — edge / db logs (soon)
 *  - advanced    — instance size + danger zone (soon)
 *  - balance     — opens the existing CloudBalanceSheet
 */
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Mail,
  Database,
  Users,
  HardDrive,
  KeyRound,
  ScrollText,
  Settings2,
  Wallet,
  ArrowUpRight,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CloudAiUsageView } from "@/components/cloud/CloudAiUsageView";

type View =
  | "home"
  | "ai"
  | "emails"
  | "database"
  | "users"
  | "storage"
  | "secrets"
  | "logs"
  | "advanced";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Open the existing Cloud & AI balance sheet */
  onOpenBalance: () => void;
};

export function CloudPanelSheet({ open, onOpenChange, onOpenBalance }: Props) {
  const [view, setView] = useState<View>("home");

  const handleOpenChange = (v: boolean) => {
    if (!v) setView("home"); // reset when closing
    onOpenChange(v);
  };

  const titleForView: Record<View, string> = {
    home: "Cloud",
    ai: "AI",
    emails: "Emails",
    database: "Database",
    users: "Users",
    storage: "Storage",
    secrets: "Secrets",
    logs: "Logs",
    advanced: "Advanced settings",
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background p-0 sm:max-w-md"
      >
        <SheetHeader className="sticky top-0 z-10 border-b border-border/60 bg-background px-3 py-3">
          <div className="flex items-center justify-between">
            {view === "home" ? (
              <span className="w-9" />
            ) : (
              <button
                type="button"
                onClick={() => setView("home")}
                className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <SheetTitle className="text-base font-semibold">
              {titleForView[view]}
            </SheetTitle>
            <span className="w-9" />
          </div>
        </SheetHeader>

        {view === "home" && (
          <CloudHome onNavigate={setView} onOpenBalance={onOpenBalance} />
        )}
        {view === "ai" && <CloudAiUsageView />}
        {view === "emails" && (
          <Placeholder
            title="Emails"
            description="Send branded emails from your domain. Manage Petal Email and your sender domain."
            cta={{
              label: "Open Petal Email settings",
              hint: "Configure Petal Email from the project settings sheet.",
            }}
          />
        )}
        {view === "database" && (
          <Placeholder
            title="Database"
            description="Browse tables and rows from your project's managed backend."
            cta={{
              label: "Coming soon",
              hint: "Per-project table browser is in progress.",
            }}
          />
        )}
        {view === "users" && (
          <Placeholder
            title="Users"
            description="View user data and configure how people sign in to your app."
            cta={{
              label: "Coming soon",
              hint: "Auth users browser will land here next.",
            }}
          />
        )}
        {view === "storage" && (
          <Placeholder
            title="Storage"
            description="View and manage files, images and documents."
            cta={{
              label: "Coming soon",
              hint: "Bucket browser will land here next.",
            }}
          />
        )}
        {view === "secrets" && (
          <Placeholder
            title="Secrets"
            description="Store and manage environment variables securely."
            cta={{
              label: "Coming soon",
              hint: "Secret manager UI will land here next.",
            }}
          />
        )}
        {view === "logs" && (
          <Placeholder
            title="Logs"
            description="Monitor application logs to debug issues."
            cta={{
              label: "Coming soon",
              hint: "Edge function and database logs will land here next.",
            }}
          />
        )}
        {view === "advanced" && (
          <Placeholder
            title="Advanced settings"
            description="Resize your instance or pause your backend."
            cta={{
              label: "Coming soon",
              hint: "Instance sizing and danger-zone actions will land here.",
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CloudHome({
  onNavigate,
  onOpenBalance,
}: {
  onNavigate: (v: View) => void;
  onOpenBalance: () => void;
}) {
  return (
    <div className="space-y-3 p-4">
      <Row
        icon={<Sparkles className="h-4 w-4" />}
        title="AI"
        description="View AI usage and performance"
        onClick={() => onNavigate("ai")}
      />
      <Row
        icon={<Mail className="h-4 w-4" />}
        title="Emails"
        description="Send branded emails from your domain"
        onClick={() => onNavigate("emails")}
      />
      <Row
        icon={<Database className="h-4 w-4" />}
        title="Database"
        description="View tables and edit data"
        onClick={() => onNavigate("database")}
      />
      <Row
        icon={<Users className="h-4 w-4" />}
        title="Users"
        description="View user data and configure how people sign in"
        onClick={() => onNavigate("users")}
      />
      <Row
        icon={<HardDrive className="h-4 w-4" />}
        title="Storage"
        description="View and manage files, images and documents"
        onClick={() => onNavigate("storage")}
      />
      <Row
        icon={<KeyRound className="h-4 w-4" />}
        title="Secrets"
        description="Store and manage environment variables securely"
        onClick={() => onNavigate("secrets")}
      />
      <Row
        icon={<ScrollText className="h-4 w-4" />}
        title="Logs"
        description="Monitor application logs to debug issues"
        onClick={() => onNavigate("logs")}
      />
      <Row
        icon={<Settings2 className="h-4 w-4" />}
        title="Advanced settings"
        description=""
        onClick={() => onNavigate("advanced")}
        compact
      />
      <Row
        icon={<Wallet className="h-4 w-4" />}
        title="Cloud & AI balance"
        description=""
        trailing={<ArrowUpRight className="h-4 w-4 text-muted-foreground" />}
        onClick={onOpenBalance}
        compact
      />
    </div>
  );
}

function Row({
  icon,
  title,
  description,
  onClick,
  trailing,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  trailing?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-2xl bg-muted/40 px-4 py-4 text-left transition hover:bg-muted/60"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-background text-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold">{title}</div>
        {!compact && description && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {trailing ?? (
        <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      )}
    </button>
  );
}

function Placeholder({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: { label: string; hint: string };
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {cta && (
        <div className="rounded-2xl bg-muted/40 p-5">
          <div className="text-sm font-medium">{cta.label}</div>
          <p className="mt-1 text-xs text-muted-foreground">{cta.hint}</p>
          <Button variant="outline" size="sm" disabled className="mt-3">
            {cta.label}
          </Button>
        </div>
      )}
    </div>
  );
}
