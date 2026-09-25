import { describe, it, expect } from "vitest";
import { buildProjectManifest } from "@/server/context";
import {
  classifyRequest,
  buildExecutionScope,
  toVerdict,
  shouldRepair,
  TurnLedger,
  TurnTransaction,
} from "@/server/execution";
import { RecoveryBudget } from "@/server/engine/recovery-policy";

const files = [
  { path: "src/App.tsx", content: `import { Routes, Route } from "react-router-dom";\nimport Home from "./pages/Home";\nimport Pricing from "./pages/Pricing";\nexport default function A(){return <Routes><Route path="/" element={<Home/>}/><Route path="/pricing" element={<Pricing/>}/></Routes>}` },
  { path: "src/pages/Home.tsx", content: `import Hero from "../components/Hero";\nexport default function H(){return <Hero/>}` },
  { path: "src/pages/Pricing.tsx", content: `export default function P(){return <div/>}` },
  { path: "src/components/Hero.tsx", content: `export default function Hero(){return <section/>}` },
  { path: "src/components/SiteHeader.tsx", content: `export default function S(){return <nav/>}` },
  { path: "src/components/Footer.tsx", content: `export default function F(){return <footer/>}` },
];
const manifest = buildProjectManifest(files);

describe("classification", () => {
  it("classifies deterministically", () => {
    expect(classifyRequest("anything", { isInitial: true }).operation).toBe("first_build");
    expect(classifyRequest("Add a pricing page", { isInitial: false }).operation).toBe("page_creation");
    expect(classifyRequest("Redesign the whole site", { isInitial: false })).toMatchObject({ operation: "architectural_change", planRequired: true });
    expect(classifyRequest("Change the headline to \"Fresh bread daily\"", { isInitial: false }).operation).toBe("content_change");
    expect(classifyRequest("make the hero button bigger", { isInitial: false })).toMatchObject({ operation: "styling_change", mode: "direct", planRequired: false });
    expect(classifyRequest("the page is blank, fix it", { isInitial: false }).operation).toBe("repair");
    expect(classifyRequest("install date-fns", { isInitial: false }).operation).toBe("dependency_change");
    expect(classifyRequest("swap the hero image", { isInitial: false }).operation).toBe("asset_change");
  });
});

describe("scope protection", () => {
  const simple = buildExecutionScope({
    request: "Change the homepage hero",
    classification: classifyRequest("Change the homepage hero", { isInitial: false, manifest }),
    manifest,
    targets: ["src/pages/Home.tsx", "src/components/Hero.tsx"],
  });
  it("simple edit may change only its targets", () => {
    expect(simple.isProtected("src/components/Hero.tsx")).toBe(false);
    expect(simple.isProtected("src/components/SiteHeader.tsx")).toBe(true);
    expect(simple.isProtected("src/components/Footer.tsx")).toBe(true);
    expect(simple.isProtected("src/pages/Pricing.tsx")).toBe(true);
  });
  it("a new component imported by the change is allowed", () => {
    expect(simple.isProtected("src/components/HeroBadge.tsx")).toBe(false);
  });
  it("naming the nav unlocks it", () => {
    const s = buildExecutionScope({
      request: "add a link to the navbar",
      classification: classifyRequest("add a link to the navbar", { isInitial: false }),
      manifest,
      targets: ["src/components/Hero.tsx"],
    });
    expect(s.isProtected("src/components/SiteHeader.tsx")).toBe(false);
  });
  it("multi-file architectural change is not protected", () => {
    const s = buildExecutionScope({
      request: "redesign every page",
      classification: classifyRequest("redesign every page", { isInitial: false }),
      manifest,
      targets: ["src/pages/Home.tsx"],
    });
    expect(s.isProtected("src/components/Footer.tsx")).toBe(false);
    expect(s.isProtected("src/pages/Pricing.tsx")).toBe(false);
  });
});

describe("verdicts — no false repairs", () => {
  it("only FAIL triggers repair", () => {
    expect(shouldRepair(toVerdict("failed"))).toBe(true);
    expect(shouldRepair(toVerdict("unavailable"))).toBe(false);
    expect(shouldRepair(toVerdict("timeout"))).toBe(false);
    expect(shouldRepair(toVerdict("warning"))).toBe(false);
    expect(shouldRepair(toVerdict("not_checked"))).toBe(false);
    expect(toVerdict("passed")).toBe("PASS");
  });
});

describe("tool discipline", () => {
  it("refuses duplicate reads and no-op writes", () => {
    const l = new TurnLedger();
    expect(l.use("read", "target", "a.tsx").ok).toBe(true);
    expect(l.use("read", "again", "a.tsx")).toEqual({ ok: false, refusal: "duplicate_read" });
    expect(l.write("a.tsx", "same", "same", "edit")).toEqual({ ok: false, refusal: "no_op_write" });
    expect(l.write("a.tsx", "new", "same", "edit").ok).toBe(true);
  });
  it("prevents a second writer", () => {
    const l = new TurnLedger();
    expect(l.write("a.tsx", "x", "y", "edit", "primary").ok).toBe(true);
    expect(l.write("b.tsx", "x", "y", "cleanup", "cleanup-agent")).toEqual({ ok: false, refusal: "foreign_writer" });
  });
  it("enforces per-turn limits", () => {
    const l = new TurnLedger({ ai_call: 1, read: 1, write: 1, delete: 1, dependency: 1, repair: 1, build: 1, browser: 1 });
    expect(l.use("build", "build").ok).toBe(true);
    expect(l.use("build", "build again")).toEqual({ ok: false, refusal: "limit" });
  });
  it("cancellation stops all further work", () => {
    const l = new TurnLedger();
    l.cancel();
    for (const k of ["ai_call", "write", "repair", "build"] as const) {
      expect(l.use(k, "after cancel")).toEqual({ ok: false, refusal: "cancelled" });
    }
  });
});

describe("bounded repair", () => {
  it("one build repair, at most three files", () => {
    const b = new RecoveryBudget();
    expect(b.take("build_failure")).toBe(true);
    expect(b.take("build_failure")).toBe(false);
    expect(b.take("broken_file", "a")).toBe(true);
    expect(b.take("broken_file", "b")).toBe(true);
    expect(b.take("broken_file", "c")).toBe(true);
    expect(b.take("broken_file", "d")).toBe(false);
    expect(b.take("broken_file", "a")).toBe(false);
  });
});

describe("transactions", () => {
  const base = [{ path: "a.tsx", content: "old" }, { path: "b.tsx", content: "keep" }];
  it("successful transaction commits only changed files", () => {
    const tx = new TurnTransaction(base, new TurnLedger());
    tx.stage("a.tsx", "new");
    tx.recordCheck("syntax", "PASS");
    tx.recordCheck("browser", "UNAVAILABLE");
    const out = tx.commit();
    expect(out.status).toBe("committed");
    if (out.status === "committed") {
      expect(out.changed).toEqual(["a.tsx"]);
      expect(out.files.find((f) => f.path === "b.tsx")?.content).toBe("keep");
    }
  });
  it("actual syntax failure rolls back to the last good state", () => {
    const tx = new TurnTransaction(base);
    tx.stage("a.tsx", "const x = ;");
    tx.recordCheck("syntax", "FAIL", "a.tsx:1 unexpected token");
    const out = tx.commit();
    expect(out.status).toBe("rolled_back");
    expect(out.files).toEqual(base);
  });
  it("cancellation beats completion", () => {
    const l = new TurnLedger();
    const tx = new TurnTransaction(base, l);
    tx.stage("a.tsx", "new");
    tx.recordCheck("syntax", "PASS");
    l.cancel();
    const out = tx.commit();
    expect(out).toMatchObject({ status: "rolled_back", reason: "cancelled" });
    expect(l.committed).toBe(false);
  });
  it("no writes after commit", () => {
    const l = new TurnLedger();
    const tx = new TurnTransaction(base, l);
    tx.stage("a.tsx", "new");
    tx.commit();
    expect(tx.stage("b.tsx", "late")).toBe(false);
    expect(l.use("repair", "late repair")).toEqual({ ok: false, refusal: "committed" });
  });
  it("a no-op edit does not commit", () => {
    const tx = new TurnTransaction(base, new TurnLedger());
    expect(tx.stage("a.tsx", "old")).toBe(false);
    expect(tx.commit()).toMatchObject({ status: "rolled_back", reason: "no changes" });
  });
});
