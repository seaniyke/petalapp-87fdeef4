/**
 * The harness must be able to tell a Kimble failure apart from a dropped
 * socket or an unreadable judge. These are the three decisions that made
 * earlier runs lie about what happened.
 */
import { describe, expect, it } from "vitest";
import { extractJudgeJson, looksInfrastructural } from "@/server/benchmark.server";
import { detectAuth } from "@/server/verify-plan.server";

describe("judge reply parsing", () => {
  it("reads raw JSON", () => {
    expect(extractJudgeJson('{"results":[{"id":"a","passed":true}]}')).toMatchObject({
      results: [{ id: "a", passed: true }],
    });
  });

  it("reads JSON inside a markdown fence", () => {
    const reply = 'Here you go:\n```json\n{"results":[{"id":"a","passed":false}]}\n```\nHope that helps.';
    expect(extractJudgeJson(reply)).toMatchObject({ results: [{ id: "a", passed: false }] });
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractJudgeJson("I could not read the source.")).toBeNull();
  });
});

describe("infrastructure vs product failures", () => {
  it("treats transport failures as infrastructure", () => {
    for (const msg of [
      "The socket connection was closed unexpectedly.",
      "Unable to connect. Is the computer able to access the url?",
      "The operation was aborted.",
      "Unauthorized",
    ]) {
      expect(looksInfrastructural(msg)).toBe(true);
    }
  });

  it("leaves genuine product failures alone", () => {
    expect(looksInfrastructural("/sign-in rendered a blank page")).toBe(false);
    expect(looksInfrastructural(undefined)).toBe(false);
  });
});

describe("auth probing", () => {
  const signInPage = `export default function SignIn(){
    return <form><input type="email"/><input type="password"/><button>Sign in</button></form>;
  }`;

  it("does not drive sign-up on a front-end-only sign-in screen", () => {
    expect(detectAuth([{ path: "src/pages/SignIn.tsx", content: signInPage }], ["/", "/sign-in"])).toBeNull();
  });

  it("still probes auth when the app really calls an auth provider", () => {
    const withProvider = `${signInPage}\nawait supabase.auth.signInWithPassword({ email, password });`;
    expect(detectAuth([{ path: "src/pages/SignIn.tsx", content: withProvider }], ["/", "/sign-in"])).toBeTruthy();
  });
});

