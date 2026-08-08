import { describe, it, expect } from "vitest";
import { verifyFileLocal } from "@/server/local-verifier";

const prose = `import { Card } from "@/components/ui/card";
export default function AboutPage() {
  return (
    <Card>
      <p>We estimate your due date, determine your current gestational age, and identify your current trimester, based on your last period.</p>
      <p>While this tool provides estimates and general information, it is not medical advice.</p>
    </Card>
  );
}`;

describe("scope leaks", () => {
  it("ignores JSX prose", () => {
    const issues = verifyFileLocal("src/pages/AboutPage.tsx", prose);
    expect(issues.filter(i => /undeclared/.test(i.detail))).toEqual([]);
  });
  it("still catches real leaks", () => {
    const bad = `export function A(){ return <div>{total && count}</div>; }`;
    const issues = verifyFileLocal("src/pages/A.tsx", bad);
    expect(issues.some(i => /undeclared/.test(i.detail))).toBe(true);
  });
});
