/**
 * The one line under the build headline — alive rather than static.
 *
 * It types itself in, crossfades when a new line arrives, and falls back to a
 * short in-character aside when nothing new has landed for a few seconds so
 * it never freezes on a stale sentence.
 */
import { useEffect, useRef, useState } from "react";
import { idleLine } from "@/lib/activity-language";

type Props = {
  /** The real line, derived from something Kimble actually did. */
  line?: string | null;
  /** Current phase id — picks the tone of the idle aside. */
  phaseId?: string;
  /** False freezes the text (turn finished / not running). */
  active: boolean;
  /** ms with no new line before an aside takes over. */
  idleAfterMs?: number;
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function LiveNarration({ line, phaseId, active, idleAfterMs = 6000 }: Props) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<string>(line ?? "");
  const [typed, setTyped] = useState<string>(line ?? "");
  const lastChangeRef = useRef<number>(Date.now());
  const [idleSeed, setIdleSeed] = useState(0);

  // A genuinely new line always wins and restarts the typing.
  useEffect(() => {
    const next = (line ?? "").trim();
    if (!next || next === shown) return;
    lastChangeRef.current = Date.now();
    setShown(next);
  }, [line, shown]);

  // Nothing new for a while → say something in character instead of sitting
  // on a line that is no longer true.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (Date.now() - lastChangeRef.current < idleAfterMs) return;
      const aside = idleLine(phaseId ?? "writing", idleSeed);
      if (!aside) return;
      lastChangeRef.current = Date.now();
      setIdleSeed((n) => n + 1);
      setShown(aside);
    }, 1200);
    return () => clearInterval(t);
  }, [active, phaseId, idleAfterMs, idleSeed]);

  // Type it in, character by character.
  useEffect(() => {
    if (!shown) {
      setTyped("");
      return;
    }
    if (reduced || !active) {
      setTyped(shown);
      return;
    }
    setTyped("");
    let i = 0;
    const speed = shown.length > 60 ? 10 : 18;
    const t = setInterval(() => {
      i += 1;
      setTyped(shown.slice(0, i));
      if (i >= shown.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [shown, reduced, active]);

  if (!shown) return null;

  return (
    <div
      className="mt-0.5 line-clamp-2 text-[12px] font-medium text-muted-foreground"
      aria-live="polite"
    >
      {typed}
      {active && typed.length < shown.length && (
        <span className="ml-px inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse bg-muted-foreground/70 motion-reduce:animate-none" />
      )}
    </div>
  );
}
