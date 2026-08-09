import { describe, expect, it } from "vitest";
import {
  closeKitDependencies,
  syncTsconfigExcludes,
  ON_DEMAND_KIT_PATHS,
} from "@/server/kit-dep-closure.server";
import type { ProjectFile } from "@/server/generate.server";

function pkg(deps: Record<string, string> = {}): ProjectFile {
  return { path: "package.json", content: JSON.stringify({ dependencies: deps }, null, 2) };
}

describe("closeKitDependencies", () => {
  it("installs deps for kit modules reachable from the entry", () => {
    const files: ProjectFile[] = [
      pkg({ react: "^18.3.1" }),
      { path: "src/main.tsx", content: `import App from "./App";` },
      { path: "src/App.tsx", content: `import { FadeIn } from "@/components/motion";` },
      { path: "src/components/motion/index.ts", content: `export { FadeIn } from "./fade-in";` },
      { path: "src/components/motion/fade-in.tsx", content: `import { motion } from "framer-motion";` },
    ];
    const res = closeKitDependencies(files);
    expect(res.added["framer-motion"]).toBeTruthy();
    const next = JSON.parse(res.files.find((f) => f.path === "package.json")!.content);
    expect(next.dependencies["framer-motion"]).toBeTruthy();
  });

  it("does not install deps for unreachable kit files", () => {
    const files: ProjectFile[] = [
      pkg({ react: "^18.3.1" }),
      { path: "src/main.tsx", content: `import App from "./App";` },
      { path: "src/App.tsx", content: `export default function App() { return null; }` },
      { path: "src/components/three/scene.tsx", content: `import { Canvas } from "@react-three/fiber";` },
    ];
    const res = closeKitDependencies(files);
    expect(res.added).toEqual({});
    expect(res.files).toBe(files);
  });

  it("is idempotent and leaves unknown packages alone", () => {
    const files: ProjectFile[] = [
      pkg({ react: "^18.3.1" }),
      { path: "src/main.tsx", content: `import "totally-unknown-pkg";` },
    ];
    const once = closeKitDependencies(files);
    expect(once.added).toEqual({});
    const twice = closeKitDependencies(once.files);
    expect(twice.added).toEqual({});
  });
});

describe("syncTsconfigExcludes", () => {
  const tsconfig = (exclude: string[]): ProjectFile => ({
    path: "tsconfig.json",
    content: JSON.stringify({ include: ["src"], exclude }, null, 2),
  });

  it("stops excluding kit areas the app imports", () => {
    const files: ProjectFile[] = [
      tsconfig([...ON_DEMAND_KIT_PATHS]),
      { path: "src/components/motion/fade-in.tsx", content: "" },
    ];
    const res = syncTsconfigExcludes(files, new Set(["src/components/motion/fade-in.tsx"]));
    const next = JSON.parse(res.files.find((f) => f.path === "tsconfig.json")!.content);
    expect(next.exclude).not.toContain("src/components/motion");
    expect(next.exclude).toContain("src/components/three");
  });

  it("keeps project-specific excludes and is a no-op when nothing changes", () => {
    const files: ProjectFile[] = [tsconfig(["dist", ...ON_DEMAND_KIT_PATHS])];
    const res = syncTsconfigExcludes(files, new Set(["src/App.tsx"]));
    expect(res.files).toBe(files);
    const parsed = JSON.parse(files[0]!.content);
    expect(parsed.exclude[0]).toBe("dist");
  });
});
