import { strict as assert } from "node:assert";
import { shouldAutoPlan } from "../plan-mode";

const base = { fileCount: 20, isInitial: false as const };

// First builds and auto-fix turns never plan.
assert.equal(shouldAutoPlan({ ...base, prompt: "give me a plan", isInitial: true }), false);
assert.equal(shouldAutoPlan({ ...base, prompt: "give me a plan", isAutoFix: true }), false);

// Class A — clear instructions execute, however long or multi-file.
for (const prompt of [
  "make the header blue",
  "add a checkout flow with payments",
  "build an admin dashboard page",
  "Add a pricing page with three tiers and a checkout flow",
  "- swap the hero copy\n- darken the footer\n- add a testimonial row",
  "x".repeat(400),
]) {
  assert.equal(shouldAutoPlan({ ...base, prompt }), false, prompt);
}

// Class B — explicit plan requests plan.
assert.equal(shouldAutoPlan({ ...base, prompt: "Give me a plan for adding billing" }), true);
assert.equal(shouldAutoPlan({ ...base, prompt: "Plan the architecture before coding" }), true);

console.log("auto-plan: all assertions passed");
