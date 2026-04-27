/**
 * IdeaCoach — the in-card UI that lives where the textarea normally would,
 * when the user picks "Help me think" from the composer mode dropdown.
 *
 * Behaviour:
 *  - First turn: show 4 seed chips ("For my work", "For a hobby", …) so the
 *    user picks rather than types. They can also type freely.
 *  - Each subsequent turn: show the model's question + 2-5 chip choices, and
 *    a small text input as a freeform fallback. A growing prompt-preview card
 *    sits above the question so the user can see their idea taking shape.
 *  - Final turn: show the assembled prompt with two clear actions —
 *    "Try a different idea" (resets) or "Build this" (calls onComplete to
 *    drop the prompt into the real composer).
 *
 * Auth: the coach charges credits, so unauthenticated users get the same
 * sign-in redirect the rest of the composer uses. We surface that via the
 * onRequireSignIn prop instead of duplicating the redirect logic here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, RotateCw, ArrowUp, AlertCircle, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestCoachTurn, type CoachExchange } from "@/lib/coach";

export type IdeaCoachState = {
  step: "seed" | "asking" | "final";
  history: CoachExchange[];
  question: string;
  chips: string[];
  preview: string;
  assembledPrompt: string;
  turn: number;
};

const SEED_CHIPS = [
  "For my work",
  "For a hobby",
  "For a small business",
  "Surprise me",
];

const INITIAL_STATE: IdeaCoachState = {
  step: "seed",
  history: [],
  question: "What kind of thing are you in the mood to make?",
  chips: SEED_CHIPS,
  preview: "",
  assembledPrompt: "",
  turn: 0,
};

export function IdeaCoach({
  isAuthed,
  onComplete,
  onRequireSignIn,
}: {
  isAuthed: boolean;
  onComplete: (prompt: string) => void;
  onRequireSignIn: () => void;
}) {
  const [state, setState] = useState<IdeaCoachState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTopup, setNeedsTopup] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the last in-flight call cancellable so a fast user double-tap doesn't
  // produce two stacked turns (and double charges).
  useEffect(() => () => abortRef.current?.abort(), []);

  const submitAnswer = async (rawAnswer: string) => {
    const answer = rawAnswer.trim();
    if (!answer || busy) return;

    if (!isAuthed) {
      onRequireSignIn();
      return;
    }

    setError(null);
    setNeedsTopup(false);
    setBusy(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const nextTurn = state.turn + 1;
    // Optimistically attach the user's answer to the running history so the
    // server sees it on this very turn (state.history is the *prior* dialogue).
    const historyForServer: CoachExchange[] = state.history;

    try {
      const result = await requestCoachTurn(
        { turn: nextTurn, history: historyForServer, userInput: answer },
        controller.signal,
      );

      // Append this exchange to history — the question we just answered + the
      // answer we gave. (The new question, if any, comes from result.)
      const justAsked = state.question;
      const updatedHistory: CoachExchange[] = [
        ...state.history,
        { question: justAsked, answer },
      ];

      if (result.isFinal && result.assembledPrompt) {
        setState({
          step: "final",
          history: updatedHistory,
          question: "",
          chips: [],
          preview: result.preview || result.assembledPrompt,
          assembledPrompt: result.assembledPrompt,
          turn: nextTurn,
        });
      } else {
        setState({
          step: "asking",
          history: updatedHistory,
          question: result.question || "Tell me a bit more.",
          chips: result.chips,
          preview: result.preview,
          assembledPrompt: "",
          turn: nextTurn,
        });
      }
      setDraft("");
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = (e as { status?: number }).status;
      const msg = e instanceof Error ? e.message : "Coach is having trouble right now.";
      if (status === 402) {
        setNeedsTopup(true);
        setError(msg);
      } else if (status === 429) {
        setError("Coach is a bit busy. Try again in a moment.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
    setDraft("");
    setError(null);
    setNeedsTopup(false);
    setEditingPrompt(false);
  };

  const handleBuild = () => {
    if (!state.assembledPrompt.trim()) return;
    onComplete(state.assembledPrompt.trim());
  };

  const turnLabel = useMemo(() => {
    if (state.step === "seed") return "free first pick";
    if (state.step === "final") return `done · ${state.history.length} turn${state.history.length === 1 ? "" : "s"}`;
    return `½ credit · turn ${state.turn}`;
  }, [state.step, state.turn, state.history.length]);

  return (
    <div className="flex flex-col gap-3 px-1 pb-16 pt-1">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-lilac" aria-hidden />
          Idea coach
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            state.step === "final"
              ? "bg-mint/40 text-foreground/80"
              : "bg-lilac/30 text-foreground/70",
          )}
        >
          {turnLabel}
        </span>
      </div>

      {/* Live preview card — only once we have something to show */}
      {state.preview && state.step !== "final" && (
        <div
          className="rounded-2xl border border-dashed border-border bg-background/60 p-3 text-[13px] leading-snug text-foreground/85"
          aria-live="polite"
        >
          <span className="text-muted-foreground">Building your idea: </span>
          {state.preview}
        </div>
      )}

      {state.step === "final" ? (
        <FinalCard
          prompt={state.assembledPrompt}
          editing={editingPrompt}
          onEdit={(v) => setState((s) => ({ ...s, assembledPrompt: v }))}
          onToggleEdit={() => setEditingPrompt((v) => !v)}
        />
      ) : (
        <>
          {/* Question */}
          <p className="px-1 text-[15px] font-medium leading-snug text-foreground">
            {state.question}
          </p>

          {/* Chip choices */}
          {state.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {state.chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => void submitAnswer(chip)}
                  disabled={busy}
                  className={cn(
                    "rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs text-foreground transition",
                    "hover:border-primary/50 hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    busy && "cursor-not-allowed opacity-60",
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Freeform fallback */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void submitAnswer(draft);
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background/70 pl-3 pr-1 py-0.5 focus-within:border-primary/50"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              placeholder="…or type your own answer"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-xs leading-snug text-foreground outline-none placeholder:text-muted-foreground/70"
              maxLength={300}
            />
            <button
              type="submit"
              aria-label="Send answer"
              disabled={busy || !draft.trim()}
              className="grid h-7 w-7 place-items-center rounded-full bg-foreground/85 text-background transition hover:bg-foreground disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              )}
            </button>
          </form>
        </>
      )}

      {/* Errors */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-[12px] text-foreground/80">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-coral" aria-hidden />
          <span className="flex-1">
            {error}
            {needsTopup && (
              <>
                {" "}
                <a
                  href="/billing"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Top up
                </a>
                .
              </>
            )}
          </span>
        </div>
      )}

      {/* Actions row when in the final state */}
      {state.step === "final" && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RotateCw className="h-3 w-3" />
            Try a different idea
          </button>
          <button
            type="button"
            onClick={handleBuild}
            disabled={!state.assembledPrompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:brightness-105 disabled:opacity-50"
          >
            Build this
            <ArrowUp className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function FinalCard({
  prompt,
  editing,
  onEdit,
  onToggleEdit,
}: {
  prompt: string;
  editing: boolean;
  onEdit: (next: string) => void;
  onToggleEdit: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-3 shadow-[var(--shadow-soft)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" aria-hidden />
          Here&apos;s your prompt
        </span>
        <button
          type="button"
          onClick={onToggleEdit}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-2.5 w-2.5" />
          {editing ? "Done" : "Tweak"}
        </button>
      </div>
      {editing ? (
        <textarea
          value={prompt}
          onChange={(e) => onEdit(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-xl border border-border bg-background/70 p-2 text-[13px] leading-snug text-foreground outline-none focus:border-primary/50"
          maxLength={600}
        />
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-snug text-foreground">{prompt}</p>
      )}
    </div>
  );
}
