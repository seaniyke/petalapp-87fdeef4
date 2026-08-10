import { strict as assert } from "node:assert";
import { shouldAutoPlan } from "../plan-mode";

const base = { fileCount: 20, isInitial: false as const };

// 1. First builds and auto-fix turns never plan.
assert.equal(shouldAutoPlan({ ...base, prompt: "add a pricing page", isInitial: true }), false);
assert.equal(shouldAutoPlan({ ...base, prompt: "add a pricing page", isAutoFix: true }), false);

// 2. Tiny projects have no scope worth reviewing.
assert.equal(shouldAutoPlan({ ...base, fileCount: 2, prompt: "add a pricing page" }), false);

// 3. Trivial tweaks stay instant.
assert.equal(shouldAutoPlan({ ...base, prompt: "make the header blue" }), false);
assert.equal(shouldAutoPlan({ ...base, prompt: "fix the typo in the footer" }), false);
assert.equal(shouldAutoPlan({ ...base, prompt: "change the button text to Start" }), false);
assert.equal(shouldAutoPlan({ ...base, prompt: "fix the blank page when I add a habit" }), false);

// 4. Structural work plans.
assert.equal(shouldAutoPlan({ ...base, prompt: "add a checkout flow with payments" }), true);
assert.equal(shouldAutoPlan({ ...base, prompt: "build an admin dashboard page" }), true);
assert.equal(shouldAutoPlan({ ...base, prompt: "set up auth with email login" }), true);

// 5. Multi-part requests plan.
assert.equal(
  shouldAutoPlan({
    ...base,
    prompt: "- swap the hero copy\n- darken the footer\n- add a testimonial row",
  }),
  true,
);

// 6. Long-form prose plans.
assert.equal(shouldAutoPlan({ ...base, prompt: "x".repeat(400) }), true);

// 7. An explicit "just do it" beats the heuristic.
assert.equal(
  shouldAutoPlan({ ...base, prompt: "just do it — add a checkout flow with payments" }),
  false,
);

console.log("auto-plan: all assertions passed");
