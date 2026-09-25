/**
 * The skill catalog. Keep every entry short — this is expertise, not an essay.
 * If a skill grows past roughly 40 lines it is doing two jobs; split it.
 */
import type { Skill } from "./types";

const redesignSafety: Skill = {
  id: "redesign-safety",
  title: "Changing an app that already works",
  hard: [],
  prefer: [],
  body: "",
  knowledge: "redesign-safety",
};

const pageComposition: Skill = {
  id: "page-composition",
  title: "Composing a page",
  hard: [],
  prefer: [],
  body: "",
  knowledge: "page-composition",
};

const typographyColor: Skill = {
  id: "typography-color",
  title: "Type and colour",
  hard: [],
  prefer: [],
  body: "",
  knowledge: "color-guide",
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
  hard: [],
  prefer: [],
  body: "",
  knowledge: "copy-and-verify",
};

const motion: Skill = {
  id: "motion",
  title: "Movement",
  hard: [],
  prefer: [],
  body: "",
  knowledge: "motion",
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

const sectionArchitectures: Skill = {
  id: "section-architectures",
  title: "Choosing section architectures",
  hard: [],
  prefer: [],
  body: "Pick the architecture from this guide, then build it only from components that really exist in the project or the kit — never invent a component because a pattern names one.",
  knowledge: "section-architectures",
};

export const SKILLS: Skill[] = [
  redesignSafety,
  pageComposition,
  sectionArchitectures,
  typographyColor,
  imagery,
  copyHonesty,
  motion,
  formsAndData,
  findability,
];
