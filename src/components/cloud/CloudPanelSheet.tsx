/**
 * CloudPanelSheet — Cloud hub mirroring the Lovable mobile screens.
 * A right-side Sheet hosts a home list and pushes to sub-views in place
 * (iOS-style), with a back chevron in the header.
 *
 * Two modes:
 *  - Workspace mode (no projectId): shows AI usage across the workspace
 *    + a link to the Cloud & AI balance sheet. Per-project views render
 *    a "pick a project" prompt.
 *  - Project mode (projectId set): all sub-views are scoped to that
 *    project (database, users, storage, secrets, advanced, etc.).
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
import { CloudAiUsageView } from "@/components/cloud/CloudAiUsageView";
import { CloudDatabaseView } from "@/components/cloud/CloudDatabaseView";
import { CloudUsersView } from "@/components/cloud/CloudUsersView";
import { CloudStorageView } from "@/components/cloud/CloudStorageView";
import { CloudSecretsView } from "@/components/cloud/CloudSecretsView";
import { CloudLogsView } from "@/components/cloud/CloudLogsView";
import { CloudAdvancedView } from "@/components/cloud/CloudAdvancedView";
import { CloudEmptyState } from "@/components/cloud/CloudEmptyState";
import { EmailSection } from "@/components/EmailSection";

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
  /** When set, sub-views are scoped to this project's managed backend. */
  projectId?: string;
};

export function CloudPanelSheet({
  open,
  onOpenChange,
  onOpenBalance,
  projectId,
}: Props) {
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
            <button
              type="button"
              onClick={() => {
                if (view === "home") handleOpenChange(false);
                else setView("home");
              }}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
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

        {view === "emails" &&
          (projectId ? (
            <div className="p-4">
              <EmailSection projectId={projectId} />
            </div>
          ) : (
            <NeedsProject view="emails" />
          ))}

        {view === "database" &&
          (projectId ? (
            <CloudDatabaseView projectId={projectId} />
          ) : (
            <NeedsProject view="database" />
          ))}

        {view === "users" &&
          (projectId ? (
            <CloudUsersView projectId={projectId} />
          ) : (
            <NeedsProject view="users" />
          ))}

        {view === "storage" &&
          (projectId ? (
            <CloudStorageView projectId={projectId} />
          ) : (
            <NeedsProject view="storage" />
          ))}

        {view === "secrets" &&
          (projectId ? (
            <CloudSecretsView projectId={projectId} />
          ) : (
            <NeedsProject view="secrets" />
          ))}

        {view === "logs" &&
          (projectId ? (
            <CloudLogsView projectId={projectId} />
          ) : (
            <NeedsProject view="logs" />
          ))}

        {view === "advanced" &&
          (projectId ? (
            <CloudAdvancedView projectId={projectId} />
          ) : (
            <NeedsProject view="advanced" />
          ))}
      </SheetContent>
    </Sheet>
  );
}

function NeedsProject({ view }: { view: string }) {
  return (
    <div className="p-4">
      <CloudEmptyState
        title="Open from a project"
        description={`The ${view} view is per-project. Open Cloud from inside a project to manage its ${view}.`}
      />
    </div>
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
