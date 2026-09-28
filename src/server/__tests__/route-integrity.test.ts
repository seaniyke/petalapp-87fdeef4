import { describe, it, expect } from "vitest";
import { resolveRouteTree, deadInternalLinks, unguardedAppRoutes, linkResolves } from "@/server/engine/route-paths";
import { routesGate } from "@/server/verification/gates";
import { sharedBackendKit } from "@/server/shared-backend-kit";

const salonApp = (guarded: boolean) => `import { Routes, Route } from "@/components/ui/router";
import { AuthProvider${guarded ? ", RequireAuth" : ""} } from "@/integrations/backend/auth";
import { PublicLayout } from "@/components/layouts/public-layout";
import { AppShell } from "@/components/layouts/app-shell";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Services from "@/pages/Services";
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
        </Route>
        <Route path="dashboard" element={${guarded ? "<RequireAuth><AppShell /></RequireAuth>" : "<AppShell />"}}>
          <Route index element={<Dashboard />} />
          <Route path="services" element={<Services />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}`;

const shell = (prefix: string) =>
  `import { Outlet, NavLink } from "@/components/ui/router";
const navItems = [{ to: "${prefix}/services", label: "Services" }];
export function AppShell() { return <aside><NavLink to="/dashboard">Home</NavLink>{navItems.map(i => <NavLink key={i.to} to={i.to}>{i.label}</NavLink>)}<Outlet /></aside>; }`;

const files = (guarded: boolean, prefix: string) => [
  { path: "src/App.tsx", content: salonApp(guarded) },
  { path: "src/components/layouts/app-shell.tsx", content: shell(prefix) },
];

describe("route addresses", () => {
  it("resolves nested routes to full addresses", () => {
    const paths = resolveRouteTree(salonApp(true)).map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining(["/", "/login", "/dashboard", "/dashboard/services", "/*"]));
    expect(paths).not.toContain("/services");
  });
  it("a catch-all never makes a link real; params match", () => {
    const r = resolveRouteTree(salonApp(true));
    expect(linkResolves("/services", r)).toBe(false);
    expect(linkResolves("/dashboard/services", r)).toBe(true);
    expect(linkResolves("/orders/42", [{ path: "/orders/:id", chain: [], catchAll: false }])).toBe(true);
  });
  it("finds the salon's dead /services link in the app frame", () => {
    const dead = deadInternalLinks(files(true, ""), salonApp(true));
    expect(dead).toEqual([{ file: "src/components/layouts/app-shell.tsx", link: "/services" }]);
    expect(deadInternalLinks(files(true, "/dashboard"), salonApp(true))).toEqual([]);
  });
});

describe("signed-in area guard", () => {
  it("flags an unguarded /dashboard and accepts RequireAuth on the layout", () => {
    expect(unguardedAppRoutes(salonApp(false), [])).toEqual(["/dashboard", "/dashboard/services"]);
    expect(unguardedAppRoutes(salonApp(true), [])).toEqual([]);
  });
  it("accepts a layout component that renders RequireAuth itself", () => {
    const f = [{ path: "src/components/layouts/app-shell.tsx", content: "export function AppShell() { return <RequireAuth><Outlet /></RequireAuth>; }" }];
    expect(unguardedAppRoutes(salonApp(false), f)).toEqual([]);
  });
  it("kit ships RequireAuth redirecting to /login", () => {
    const auth = sharedBackendKit({ baseUrl: "https://kimble.cloud", projectId: "p", projectKey: "k" } as never).find((f) => f.path.endsWith("auth.tsx"))!.content;
    expect(auth).toMatch(/export function RequireAuth/);
    expect(auth).toMatch(/<Navigate to="\/login"/);
  });
});

describe("routes gate", () => {
  it("first builds fail on dead links and unguarded app pages; edits only warn on links", () => {
    const first = routesGate(files(false, ""), [], { requireShell: true, requireLiveData: true });
    expect(first.verdict).toBe("FAIL");
    expect(first.reasons.join(" ")).toMatch(/links to \/services/);
    expect(first.reasons.join(" ")).toMatch(/RequireAuth/);
    const edit = routesGate(files(true, ""), [], {});
    expect(edit.reasons.join(" ")).not.toMatch(/links to/);
    expect(routesGate(files(true, "/dashboard"), [], { requireShell: true, requireLiveData: true }).reasons.join(" ")).not.toMatch(/links to|RequireAuth/);
  });
});
