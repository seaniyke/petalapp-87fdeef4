import test from "node:test";
import assert from "node:assert/strict";
import { collectRoutes, makeTestIdentity } from "../verify-plan.server";

test("verify plan route collection", () => {
  const routes = collectRoutes([
    {
      path: "src/App.tsx",
      content: `
        <Routes>
          <Route path="/" element={<Home/>} />
          <Route path="/pricing" element={<Pricing/>} />
          <Route path="/blog/:slug" element={<Post/>} />
          <Route path="*" element={<NotFound/>} />
        </Routes>`,
    },
    { path: "src/routes/dash.tsx", content: `createFileRoute("/dashboard")({})` },
    { path: "README.md", content: `<Route path="/never" />` },
  ] as never);

  assert.equal(routes[0], "/", "home is visited first");
  assert.ok(routes.includes("/pricing"));
  assert.ok(routes.includes("/dashboard"));
  // Params, wildcards and non-source files never become visitable routes.
  assert.ok(!routes.some((r) => r.includes(":") || r.includes("*") || r === "/never"));
});

test("verify plan test identity is tagged and unique", () => {
  const a = makeTestIdentity("11111111-2222-3333-4444-555555555555");
  const b = makeTestIdentity("11111111-2222-3333-4444-555555555555");
  assert.ok(a.email.startsWith("petal-verify+"));
  assert.notEqual(a.email, b.email);
  assert.ok(a.password.length >= 12);
});
