import { useEffect, useMemo, useReducer } from "react";
import { deriveView, initialTurnState, missingFrom, turnReducer } from "./turn-reducer";

/** How long a hole in the durable sequence may hold later events back. */
export const GAP_WAIT_MS = 2500;

/**
 * One reducer per builder session; live and replay both dispatch into it.
 * `useReducer` queues every dispatch, so events that arrive mid-render are
 * applied in order, never dropped. When a seq gap persists (a missed event),
 * `onGap` asks the caller to replay from the last applied seq; if the gap
 * still hasn't filled after GAP_WAIT_MS, held events are applied in order.
 */
export function useTurnExecution(onGap?: (turnId: string, afterSeq: number) => void) {
  const [state, dispatch] = useReducer(turnReducer, initialTurnState);
  const view = useMemo(() => deriveView(state), [state]);
  const gapAt = missingFrom(state);
  const turnId = state.turnId;
  useEffect(() => {
    if (gapAt === null || !turnId) return;
    onGap?.(turnId, gapAt);
    const t = setTimeout(() => dispatch({ type: "flush_pending" }), GAP_WAIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm per gap position only
  }, [gapAt, turnId]);
  return { state, view, dispatch };
}
