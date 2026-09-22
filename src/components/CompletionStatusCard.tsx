/**
 * Honest completion status for the current request.
 *
 * Kimble used to report "done" the moment the code compiled. This card shows
 * the server-owned record instead: what stage the request is at, the proof
 * collected when it succeeded, and — when Kimble stopped short — exactly what
 * still fails and why it stopped. No claim without evidence.
 */
import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  stage: string;
  attempts: number;
  max_attempts: number;
  accepted: boolean;
  outstanding_defects: unknown;
  evidence: unknown;
  terminal_reason: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  generating: "Writing your app",
  building: "Building and checking",
  needs_repair: "Fixing what the checks found",
  repairing: "Fixing what the checks found",
  delivered: "Checked and working",
  blocked: "Stopped — needs you",
  budget_spent: "Stopped after repeated attempts",
  superseded: "Replaced by a newer request",
};

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function CompletionStatusCard() {
  const search = useSearch({ strict: false }) as { id?: string };
  const projectId = typeof search?.id === "string" ? search.id : undefined;
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("project_turn_completion")
        .select("stage, attempts, max_attempts, accepted, outstanding_defects, evidence, terminal_reason")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setRow((data as Row | null) ?? null);
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  if (!row || row.stage === "superseded") return null;

  const evidence = asStrings(row.evidence);
  const defects = asStrings(row.outstanding_defects);
  const inProgress = ["generating", "building", "needs_repair", "repairing"].includes(row.stage);
  const Icon = row.accepted ? CheckCircle2 : inProgress ? Loader2 : CircleAlert;

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Icon className={`h-4 w-4 ${inProgress ? "animate-spin" : ""}`} aria-hidden />
        <span>{STAGE_LABEL[row.stage] ?? row.stage}</span>
      </div>

      {row.accepted && evidence.length > 0 && (
        <ul className="mt-3 space-y-1 text-muted-foreground">
          {evidence.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      )}

      {!row.accepted && defects.length > 0 && (
        <>
          <p className="mt-3 text-muted-foreground">What still needs fixing:</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {defects.slice(0, 6).map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </>
      )}

      {row.terminal_reason && !inProgress && (
        <p className="mt-3 text-muted-foreground">{row.terminal_reason}</p>
      )}

      {row.attempts > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Automatic fixes used: {row.attempts} of {row.max_attempts}
        </p>
      )}
    </div>
  );
}
