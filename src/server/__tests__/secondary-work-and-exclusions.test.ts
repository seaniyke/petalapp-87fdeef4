import { describe, expect, it } from "vitest";
import { deriveRequirements, mergeRequirements } from "@/server/prd/prd-requirements";
import { secondaryWorkRefusal, type SecondaryWork } from "@/server/engine/secondary-work";
import { runToolLoop, type ModelReply, type ToolCallMsg } from "@/server/engine/tool-loop";
import { DEFAULT_FIRST_BUILD_MODEL, DEFAULT_TEXT_MODEL } from "@/lib/ai-model-config";

const ids = (brief: string) => deriveRequirements(brief).map((r) => r.id);
describe("excluded lists are not requested work", () => {
  it("excludes bookings, accounts and payment processing from the validation brief", () => {
    expect(ids("Build a fitness website with Home, Services and Contact. No bookings, customer accounts or payment processing.")).toEqual(["home", "catalog", "contact"]);
  });
  it("excludes both booking and checkout under one no", () => {
    expect(ids("Build a site with Home and About. No booking or checkout.")).toEqual(["home", "about"]);
  });
  it("resumes at a positive clause without suppressing contact", () => {
    expect(ids("Build a site with Home, no booking or checkout, but include Contact and About.")).toEqual(["home", "contact", "about"]);
  });
  it("without and do not apply to the whole comma-separated list", () => {
    for (const prefix of ["Without", "Do not include", "Don't add", "Exclude"]) {
      expect(ids(`Build a site with Home and Contact. ${prefix} bookings, accounts and checkout.`)).toEqual(["home", "contact"]);
    }
  });
  it("does not remove explicitly requested payment functionality", () => {
    expect(ids("Build a site with Home, Booking and Stripe payments. No customer accounts.")).toEqual(["home", "booking", "payments"]);
  });
  it("not only and no-code are not exclusions", () => {
    expect(ids("Build a no-code site with Home, Booking and Contact. Not only modern.")).toContain("booking");
  });
  it("removal requests still reject existing requirements", () => {
    const result = mergeRequirements(deriveRequirements("Build a site with Home, Booking and Contact"), "Remove Booking");
    expect(result.requirements.find((r) => r.id === "booking")?.status).toBe("REJECTED");
  });
});

const pages = [{ route: "/", file: "src/pages/Home.tsx" }, { route: "/about", file: "src/pages/About.tsx" }];
const work: SecondaryWork = { path: "src/pages/About.tsx", kind: "informational", task: "Compose the story page using the existing layout and full requested imagery.", dependencies: ["src/components/Layout.tsx"] };
const content = "export default function Layout(){return <main/>;}";
const evidence = () => ({ pages, files: new Map([[work.dependencies[0] ?? "", content]]), validation: new Map([[work.dependencies[0] ?? "", [] as string[]]]), validatedHash: new Map([[work.dependencies[0] ?? "", content]]), hash: (s: string) => s });

describe("first-build routine work keeps proof and frontier ownership", () => {
  it("keeps Argon as the configured frontier model", () => {
    expect(DEFAULT_FIRST_BUILD_MODEL).toBe("google/gemini-4-argon");
  });
  it("uses Flash as the configured routine-code model", () => {
    expect(DEFAULT_TEXT_MODEL).toBe("google/gemini-3.8-flash");
  });
  it("admits informational and read-only secondary work with a valid shared foundation", () => {
    expect(secondaryWorkRefusal(work, evidence())).toBeNull();
    expect(secondaryWorkRefusal({ ...work, kind: "read_only_list" }, evidence())).toBeNull();
  });
  it("never hands off the core page", () => {
    expect(secondaryWorkRefusal({ ...work, path: "src/pages/Home.tsx" }, evidence())).toContain("core page");
  });
  it("keeps complex payment work on frontier instead of banning it", () => {
    expect(secondaryWorkRefusal({ ...work, task: "Implement payment workflow" }, evidence())).toContain("frontier");
  });
  it("does not use stale validation as proof", () => {
    const ev = evidence(); ev.files.set("src/components/Layout.tsx", "changed");
    expect(secondaryWorkRefusal(work, ev)).toContain("current content");
  });
  it("does not delegate unplanned or shared files", () => {
    expect(secondaryWorkRefusal({ ...work, path: "src/lib/data.ts" }, evidence())).toContain("frontier");
  });
});

let sequence = 0;
const call = (name: string, args: object): ToolCallMsg => ({ id: `c${sequence++}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...toolCalls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls, usage: { promptTokens: 100, cachedTokens: 80, completionTokens: 50, costUsd: 0.01 } });

async function exercise(fastReply: ModelReply, enable = true) {
  const selected: string[] = [];
  const seen: string[] = [];
  const predicted: string[] = [];
  const steps = [
    reply(call("create_file", { path: "src/components/Layout.tsx", content }), call("focus_secondary_page", work)),
    fastReply,
    reply(call("create_file", { path: work.path, content: "export default function About(){return <main>Our story</main>;}" }), call("finish", {})),
  ];
  const result = await runToolLoop({
    goal: "Build the full website", system: "Preserve design", brief: "Home and About", files: [],
    ...(enable ? { secondaryPages: pages } : {}),
    validate: (f) => f.content === "BROKEN" ? ["invalid source"] : [],
    readiness: (tree) => ({ ready: tree.some((f) => f.path === work.path && f.content !== "BROKEN"), findings: tree.some((f) => f.path === work.path && f.content !== "BROKEN") ? [] : [{ gate: "routes", reason: "missing About", paths: [work.path] }] }),
    predictCallUsd: (_, context) => { predicted.push(context?.secondary ? "fast" : "frontier"); return 0.01; },
    callModel: async (messages, tools, _, context) => {
      selected.push(context?.secondary ? "fast" : "frontier");
      seen.push(messages.map((m) => m.content).join("\n"));
      if (context?.secondary) expect(tools.map((t) => t.function.name)).not.toContain("delete_file");
      return { ...(steps.shift() ?? reply(call("finish", {}))), model: context?.secondary ? "fast" : "frontier" };
    },
  });
  return { result, selected, seen, predicted };
}

describe("single conversation integration", () => {
  it("uses frontier → fast → frontier, preserving cost and verification", async () => {
    const r = await exercise(reply(call("create_file", { path: work.path, content: "export default function About(){return <main>Our story</main>;}" })));
    expect(r.selected).toEqual(["frontier", "fast", "frontier"]);
    expect(r.predicted).toEqual(r.selected);
    expect(r.result.outcome).toBe("finished");
    expect(r.result.state.spentUsd).toBeCloseTo(0.03);
    expect(r.seen[2]).toContain("Review its implementation");
    expect(r.result.traces.map((t) => t.model)).toEqual(r.selected);
  });
  it("fast work cannot overwrite shared foundations or finish", async () => {
    const r = await exercise(reply(call("create_file", { path: "src/components/Layout.tsx", content: "REPLACED" }), call("finish", {})));
    expect(r.result.files.find((f) => f.path === "src/components/Layout.tsx")?.content).toBe(content);
    expect(r.selected).toEqual(["frontier", "fast", "frontier"]);
    expect(r.result.outcome).toBe("finished");
  });
  it("a failed fast write escalates with real error evidence", async () => {
    const r = await exercise(reply(call("create_file", { path: work.path, content: "BROKEN" })));
    expect(r.seen[2]).toContain("invalid source");
    expect(r.selected[2]).toBe("frontier");
    expect(r.result.outcome).toBe("finished");
  });
  it("a fast step without writes returns to frontier, never implicit completion", async () => {
    const r = await exercise(reply());
    expect(r.seen[2]).toContain("returned without writing");
    expect(r.result.outcome).toBe("finished");
  });
  it("ordinary edits retain their existing model path", async () => {
    const r = await exercise(reply(), false);
    expect(r.selected).not.toContain("fast");
  });
});