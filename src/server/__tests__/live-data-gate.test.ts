import { describe, it, expect } from "vitest";
import { sampleOnlyPages, routesGate } from "@/server/verification/gates";

const app = `import { Routes, Route } from "react-router-dom";
import Orders from "./pages/Orders";
import Home from "./pages/Home";
export default function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/dashboard/orders" element={<Orders/>}/></Routes>}`;
const mock = { path: "src/lib/mock-data.ts", content: "export const orders = [];" };
const client = { path: "src/integrations/backend/client.ts", content: "export const db = {};" };
const home = { path: "src/pages/Home.tsx", content: "export default function Home(){return <div/>}" };

describe("live data gate (Kimble Cloud on)", () => {
  it("flags a data page that only reads the sample module", () => {
    const files = [{ path: "src/App.tsx", content: app }, mock, client, home,
      { path: "src/pages/Orders.tsx", content: `import { orders } from "@/lib/mock-data";\nexport default function O(){return <div>{orders.length}</div>}` }];
    expect(sampleOnlyPages(files)).toEqual(["src/pages/Orders.tsx"]);
    const g = routesGate(files, [], { requireLiveData: true });
    expect(g.verdict).toBe("FAIL");
    expect(routesGate(files, [], {}).reasons.join(" ")).not.toMatch(/sample data/);
  });
  it("passes a page that uses the backend directly or through its own hook", () => {
    const hook = { path: "src/lib/use-orders.ts", content: `import { db } from "@/integrations/backend/client";\nexport const useOrders=()=>db;` };
    const files = [{ path: "src/App.tsx", content: app }, mock, client, home, hook,
      { path: "src/pages/Orders.tsx", content: `import { orders } from "../lib/mock-data";\nimport { useOrders } from "@/lib/use-orders";\nexport default function O(){useOrders();return <div>{orders.length}</div>}` }];
    expect(sampleOnlyPages(files)).toEqual([]);
  });
  it("ignores pages with no sample data at all", () => {
    const files = [{ path: "src/App.tsx", content: app }, client, home,
      { path: "src/pages/Orders.tsx", content: "export default function O(){return <div/>}" }];
    expect(sampleOnlyPages(files)).toEqual([]);
  });
});
