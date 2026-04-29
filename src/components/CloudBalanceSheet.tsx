/**
 * CloudBalanceSheet — the user-facing "Cloud + AI balance" panel that mirrors
 * the screenshot from the Lovable mobile UI. Opens from the SiteHeader user
 * dropdown and from the low-balance banner inside /builder.
 *
 * Sections (top → bottom):
 *  1. Hero card: monthly free reset date + Top-up balance + [Top up] button
 *  2. Usage card: Cloud and AI rows showing free-used and top-ups-used MTD
 *  3. Project breakdown (collapsible) with per-project caps + paused state
 *  4. Workspace cap editor
 */
import { useEffect, useState } from "react";
import { Loader2, Plus, ChevronDown, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchRuntimeWallet,
  fetchProjectUsage,
  fetchRuntimeUsageSplit,
  formatUsdCents,
  setProjectSpendCap,
  setWorkspaceCap,
  type RuntimeWallet,
  type ProjectUsageRow,
  type RuntimeUsageSplit,
} from "@/lib/runtime-wallet";
import { RuntimeTopupModal } from "@/components/RuntimeTopupModal";
import petalLogo from "@/assets/petal-logo.png";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenBilling?: () => void;
};

export function CloudBalanceSheet({ open, onOpenChange, onOpenBilling }: Props) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<RuntimeWallet | null>(null);
  const [projects, setProjects] = useState<ProjectUsageRow[]>([]);
  const [split, setSplit] = useState<RuntimeUsageSplit>({ cloudCents: 0, aiCents: 0 });
  const [topupOpen, setTopupOpen] = useState(false);

  // Load all data when sheet opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const [w, p, s] = await Promise.all([
          fetchRuntimeWallet(uid),
          fetchProjectUsage(uid),
          fetchRuntimeUsageSplit(uid),
        ]);
        if (cancelled) return;
        setUserId(uid);
        setWallet(w);
        setProjects(p);
        setSplit(s);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't load balance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reload = async () => {
    if (!userId) return;
    const [w, p, s] = await Promise.all([
      fetchRuntimeWallet(userId),
      fetchProjectUsage(userId),
      fetchRuntimeUsageSplit(userId),
    ]);
    setWallet(w);
    setProjects(p);
    setSplit(s);
  };

  const resetDateLabel = wallet
    ? new Date(wallet.freeResetAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  // Single shared $5 free grant bucket spans both Cloud and AI usage.
  // It's locked until the user's first paid top-up. Per-meter usage rows
  // below only show top-up spend; free grant is shown once at the top.
  const monthlyGrant = wallet?.monthlyFreeGrantCents ?? 500;
  const qualified = wallet?.qualifiedForFreeGrant ?? false;
  const freeRemainingCents = qualified ? wallet?.freeBalanceCents ?? 0 : 0;
  const freeUsedCents = qualified ? Math.max(0, monthlyGrant - freeRemainingCents) : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto bg-background p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border/60 px-5 py-4">
            <SheetTitle className="text-lg font-semibold">Cloud &amp; AI balance</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Pay-as-you-go for everything that runs after your code is built
            </SheetDescription>
          </SheetHeader>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {/* Hero card */}
              <div className="rounded-2xl bg-muted/40 p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-coral/30 to-primary/20 p-1.5">
                    <img src={petalLogo} alt="Petal" className="h-full w-full object-contain" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold">Cloud + AI</h3>
                    <p className="text-xs text-muted-foreground">
                      Pay-as-you-go. Top-ups never expire.
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTopupOpen(true)}
                    className="rounded-full"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Top up
                  </Button>
                  <div className="text-right">
                    <div className="text-2xl font-semibold tabular-nums">
                      {formatUsdCents(wallet?.topupBalanceCents ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">Top-up balance</div>
                  </div>
                </div>
              </div>

              {/* Free grant + per-meter top-up usage */}
              <div className="space-y-4 rounded-2xl bg-muted/40 p-5">
                <div>
                  <h4 className="text-sm font-semibold">Free monthly credit</h4>
                  <div className="mt-2 text-xl font-semibold tabular-nums">
                    {qualified
                      ? `${formatUsdCents(freeUsedCents)} / ${formatUsdCents(monthlyGrant)}`
                      : `Locked`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {qualified
                      ? `Resets ${resetDateLabel}. Shared across Cloud and AI.`
                      : `Top up once to unlock $${(monthlyGrant / 100).toFixed(0)}/mo free Cloud credit.`}
                  </div>
                </div>
                <div className="border-t border-border/60" />
                <UsageRow label="Cloud" topupUsedCents={split.cloudCents} />
                <div className="border-t border-border/60" />
                <UsageRow label="AI" topupUsedCents={split.aiCents} />
              </div>

              {/* Project breakdown */}
              <Collapsible className="rounded-2xl bg-muted/40">
                <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-4 text-left">
                  <span className="text-base font-semibold">Project breakdown</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 px-5 pb-5">
                  {projects.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No projects yet.</p>
                  ) : (
                    projects.map((p) => (
                      <ProjectUsageRow
                        key={p.projectId}
                        project={p}
                        onUpdated={reload}
                      />
                    ))
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Workspace cap */}
              {userId && wallet && (
                <WorkspaceCapEditor
                  userId={userId}
                  capCents={wallet.workspaceCapCents}
                  onUpdated={reload}
                />
              )}

              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                Cloud + AI is pay-as-you-go from your top-up balance. Top-ups never expire.
              </p>
              {onOpenBilling && (
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  Looking for AI message credits?{" "}
                  <button
                    type="button"
                    onClick={onOpenBilling}
                    className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                  >
                    Open Plans &amp; credits →
                  </button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <RuntimeTopupModal
        open={topupOpen}
        onOpenChange={setTopupOpen}
        onSuccess={reload}
      />
    </>
  );
}

function UsageRow({
  label,
  topupUsedCents,
}: {
  label: string;
  topupUsedCents: number;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{label}</h4>
      <div className="mt-2 text-xl font-semibold tabular-nums">
        {formatUsdCents(topupUsedCents)}
      </div>
      <div className="text-xs text-muted-foreground">Top-ups used this month</div>
    </div>
  );
}

function ProjectUsageRow({
  project,
  onUpdated,
}: {
  project: ProjectUsageRow;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [capInput, setCapInput] = useState(
    project.capCents == null ? "" : String(project.capCents / 100),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const dollars = capInput.trim() === "" ? null : Number(capInput);
      if (dollars != null && (!Number.isFinite(dollars) || dollars < 0)) {
        throw new Error("Enter a valid amount");
      }
      await setProjectSpendCap(
        project.projectId,
        dollars == null ? null : Math.round(dollars * 100),
      );
      toast.success("Spend cap updated");
      setEditing(false);
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update cap");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-background/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{project.title}</div>
          <div className="text-xs text-muted-foreground">
            {formatUsdCents(project.spentCents)} this month
            {project.capCents != null && ` · cap ${formatUsdCents(project.capCents)}`}
          </div>
        </div>
        {project.paused && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            <AlertCircle className="h-3 w-3" />
            Paused
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            placeholder="No cap"
            className="h-8 flex-1 text-xs"
            inputMode="decimal"
          />
          <Button size="sm" className="h-8 px-3" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 h-7 px-2 text-xs"
          onClick={() => setEditing(true)}
        >
          {project.capCents == null ? "Set spend cap" : "Edit cap"}
        </Button>
      )}
    </div>
  );
}

function WorkspaceCapEditor({
  userId,
  capCents,
  onUpdated,
}: {
  userId: string;
  capCents: number | null;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(capCents == null ? "" : String(capCents / 100));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const dollars = input.trim() === "" ? null : Number(input);
      if (dollars != null && (!Number.isFinite(dollars) || dollars < 0)) {
        throw new Error("Enter a valid amount");
      }
      await setWorkspaceCap(userId, dollars == null ? null : Math.round(dollars * 100));
      toast.success("Workspace cap updated");
      setEditing(false);
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update cap");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Workspace spend cap</h4>
          <p className="text-xs text-muted-foreground">
            {capCents == null ? "No cap set" : `Stops billing past ${formatUsdCents(capCents)}/mo`}
          </p>
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
            {capCents == null ? "Set cap" : "Edit"}
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">$</Label>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="No cap"
            className="h-8 flex-1 text-xs"
            inputMode="decimal"
          />
          <Button size="sm" className="h-8 px-3" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
