/**
 * The skill catalog. Keep every entry short — this is expertise, not an essay.
 * If a skill grows past roughly 40 lines it is doing two jobs; split it.
 */
import type { Skill } from "./types";

const redesignSafety: Skill = {
  id: "redesign-safety",
  title: "Changing an app that already works",
  hard: [
    "Change only what the request asks for. A page the user did not mention is off limits.",
    "Never delete a section, route, feature or piece of content that was not part of the ask.",
    "Keep every working link, handler, form submit and data call wired exactly as it was.",
    "Never swap real content for placeholder text, lorem ipsum or sample data.",
    "Never remove a brand name, logo or real copy to make a layout easier.",
  ],
  prefer: [
    "Make the smallest edit that fully satisfies the ask, then stop.",
    "When a change could be made in one file or spread across three, use one.",
    "Reuse the component that already exists rather than adding a near-duplicate.",
  ],
  body: [
    "Before editing, name the page and the element the request is about. If the request",
    "does not identify one, pick the single most likely target and say which one you chose —",
    "do not edit several candidates to cover yourself.",
    "",
    "After editing, re-read your own diff and ask: did anything change that the user did not",
    "ask for? If yes, revert that part.",
  ].join("\n"),
};

const pageComposition: Skill = {
  id: "page-composition",
  title: "Composing a page",
  hard: [
    "Every page starts with one clear purpose and one primary action.",
    "No page ships as a single wall of identical cards or repeated identical sections.",
    "Every section earns its place: it either informs the decision or moves the user forward.",
  ],
  prefer: [
    "Vary section rhythm: dense next to open, wide next to contained, text next to image.",
    "Lead with the strongest idea; never open with a generic welcome line.",
    "Three to seven sections on a marketing page; more than that is usually padding.",
  ],
  body: [
    "Order that works for most landing pages: navigation, a hero that says what this is and",
    "for whom, proof, what it does, how it works, a look at the real thing, voices of users,",
    "price, questions, a last invitation, footer.",
    "",
    "For an app screen: what am I looking at, what can I do, what needs my attention, then the",
    "detail. Empty states are designed, not left blank.",
  ].join("\n"),
};

const typographyColor: Skill = {
  id: "typography-color",
  title: "Type and colour",
  hard: [
    "Use the project's design tokens. Never hardcode a raw colour in a component.",
    "Body text must stay readable against its background in both light and dark.",
    "Two typefaces at most, unless the brand already commits to a third.",
  ],
  prefer: [
    "Set a real type scale and stick to it; do not invent a new size per section.",
    "One accent colour does the persuading; everything else is neutral.",
    "Long-form text sits between 60 and 80 characters per line.",
  ],
  body: [
    "Weight and size carry hierarchy before colour does. If a heading only stands out because",
    "it is coloured, the hierarchy is not doing its job.",
  ].join("\n"),
};

const imagery: Skill = {
  id: "imagery",
  title: "Pictures and icons",
  hard: [
    "Every picture must actually render. Never ship a link that may 404.",
    "Never claim a photograph is of the real product, team or customers when it is not.",
    "A picture that implies a fact the app does not have must not be used.",
  ],
  prefer: [
    "Use the user's own uploaded pictures first, then the library, then generate.",
    "Prefer one strong image over a grid of weak ones.",
    "Icons come from the agreed set and stay one visual weight.",
  ],
  body: [
    "Decorative imagery should support the section's message, not fill a gap. If an image",
    "cannot be described in one sentence that relates to the copy beside it, drop it.",
  ].join("\n"),
};

const copyHonesty: Skill = {
  id: "copy-honesty",
  title: "Writing the words",
  hard: [
    "Never invent facts: no made-up customers, numbers, awards, prices, addresses or hours.",
    "If a real detail is missing, write a clearly generic line rather than a fake specific one.",
    "Buttons say what happens next, in the user's language.",
  ],
  prefer: [
    "Short sentences. Concrete nouns. No 'revolutionise', 'seamless', 'unlock', 'elevate'.",
    "Headlines state the benefit plainly; the subhead adds the how.",
    "Error text says what went wrong and what to do next.",
  ],
  body: "Read every line back as if you were the customer. If it could sit on any other product's page, rewrite it.",
};

const motion: Skill = {
  id: "motion",
  title: "Movement",
  hard: [
    "Motion never blocks reading or delays an action.",
    "Respect reduced-motion preferences.",
    "Nothing loops forever in the corner of the eye.",
  ],
  prefer: [
    "Short and quiet: 150–300ms, ease-out, small distances.",
    "Animate entrances once, on first view, not on every scroll pass.",
  ],
  body: "Movement exists to explain a change — something arrived, something is loading, something responded. If it explains nothing, remove it.",
};

const formsAndData: Skill = {
  id: "forms-and-data",
  title: "Forms and saved data",
  hard: [
    "Every form shows a pending state, a success result and a real error message.",
    "Never lose what the user typed on a failure.",
    "Anything saved is scoped to the person who owns it.",
  ],
  prefer: [
    "Validate on submit, not on every keystroke.",
    "Ask for the fewest fields that make the feature work.",
    "Confirm destructive actions; make everything else instant.",
  ],
  body: "After a save, the screen should reflect the new truth without a manual refresh.",
};

const findability: Skill = {
  id: "findability",
  title: "Being found and shared",
  hard: [
    "Every page has its own title and description that describe that page.",
    "One H1 per page, matching what the page is about.",
  ],
  prefer: [
    "Write the title for a person scanning a list of tabs, not for a search engine.",
    "Give a shared link a preview image when the page has a real one.",
  ],
  body: "",
};

export const SKILLS: Skill[] = [
  redesignSafety,
  pageComposition,
  typographyColor,
  imagery,
  copyHonesty,
  motion,
  formsAndData,
  findability,
];
