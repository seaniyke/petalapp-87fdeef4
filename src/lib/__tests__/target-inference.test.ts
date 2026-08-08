/**
 * Intent Engine regression suite (audit item 5d).
 *
 * Covers all three classifiers together on realistic prompts:
 *   - resolveBuildTarget  → web / mobile / extension / backend / web-mobile
 *   - inferWebSubtype     → keyword-only web sub-type
 *   - resolveWebSubtype   → sub-type reconciled with the predicted app shape
 *
 * Run with: bun src/lib/__tests__/target-inference.test.ts
 */
import { strict as assert } from "node:assert";
import { resolveBuildTarget } from "../target-inference";
import { inferWebSubtype, resolveWebSubtype } from "../web-subtype";
import { classifyAppShape } from "../app-shape-classifier";

let checks = 0;
function eq<T>(actual: T, expected: T, label: string) {
  checks += 1;
  assert.equal(actual, expected, `${label}: expected ${String(expected)}, got ${String(actual)}`);
}

/* ------------------------- 1. Build target ------------------------- */

const TARGETS: Array<[string, string]> = [
  ["build me a chrome extension that saves tabs", "extension"],
  ["a browser extension to block distracting sites", "extension"],
  ["manifest v3 extension with a popup and options page", "extension"],
  ["a mobile banking app for students", "mobile"],
  ["an ios and android app for tracking workouts", "mobile"],
  ["react native app for a food delivery startup", "mobile"],
  ["headless REST api for inventory, no frontend", "backend"],
  ["just an API backend with webhooks, no UI", "backend"],
  ["web and mobile fitness tracker", "web-mobile"],
  ["a landing page for my coffee shop", "web"],
  ["a CRM dashboard for a real estate agency", "web"],
  ["an airbnb clone", "web"],
];
for (const [prompt, expected] of TARGETS) {
  eq(resolveBuildTarget(null, prompt).target, expected, `target(${prompt})`);
}

// An explicit header selection always beats inference.
eq(resolveBuildTarget("mobile", "a landing page").target, "mobile", "header wins");
eq(resolveBuildTarget("mobile", "a landing page").source, "header", "header source");
eq(resolveBuildTarget(null, "a landing page").source !== "header", true, "inference source");

/* ---------------------- 2. Keyword sub-type ------------------------ */

const SUBTYPES: Array<[string, "marketing" | "app" | "fullstack" | "tool"]> = [
  ["build a female pregnancy calculator", "tool"],
  ["a unit converter for cooking", "tool"],
  ["landing page for a fintech", "marketing"], // Defect B
  ["a waitlist page for my new AI product", "marketing"],
  ["portfolio site for a photographer", "marketing"],
  ["homepage for my design studio", "marketing"],
  ["a blog about climbing", "marketing"],
  ["an admin panel for managing orders", "app"],
  ["internal tool to track server incidents", "app"],
  ["a kanban task manager for my team", "app"],
  ["analytics platform for shopify sellers", "app"],
  ["a marketplace for freelance chefs", "fullstack"],
  ["build uber for dog walking", "fullstack"],
  ["a social network for runners", "fullstack"],
];
for (const [prompt, expected] of SUBTYPES) {
  eq(inferWebSubtype(prompt), expected, `subtype(${prompt})`);
}

/* ------------- 3. Reconciled sub-type (Defect C) ------------------- */

function resolved(prompt: string) {
  return resolveWebSubtype(prompt, classifyAppShape(prompt));
}

// Explicit marketing beats any predicted platform shape.
eq(resolved("landing page for a fintech startup").subtype, "marketing", "marketing wins over fintech shape");
eq(
  resolved("a simple waitlist page for a crypto wallet").subtype,
  "marketing",
  "waitlist stays marketing",
);

// Shape can promote a weak "app" guess to fullstack.
eq(
  resolved("an airbnb clone where hosts list homes, guests book and pay, with an admin console")
    .subtype,
  "fullstack",
  "airbnb clone reconciles to fullstack",
);
eq(
  resolved("an online store with login, checkout and an admin area to manage products").subtype,
  "fullstack",
  "ecommerce with auth+checkout is fullstack",
);

// Pure internal tools stay app-shaped.
eq(resolved("an admin panel for managing orders").subtype, "app", "admin panel stays app");
eq(resolved("internal tool to track server incidents").subtype, "app", "internal tool stays app");

// The reconciler always reports the raw keyword guess for debugging.
eq(
  resolved("landing page for a fintech startup").keywordSubtype,
  "marketing",
  "keyword guess exposed",
);
eq(typeof resolved("a marketplace for chefs").reason, "string", "reason is a string");

// Determinism: same prompt, same answer.
eq(
  resolved("a marketplace for freelance chefs").subtype,
  resolved("a marketplace for freelance chefs").subtype,
  "deterministic",
);

// Empty / junk input must not throw and must not claim high confidence.
eq(inferWebSubtype(""), "app", "empty prompt defaults to app");
eq(resolved("hi").subtype, "app", "junk prompt defaults to app");

console.log(`target-inference ok — ${checks} assertions passed`);
