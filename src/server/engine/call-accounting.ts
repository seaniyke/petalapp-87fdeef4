/**
 * AI-call accounting. Every AI call Kimble makes is explained by
 *   stage · purpose · kind · reason · parent stage · files it wrote.
 *
 * Classification is deterministic, from the fields each call site already
 * sends (feature / phase / chosenBy / recoveryReason). A call that matches
 * no rule is tagged stage="unclassified" — that is a defect to fix, never
 * silently accepted. File attribution comes from an ambient stage frame.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type CallKind = "normal" | "retry" | "continuation" | "repair" | "check" | "background";

export interface CallExplanation {
  stage: string;
  purpose: string;
  kind: CallKind;
  reason: string;
  parent: string | null;
}

export function explainAiCall(i: {
  feature: string;
  phase?: string | null;
  chosenBy?: string | null;
  recoveryReason?: string | null;
}): CallExplanation {
  const f = i.feature;
  const cb = i.chosenBy ?? "";
  const rr = i.recoveryReason ?? "";
  const ph = i.phase ?? "";
  if (f === "preflight") return { stage: "request", purpose: "classify the request (triage / product brief)", kind: "check", reason: "every turn", parent: null };
  if (f === "design") return { stage: "plan", purpose: "pick a design direction", kind: "normal", reason: "first build", parent: "request" };
  if (f === "memory") return { stage: "after", purpose: "save project memory", kind: "background", reason: "turn finished", parent: "write" };
  if (cb === "missing_pages") return { stage: "write", purpose: "write one requested page (or the router)", kind: "normal", reason: rr || "page not yet written", parent: "write" };
  if (cb === "missing_pages_provider_retry") return { stage: "write", purpose: "resend a page call to another provider", kind: "retry", reason: rr || "provider failed", parent: "write" };
  if (cb === "broken_file_repair") return { stage: "repair", purpose: "repair one file that fails to compile", kind: "repair", reason: rr || "parse error", parent: "validate" };
  if (cb === "op_repair_round" || cb === "per_file_rewrite")
    return { stage: "repair", purpose: "fix a file the validator rejected", kind: "repair", reason: rr || cb, parent: "validate" };
  if (cb === "tool_recovery" || cb === "truncation_small_chunk" || cb === "provider_failure_retry" || /stall|empty|provider_error/.test(rr))
    return { stage: "write", purpose: "resend after provider failure", kind: "retry", reason: rr || cb, parent: "write" };
  if (ph === "design-contract") return { stage: "repair", purpose: "fix design-rule violations", kind: "repair", reason: "design lint errors", parent: "validate" };
  if (ph === "verify-plan") return { stage: "verify", purpose: "plan browser checks", kind: "check", reason: "build finished", parent: "build" };
  if (f === "generate" && (cb.startsWith("smart_router") || cb.startsWith("phase") || !cb))
    return { stage: "write", purpose: ph === "implement" ? "first write (shell + pages)" : `write (${ph || "edit"})`, kind: "normal", reason: "user request", parent: "plan" };
  if (f === "recovery") return { stage: "repair", purpose: "recovery", kind: "repair", reason: rr || "unspecified", parent: "validate" };
  return { stage: "unclassified", purpose: `${f}/${ph}/${cb}`, kind: "normal", reason: rr || "unknown", parent: null };
}

// ---- file attribution -------------------------------------------------

interface Frame { callIds: string[] }
let store: AsyncLocalStorage<Frame> | null = null;
try { store = new AsyncLocalStorage<Frame>(); } catch { store = null; }

/** Run `fn`; every AI call row created inside it is collected. */
export async function withCallFrame<T>(fn: () => Promise<T>): Promise<{ value: T; callIds: string[] }> {
  const frame: Frame = { callIds: [] };
  const value = store ? await store.run(frame, fn) : await fn();
  return { value, callIds: frame.callIds };
}

export function noteCallRow(id: string | null): void {
  if (!id) return;
  try { store?.getStore()?.callIds.push(id); } catch { /* ignore */ }
}

/** Record which files the calls in a frame produced. */
export async function attachFiles(callIds: string[], paths: string[]): Promise<void> {
  if (!callIds.length) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("ai_call_log")
      .update({ files_affected: paths, generated_files: paths.length > 0 } as never)
      .in("id", callIds);
  } catch (e) {
    console.warn("[call-accounting] attach failed", e);
  }
}
