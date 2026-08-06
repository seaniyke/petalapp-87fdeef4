import { strict as assert } from "node:assert";
import { resolveBuildTarget } from "../target-inference";
import { inferWebSubtype } from "../web-subtype";

// Plain-language product types must reach the right scaffold without the
// (now removed) composer chip rail.
assert.equal(resolveBuildTarget(null, "build me a chrome extension that saves tabs").target, "extension");
assert.equal(resolveBuildTarget(null, "a mobile banking app for students").target, "mobile");
assert.equal(resolveBuildTarget(null, "headless REST api for inventory, no frontend").target, "backend");
assert.equal(resolveBuildTarget(null, "web and mobile fitness tracker").target, "web-mobile");
assert.equal(resolveBuildTarget(null, "a landing page for my coffee shop").target, "web");

// An explicit non-web selection always beats inference.
assert.equal(resolveBuildTarget("mobile", "a landing page").target, "mobile");
assert.equal(resolveBuildTarget("mobile", "a landing page").source, "header");

// Defect B: marketing must not be swallowed by the fullstack short-circuit.
assert.equal(inferWebSubtype("landing page for a fintech"), "marketing");

console.log("target-inference ok");
