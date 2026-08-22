import { describe, expect, it } from "vitest";
import { repairUnresolvedImports } from "../import-resolver.server";

const APP = `
import Home from "@/pages/Home";
import { NavBar } from "@/components/nav-bar";
export default function App() {
  return (<><NavBar /><Home /></>);
}
`;

const HERO = `export function HeroSection() { return <section>hero</section>; }`;
const PROOF = `export function SocialProofSection() { return <section>proof</section>; }`;
const NAV = `export function NavBar() { return <nav>nav</nav>; }`;

describe("import-resolver page composition", () => {
  it("composes a missing page from orphan sections instead of a placeholder", () => {
    const out = repairUnresolvedImports([
      { path: "src/App.tsx", content: APP },
      { path: "src/components/hero-section.tsx", content: HERO },
      { path: "src/components/social-proof-section.tsx", content: PROOF },
      { path: "src/components/nav-bar.tsx", content: NAV },
    ]);
    const home = out.files.find((f) => f.path === "src/pages/Home.tsx");
    expect(home).toBeTruthy();
    expect(home!.content).not.toContain("being assembled");
    expect(home!.content).toContain("<HeroSection />");
    expect(home!.content).toContain("<SocialProofSection />");
    // Chrome stays in App, never duplicated into the page body.
    expect(home!.content).not.toContain("<NavBar />");
    // Hero renders before social proof.
    expect(home!.content.indexOf("<HeroSection />")).toBeLessThan(
      home!.content.indexOf("<SocialProofSection />"),
    );
  });

  it("heals an existing placeholder page once real sections exist", () => {
    const placeholder = `// Auto-generated stub by Petal import-resolver. The original import target
// did not exist; this lets the build succeed and renders a visible marker.
function Home() { return <section>This section is being assembled.</section>; }
export default Home;
`;
    const out = repairUnresolvedImports([
      { path: "src/App.tsx", content: APP },
      { path: "src/pages/Home.tsx", content: placeholder },
      { path: "src/components/hero-section.tsx", content: HERO },
      { path: "src/components/social-proof-section.tsx", content: PROOF },
      { path: "src/components/nav-bar.tsx", content: NAV },
    ]);
    const home = out.files.find((f) => f.path === "src/pages/Home.tsx")!;
    expect(home.content).toContain("<HeroSection />");
    expect(home.content).not.toContain("being assembled");
  });

  it("still stubs a missing non-page module", () => {
    const out = repairUnresolvedImports([
      {
        path: "src/components/hero-section.tsx",
        content: `import { Badge } from "@/components/badge-thing";\nexport function HeroSection() { return <Badge />; }`,
      },
    ]);
    const stub = out.files.find((f) => f.path === "src/components/badge-thing.tsx");
    expect(stub).toBeTruthy();
    expect(stub!.content).toContain("Auto-generated stub");
  });
});
