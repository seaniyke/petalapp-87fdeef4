import { defaultRange, type Range } from "./service-billing.server";

const MAX_SPAN_MS = 366 * 24 * 3600 * 1000;

/** `?from=&to=` (ISO dates). Defaults to this calendar month (UTC). */
export function parseRange(url: URL): Range | { error: string } {
  const def = defaultRange();
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw ? new Date(fromRaw) : new Date(def.from);
  const to = toRaw ? new Date(toRaw) : new Date(def.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: "bad_date" };
  if (from >= to) return { error: "from_must_be_before_to" };
  if (to.getTime() - from.getTime() > MAX_SPAN_MS) return { error: "range_too_long" };
  return { from: from.toISOString(), to: to.toISOString() };
}
