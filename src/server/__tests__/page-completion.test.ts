import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_MARKER,
  findRoutedPlaceholders,
  isPlaceholderPage,
} from "../design/page-completion.server";

const stub = (name: string) =>
  `// ${PLACEHOLDER_MARKER}. The original import target\n// did not exist.\nfunction Stub() { return <section>Coming together</section>; }\nexport default Stub;\nexport const ${name} = Stub;\n`;

describe("placeholder page detection", () => {
  it("recognises an import-resolver stub page", () => {
    expect(isPlaceholderPage({ path: "src/routes/dashboard.tsx", content: stub("Dashboard") })).toBe(
      true,
    );
  });

  it("does not treat a real page as a placeholder", () => {
    expect(
      isPlaceholderPage({
        path: "src/routes/dashboard.tsx",
        content: "export default function Dashboard() { return <div>real</div>; }",
      }),
    ).toBe(false);
  });

  it("ignores non-page files", () => {
    expect(isPlaceholderPage({ path: "src/lib/thing.ts", content: PLACEHOLDER_MARKER })).toBe(false);
  });

  it("finds only placeholders the app actually routes to", () => {
    const files = [
      {
        path: "src/App.tsx",
        content:
          'import { Dashboard } from "./routes/dashboard";\nexport default function App() { return <Dashboard />; }',
      },
      { path: "src/routes/dashboard.tsx", content: stub("Dashboard") },
      { path: "src/routes/orphan.tsx", content: stub("Orphan") },
    ];
    expect(findRoutedPlaceholders(files)).toEqual(["src/routes/dashboard.tsx"]);
  });

  it("returns nothing when every page is real", () => {
    const files = [
      { path: "src/App.tsx", content: 'import D from "./routes/dashboard";' },
      { path: "src/routes/dashboard.tsx", content: "export default function D(){return <i/>;}" },
    ];
    expect(findRoutedPlaceholders(files)).toEqual([]);
  });

  it("matches alias-form imports", () => {
    const files = [
      { path: "src/App.tsx", content: 'import S from "@/routes/settings";' },
      { path: "src/routes/settings.tsx", content: stub("Settings") },
    ];
    expect(findRoutedPlaceholders(files)).toEqual(["src/routes/settings.tsx"]);
  });
});
