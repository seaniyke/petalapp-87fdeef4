import { useMemo, useReducer } from "react";
import { deriveView, initialTurnState, turnReducer } from "./turn-reducer";

/** One reducer per builder session; live and replay both dispatch into it. */
export function useTurnExecution() {
  const [state, dispatch] = useReducer(turnReducer, initialTurnState);
  const view = useMemo(() => deriveView(state), [state]);
  return { state, view, dispatch };
}
