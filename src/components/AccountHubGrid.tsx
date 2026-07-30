/**
 * Account hub — 2x2 grid of section cards rendered on /profile so the form
 * page also acts as a settings hub. Reuses BillingSheet and CloudBalanceSheet
 * (mounted by the parent route) via callback props.
 */
import { Link } from "@tanstack/react-router";
import {
  Cloud,
  Sparkles,
  Wallet,
  FolderOpen,
  Settings,
  ArrowRight,
  Receipt,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/use-is-admin";

type Props = {
  onOpenBilling: () => void;
  onOpenCloudBalance: () => void;
  onOpenCloud: () => void;
};

export function AccountHubGrid({ onOpenBilling, onOpenCloudBalance, onOpenCloud }: Props) {
  const { isAdmin } = useIsAdmin();

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Account &amp; usage
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardButton
          onClick={onOpenCloud}
          icon={<Cloud className="h-5 w-5" />}
          title="Cloud"
          description="AI usage, database, users, storage, secrets and logs."
        />
        <CardButton
          onClick={onOpenBilling}
          icon={<Sparkles className="h-5 w-5" />}
          title="Plans & credits"
          description="Upgrade plan, view AI message credits and top up."
        />
        <CardButton
          onClick={onOpenCloudBalance}
          icon={<Wallet className="h-5 w-5" />}
          title="Cloud & AI balance"
          description="Runtime balance, project caps and Cloud/AI usage."
        />
        <CardLink
          to="/billing"
          icon={<Receipt className="h-5 w-5" />}
          title="Billing & receipts"
          description="Plan, renewal date, payment history and PDF receipts."
        />
        <CardLink
          to="/projects"
          icon={<FolderOpen className="h-5 w-5" />}
          title="My projects"
          description="Open, rename or delete the projects you've built."
        />
        {isAdmin && (
          <CardLink
            to="/admin"
            icon={<Settings className="h-5 w-5" />}
            title="Admin"
            description="Operations dashboard, ledgers, users, pipeline."
          />
        )}
      </div>
    </section>
  );
}

function CardShell({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="group flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-5 text-left transition hover:border-primary/40 hover:bg-card">
      <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <h3 className="font-medium tracking-tight">{title}</h3>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}

function CardButton({
  onClick,
  icon,
  title,
  description,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <CardShell icon={icon} title={title} description={description} />
    </button>
  );
}

function CardLink({
  to,
  icon,
  title,
  description,
}: {
  to: "/projects" | "/admin" | "/billing";
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link to={to}>
      <CardShell icon={icon} title={title} description={description} />
    </Link>
  );
}
