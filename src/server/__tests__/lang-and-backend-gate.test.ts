import assert from "node:assert";
import { detectLanguage } from "../lang-detect.server";
import { needsBackendCapability } from "../dynamic-prompts.server";

const brief = `Build a premium, modern, fully responsive landing page for a vacation-rental marketplace.
Nav: Stays, Experiences, Become a Host, Language selector, Help, Log in, prominent Sign up button.
Use realistic placeholder content and high-quality travel imagery. This should be visually impressive
enough for a portfolio or investor demo. Do not build a dashboard. Free coffee, see three sections and
each card should have a heart button.`;

const d = detectLanguage(brief);
console.log(d);
assert.equal(d.lang, "en", "English brief must detect as English");
assert.equal(needsBackendCapability(brief), false, "landing brief must not trigger backend gate");
assert.equal(
  needsBackendCapability(`Build a premium, modern, fully responsive landing page for a vacation-rental marketplace inspired by Airbnb.
Nav: Stays, Experiences, Become a Host, Language selector, Help, Log in, and a prominent Sign up button.
Do not create a generic SaaS landing page. Do not copy Airbnb branding, logo, exact colors, or exact layout.
Create an original, premium vacation-rental brand with its own visual identity.
Use realistic placeholder content and high-quality travel imagery. The final result should look like a polished product from a well-funded travel startup and should be visually impressive enough for a portfolio or investor demo.`),
  false,
  "the exact Stayora brief must build as a frontend without a backend gate",
);
assert.equal(needsBackendCapability("build a notes app where users sign in and we save their notes to a database"), true);
assert.equal(detectLanguage("Biko, mee ka ihe a dị mma nke ọma anyị").lang, "ig");
assert.equal(detectLanguage("abeg make we add login for the app").lang, "pidgin");
console.log("ok");
