/**
 * Check outcomes. Only FAIL is evidence of a defect; UNAVAILABLE, WARNING
 * and UNKNOWN never trigger repair and never mark a project broken.
 */
export type Verdict = "PASS" | "FAIL" | "UNAVAILABLE" | "WARNING" | "UNKNOWN";

/** Map the validator's existing states onto the shared verdict. */
export function toVerdict(state: string | null | undefined): Verdict {
  switch (state) {
    case "passed":
    case "ok":
      return "PASS";
    case "failed":
    case "error":
      return "FAIL";
    case "unavailable":
    case "timeout":
      return "UNAVAILABLE";
    case "warning":
      return "WARNING";
    default:
      return "UNKNOWN";
  }
}

export function shouldRepair(v: Verdict): boolean {
  return v === "FAIL";
}

/** Can this turn commit? A FAIL blocks; everything else is reported honestly. */
export function blocksCommit(v: Verdict): boolean {
  return v === "FAIL";
}
