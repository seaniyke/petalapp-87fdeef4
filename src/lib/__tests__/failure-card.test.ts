import { describe, it, expect } from "vitest";
import { PipelineError, toFriendlyError } from "@/lib/friendly-errors";

const card = (kind: ConstructorParameters<typeof PipelineError>[1], raw = "raw") =>
  toFriendlyError(new PipelineError("m", kind, raw));

describe("failure card derives from the authoritative classification", () => {
  it("AI outage → Continue, project untouched", () => {
    for (const k of ["upstream_unavailable", "rate_limit", "provider_credits_exhausted"] as const) {
      const c = card(k);
      expect(c.origin).toBe("infrastructure");
      expect(c.title).toBe("The AI service was temporarily unavailable.");
      expect(c.actionLabel).toBe("Continue");
      expect(c.actionKind).toBe("retry");
      expect(c.projectChanged).toBe(false);
    }
  });
  it("transport → never says failed, no regenerate button", () => {
    const c = card("upstream_timeout");
    expect(c.origin).toBe("transport");
    expect(c.title).toBe("The connection to the builder was interrupted.");
    expect(c.message).toMatch(/doesn't mean the build failed/);
    expect(c.actionKind).toBe("dismiss");
    expect(c.title).not.toMatch(/failed/i);
  });
  it("cancelled → states cancellation, no retry", () => {
    const c = card("aborted");
    expect(c.origin).toBe("cancelled");
    expect(c.title).toBe("Generation cancelled.");
    expect(c.actionKind).toBe("dismiss");
    expect(c.preserved).toMatch(/verified version/);
  });
  it("needs user input → keeps the exact ask, never auto-retries", () => {
    const credits = card("credits_exhausted");
    expect(credits.origin).toBe("user_input");
    expect(credits.actionKind).toBe("buy-credits");
    expect(credits.autoRetrying).toBe(false);
    const vague = card("no_files_emitted");
    expect(vague.origin).toBe("user_input");
    expect(vague.message).toMatch(/describing the app/);
  });
  it("code → keeps what verification found and offers a fix", () => {
    const c = card("generation_incomplete");
    expect(c.origin).toBe("code");
    expect(c.message).toMatch(/final check/);
    expect(c.actionKind).toBe("retry");
    const located = toFriendlyError("Could not resolve \"./hooks/usePageMeta\"");
    expect(located.origin).toBe("code");
    expect(located.actionKind).toBe("ask-fix");
  });
  it("unclassified raw failures still get an origin", () => {
    expect(toFriendlyError("stream closed with no result payload").origin).toBe("transport");
  });
});
