import { describe, it, expect } from "vitest";
import { decideAskPolicy, stripQuestions } from "../ask-policy.server";

describe("decideAskPolicy", () => {
  it("acts on a plain instruction", () => {
    const d = decideAskPolicy("add a contact form to the homepage");
    expect(d.forceAction).toBe(true);
    expect(d.reason).toBe("actionable-instruction");
  });

  it("never asks twice in a row", () => {
    const d = decideAskPolicy("a barber shop", [
      { role: "user", content: "make me a site" },
      { role: "assistant", content: "Nice — what's the site for?" },
    ]);
    expect(d.forceAction).toBe(true);
    expect(d.reason).toBe("answering-a-question");
  });

  it("respects an explicit stop-asking nudge", () => {
    const d = decideAskPolicy("just do it");
    expect(d.forceAction).toBe(true);
    expect(d.reason).toBe("repeat-request");
  });

  it("acts on a long detailed brief with no verb match", () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(decideAskPolicy(text).forceAction).toBe(true);
  });

  it("still allows a question on a genuinely bare ask", () => {
    const d = decideAskPolicy("something for my business");
    expect(d.forceAction).toBe(false);
  });

  it("does not force action on a user question", () => {
    const d = decideAskPolicy("can you add dark mode?");
    expect(d.forceAction).toBe(false);
  });
});

describe("stripQuestions", () => {
  it("removes question sentences but keeps the rest", () => {
    expect(stripQuestions("Love it. What colour should it be?")).toBe("Love it.");
  });

  it("falls back when everything was a question", () => {
    expect(stripQuestions("What should I build?")).toBe("On it…");
  });
});
