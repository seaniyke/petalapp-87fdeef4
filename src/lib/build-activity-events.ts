export type ActivityEvent = {
  step: string;
  message: string;
  ts: number;
  url?: string;
};

/** Resume streams can replay an event. Appending activity must be idempotent. */
export function appendUniqueActivity<T extends ActivityEvent>(
  previous: T[],
  entry: T,
  limit = 30,
): T[] {
  const duplicate = entry.url
    ? previous.some((event) => event.url === entry.url)
    : previous.some(
        (event) =>
          event.step === entry.step && event.ts === entry.ts && event.message === entry.message,
      );
  if (duplicate || previous.length >= limit) return previous;
  return [...previous, entry];
}

export function distinctPictureUrls(events: ActivityEvent[]): string[] {
  return Array.from(
    new Set(
      events
        .map((event) => event.url)
        .filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  );
}