/**
 * Targeted-edit resolver checks. Run with:
 *   bun run src/server/__tests__/edit-intent.test.ts
 */
import { resolveEditIntent, detectEditVerb } from "../edit-intent.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures++;
    console.log(`  \u2717 ${name}`);
  }
}

const files = [
  {
    path: "src/components/Hero.tsx",
    content: `export function Hero() {
  return (
    <section className="py-24">
      <h1 className="text-5xl font-bold">Build your salon brand</h1>
      <a href="/pricing" className="btn">Get Started</a>
    </section>
  );
}`,
  },
  {
    path: "src/components/PricingSection.tsx",
    content: `export function PricingSection() {
  return <div className="grid"><span>Get Started</span></div>;
}`,
  },
  {
    path: "src/components/Footer.tsx",
    content: `export function Footer() { return <footer>© 2026</footer>; }`,
  },
  {
    path: "src/components/ui/button.tsx",
    content: `export const Button = () => null; // kit file — never a target`,
  },
];

console.log("edit-intent:");

// 1. Quoted copy resolves to the files that literally contain it.
const quoted = resolveEditIntent(`change "Get Started" to "Try it free"`, files);
check("quoted copy resolves targets", quoted.isTargetedEdit);
check(
  "both files containing the phrase are pinned",
  quoted.pinnedPaths.includes("src/components/Hero.tsx") &&
    quoted.pinnedPaths.includes("src/components/PricingSection.tsx"),
);
check("kit files are never targets", !quoted.pinnedPaths.includes("src/components/ui/button.tsx"));
check("anchor line number is reported", quoted.targets[0].anchors[0].line > 0);
check("briefing names the file", quoted.briefing.includes("src/components/Hero.tsx"));

// 2. Section vocabulary resolves by path.
const section = resolveEditIntent("make the footer smaller", files);
check("footer ask targets Footer.tsx", section.pinnedPaths[0] === "src/components/Footer.tsx");

// 3. Verb classification.
check("remove verb", detectEditVerb("remove the second pricing card") === "remove");
check("add verb", detectEditVerb("add a testimonials section") === "add");
check("rename verb", detectEditVerb('rename "Home" to "Start"') === "rename");
check("move verb", detectEditVerb("move the FAQ above the footer") === "move");
check("wire verb", detectEditVerb("hook up the contact form to the database") === "wire");

// 4. No false positives on a plain question.
const vague = resolveEditIntent("what can you do?", files);
check("vague message resolves nothing", !vague.isTargetedEdit);

// 5. Explicit file mention wins.
const byPath = resolveEditIntent("update Footer.tsx to include social links", files);
check("explicit filename wins", byPath.pinnedPaths[0] === "src/components/Footer.tsx");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nedit-intent: all assertions passed");
