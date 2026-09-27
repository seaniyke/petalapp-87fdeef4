import { describe, it, expect } from "vitest";
import { frameIsComplete } from "../engine/write";

const f = (path: string, content: string) => ({ path, content });

describe("frameIsComplete — sidebar app frames", () => {
  it("accepts a routed app with nav in a sidebar and no footer", () => {
    const files = [
      f("src/App.tsx", `import Layout from "./components/Layout";\nexport default function App(){return <Routes><Route element={<Layout/>}><Route path="/" element={<div/>}/></Route></Routes>}`),
      f("src/components/Layout.tsx", `export default function Layout(){return <div><aside><nav>links</nav></aside><main><Outlet/></main></div>}`),
    ];
    expect(frameIsComplete(files as never, 6)).toBe(true);
  });
  it("still rejects a website frame with neither footer nor sidebar", () => {
    const files = [f("src/App.tsx", `export default function App(){return <div><header>x</header><Routes><Route path="/" element={<div/>}/></Routes></div>}`)];
    expect(frameIsComplete(files as never, 4)).toBe(false);
  });
});
