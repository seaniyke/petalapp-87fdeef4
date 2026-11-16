import { describe, it, expect } from "vitest";
import { isRequiredPage, routesGate } from "@/server/verification/gates";

describe("route gate leniency", () => {
  it("home and requested pages are required, extra pages are not", () => {
    expect(isRequiredPage("/", [])).toBe(true);
    expect(isRequiredPage("/menu/", ["/menu"])).toBe(true);
    expect(isRequiredPage("/terms", ["/menu"])).toBe(false);
  });

  it("an unfinished extra page never fails the routes gate", () => {
    const app = `import { Routes, Route } from "react-router-dom";\nimport Home from "./pages/Home";\nimport Terms from "./pages/Terms";\nexport default function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/terms" element={<Terms/>}/></Routes>}`;
    const files = [
      { path: "src/App.tsx", content: app },
      { path: "src/pages/Home.tsx", content: "export default function Home(){return <main><h1>Mama Kay</h1><p>Fresh Lagos meals every day.</p></main>}" },
      { path: "src/pages/Terms.tsx", content: "export default function Terms(){return <div>Coming soon</div>}" },
    ];
    expect(routesGate(files as any, []).verdict).not.toBe("FAIL");
  });
});
