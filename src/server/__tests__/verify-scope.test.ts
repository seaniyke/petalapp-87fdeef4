import { describe, expect, it } from "vitest";
import { computeVerifyScope } from "@/server/verify-scope.server";

const files = [
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "@/components/Hero";
export const Route = createFileRoute("/")({ component: () => <Hero /> });`,
  },
  {
    path: "src/routes/pricing.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/pricing")({ component: () => <div /> });`,
  },
  { path: "src/components/Hero.tsx", content: `export function Hero() { return <h1>hi</h1>; }` },
  { path: "src/styles.css", content: ":root{}" },
  { path: "README.md", content: "# docs" },
];
const knownRoutes = ["/", "/pricing"];

describe("change-aware verification scope", () => {
  it("verifies everything on a first build", () => {
    const s = computeVerifyScope({ files, changedPaths: ["src/routes/index.tsx"], knownRoutes, forceFull: true });
    expect(s.tier).toBe("full");
  });

  it("verifies everything when the change list is unknown", () => {
    expect(computeVerifyScope({ files, changedPaths: [], knownRoutes }).tier).toBe("full");
  });

  it("verifies everything when the design system changes", () => {
    const s = computeVerifyScope({ files, changedPaths: ["src/styles.css"], knownRoutes });
    expect(s.tier).toBe("full");
  });

  it("scopes to the route a single page change touches", () => {
    const s = computeVerifyScope({ files, changedPaths: ["src/routes/pricing.tsx"], knownRoutes });
    expect(s.tier).toBe("routes");
    // Home rides along because routing itself may have shifted.
    expect(s.routes.sort()).toEqual(["/", "/pricing"]);
    expect(s.widths).toEqual([390, 820, 1440]);
  });

  it("follows a component up to the routes that render it", () => {
    const s = computeVerifyScope({ files, changedPaths: ["src/components/Hero.tsx"], knownRoutes });
    expect(s.tier).toBe("routes");
    expect(s.routes).toEqual(["/"]);
  });

  it("still loads home when nothing rendered changed", () => {
    const s = computeVerifyScope({ files, changedPaths: ["README.md"], knownRoutes });
    expect(s.tier).toBe("minimal");
    expect(s.routes).toEqual(["/"]);
    expect(s.skipFlows).toBe(true);
  });

  it("falls back to a full sweep on a large change", () => {
    const s = computeVerifyScope({
      files,
      changedPaths: Array.from({ length: 13 }, (_, i) => `src/components/C${i}.tsx`),
      knownRoutes,
    });
    expect(s.tier).toBe("full");
  });
});
