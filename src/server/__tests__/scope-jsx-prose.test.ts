import { describe, it, expect } from "vitest";
import { verifyFileLocal } from "@/server/local-verifier";

const prose = `import { Card } from "@/components/ui/card";
export default function AboutPage() {
  return (
    <Card>
      <p>We estimate your due date, determine your current gestational age, and identify your current trimester, based on your last period.</p>
      <p>It's designed to support your journey without replacing a clinician's advice.</p>
      <p>While this tool provides estimates and general information, it is not medical advice.</p>
    </Card>
  );
}`;

describe("scope leaks", () => {
  it("ignores JSX prose", () => {
    const issues = verifyFileLocal("src/pages/AboutPage.tsx", prose);
    expect(issues.filter(i => /undeclared/.test(i.detail))).toEqual([]);
    expect(issues.filter(i => i.kind === "unterminated-string")).toEqual([]);
    expect(issues.filter(i => i.kind === "braces")).toEqual([]);
  });
  it.each([
    "This page hasn't been built yet.",
    "Don't worry about it.",
    "Can't find that page.",
    `She said "it's ready" and left.`,
  ])("ignores quotes and apostrophes in JSX text: %s", (text) => {
    const src = `export function A(){ return <main><p>${text}</p><section>Nested</section></main>; }`;
    const issues = verifyFileLocal("src/App.tsx", src);
    expect(issues.filter((i) => ["unterminated-string", "braces", "jsx"].includes(i.kind))).toEqual([]);
  });
  it("preserves JavaScript expressions nested inside JSX", () => {
    const broken = `export function A(){ return <p>It's {"unfinished}</p>; }`;
    const issues = verifyFileLocal("src/pages/A.tsx", broken);
    expect(issues.some(i => i.kind === "unterminated-string")).toBe(true);
  });
  it("still catches real leaks", () => {
    const bad = `export function A(){ return <div>{total && count}</div>; }`;
    const issues = verifyFileLocal("src/pages/A.tsx", bad);
    expect(issues.some(i => /undeclared/.test(i.detail))).toBe(true);
  });
  it("still catches a genuine unterminated JavaScript string", () => {
    const broken = `export function A(){ const label = "unfinished; return <p>{label}</p>; }`;
    const issues = verifyFileLocal("src/App.tsx", broken);
    expect(issues.some((i) => i.kind === "unterminated-string")).toBe(true);
  });
});
