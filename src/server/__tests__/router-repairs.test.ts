import { strict as assert } from "node:assert";
import { fixTanstackRouterWithoutProvider } from "../tanstack-router-fallback.server";
import { fixMissingRouterProvider } from "../router-provider.server";
import { repairUnresolvedImports } from "../import-resolver.server";

const broken = [
  {
    path: "src/main.tsx",
    content:
      'import ReactDOM from "react-dom/client";\nimport App from "./App";\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
  },
  {
    path: "src/App.tsx",
    content:
      'import { Link, Outlet } from "@tanstack/react-router";\nexport default function App(){ return <><Link to="/">Home</Link><Outlet /></>; }',
  },
  {
    path: "src/hooks/use-axe.tsx",
    content: 'const example = "<RouterProvider router={router} />"; export { example };',
  },
];

const fallback = fixTanstackRouterWithoutProvider(broken);
assert.match(
  fallback.files.find((f) => f.path === "src/App.tsx")?.content ?? "",
  /@\/lib\/router-compat/,
  "consumer-only TanStack imports must be redirected to the compatibility shim",
);

const provider = fixMissingRouterProvider(fallback.files);
const main = provider.files.find((f) => f.path === "src/main.tsx")?.content ?? "";
assert.match(main, /import \{ BrowserRouter \} from "react-router-dom";/);
assert.match(main, /<BrowserRouter>/);
assert.equal(provider.notes.length, 1, "a string example must not count as a mounted provider");

const realTanstack = [
  {
    path: "src/router.tsx",
    content:
      'import { createRouter } from "@tanstack/react-router";\nexport const router = createRouter({ routeTree });',
  },
  {
    path: "src/main.tsx",
    content:
      'import { RouterProvider } from "@tanstack/react-router";\nimport { router } from "./router";\nroot.render(<RouterProvider router={router} />);',
  },
];
assert.equal(
  fixTanstackRouterWithoutProvider(realTanstack).notes.length,
  0,
  "a real cross-file TanStack router setup must remain untouched",
);

const missingBootstrap = [
  {
    path: "src/main.tsx",
    content:
      'import ReactDOM from "react-dom/client";\nimport App from "./App";\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
  },
  {
    path: "src/routes/index.tsx",
    content:
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });',
  },
  {
    path: "src/routeTree.gen.tsx",
    content:
      "const IndexRoute = IndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => rootRouteImport });\nexport const routeTree = rootRouteImport.addChildren([IndexRoute]);",
  },
];
const restored = fixTanstackRouterWithoutProvider(missingBootstrap);
assert.match(
  restored.files.find((f) => f.path === "src/main.tsx")?.content ?? "",
  /<RouterProvider router=\{router\} \/>/,
);
assert.match(
  restored.files.find((f) => f.path === "src/router.tsx")?.content ?? "",
  /createRouter\(\{ routeTree \}\)/,
);
assert.equal(
  restored.files.some((f) => f.path === "src/lib/router-compat.tsx"),
  false,
  "file-based TanStack apps must restore their real router instead of using the compatibility shim",
);

const invalidHandWrittenTree = [
  {
    path: "src/App.tsx",
    content: "export default function App(){ return <div />; }",
  },
  {
    path: "src/main.tsx",
    content:
      'import { RouterProvider } from "@tanstack/react-router";\nimport { router } from "./router";\nroot.render(<RouterProvider router={router} />);',
  },
  {
    path: "src/router.tsx",
    content:
      'import { createRouter } from "@tanstack/react-router";\nimport { routeTree } from "./routeTree.gen";\nexport const router = createRouter({ routeTree });',
  },
  {
    path: "src/routeTree.gen.tsx",
    content:
      'import { Route as RootRoute } from "./routes/__root";\nimport { Route as IndexRoute } from "./routes/index";\nexport const routeTree = RootRoute.addChildren([IndexRoute]);',
  },
  {
    path: "src/routes/__root.tsx",
    content:
      'import { createRootRoute, Outlet } from "@tanstack/react-router";\nexport const Route = createRootRoute({ component: Outlet });',
  },
  {
    path: "src/routes/index.tsx",
    content:
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });',
  },
];
const invalidTreeFallback = fixTanstackRouterWithoutProvider(invalidHandWrittenTree);
assert.match(
  invalidTreeFallback.notes.join("\n"),
  /removed a router bootstrap that pointed at a missing route tree/,
  "a hand-written tree without parent-route wiring must be dismantled before it crashes",
);
assert.equal(
  invalidTreeFallback.files.some((f) => f.path === "src/router.tsx"),
  false,
  "the invalid TanStack bootstrap must be removed",
);
assert.match(
  invalidTreeFallback.files.find((f) => f.path === "src/generated-routes.tsx")?.content ?? "",
  /<BrowserRouter>/,
  "the generated fallback route table must provide react-router context itself",
);

const rerunInvalidTreeFallback = fixTanstackRouterWithoutProvider(
  invalidTreeFallback.files
    .filter((f) => f.path !== "src/generated-routes.tsx" && f.path !== "src/lib/router-compat.tsx")
    .concat({
      path: "src/lib/router-compat.tsx",
      content: "export default function Stub(){ return null; }",
    }),
);
assert.match(
  rerunInvalidTreeFallback.files.find((f) => f.path === "src/generated-routes.tsx")?.content ?? "",
  /export function GeneratedRoutes/,
  "a later repair run must recreate the route table instead of leaving an import-resolver stub",
);
const restoredCompat = fixTanstackRouterWithoutProvider(rerunInvalidTreeFallback.files);
assert.match(
  restoredCompat.files.find((f) => f.path === "src/lib/router-compat.tsx")?.content ?? "",
  /export function Link/,
  "a later repair run must restore a stubbed compatibility shim",
);
assert.match(
  restoredCompat.files.find((f) => f.path === "src/lib/router-compat.tsx")?.content ?? "",
  /useLoaderData:/,
  "the compatibility route object must support Route.useLoaderData()",
);

const contextOnlyFallback = fixTanstackRouterWithoutProvider([
  {
    path: "src/main.tsx",
    content: 'root.render(<App />);',
  },
  {
    path: "src/root.tsx",
    content:
      'import { createRootRouteWithContext } from "@tanstack/react-router";\nexport const Route = createRootRouteWithContext<any>()({ component: App });',
  },
]);
const unresolvedTree = repairUnresolvedImports([{ path: "src/router.tsx", content: 'import { routeTree } from "./routeTree.gen"; export { routeTree };' }]);
assert.equal(unresolvedTree.files.some((f) => /routeTree\.gen\.(tsx|ts)$/.test(f.path)), false, "generic repair must not fabricate a route tree");
assert.match(
  contextOnlyFallback.files.find((f) => f.path === "src/root.tsx")?.content ?? "",
  /@\/lib\/router-compat/,
  "createRootRouteWithContext must not keep an unmounted TanStack import alive",
);

console.log("router-repairs: all assertions passed");
// A provider living in an orphaned module never mounts at runtime — the fix
// must still wrap the real entry (regression: "Cannot destructure 'basename'").
const orphan = fixMissingRouterProvider([
  {
    path: "src/main.tsx",
    content:
      'import ReactDOM from "react-dom/client";\nimport App from "./App";\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
  },
  {
    path: "src/App.tsx",
    content:
      'import { Routes, Route } from "react-router-dom";\nexport default function App(){ return <Routes><Route path="/" element={<div/>} /></Routes>; }',
  },
  {
    path: "src/legacy/OldShell.tsx",
    content: 'import { BrowserRouter } from "react-router-dom";\nexport const Old = () => <BrowserRouter />;',
  },
]);
assert.match(
  orphan.files.find((f) => f.path === "src/main.tsx")?.content ?? "",
  /<BrowserRouter>/,
  "an unreachable provider must not suppress router injection",
);

// A provider that IS in the live graph must be left alone.
const mounted = fixMissingRouterProvider([
  {
    path: "src/main.tsx",
    content:
      'import ReactDOM from "react-dom/client";\nimport App from "./App";\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
  },
  {
    path: "src/App.tsx",
    content:
      'import { BrowserRouter, Routes } from "react-router-dom";\nexport default function App(){ return <BrowserRouter><Routes /></BrowserRouter>; }',
  },
]);
assert.equal(mounted.notes.length, 0, "a mounted provider must not be re-wrapped");

// A provider in a reachable descendant/sibling is not an ancestor of Routes.
// Reachability alone previously suppressed the repair and shipped the exact
// `basename`/useContext(null) crash seen in production.
const nonDominating = fixMissingRouterProvider([
  {
    path: "src/main.tsx",
    content:
      'import ReactDOM from "react-dom/client";\nimport App from "./App";\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
  },
  {
    path: "src/App.tsx",
    content:
      'import { Routes, Route } from "react-router-dom";\nimport Header from "./Header";\nexport default function App(){ return <><Header/><Routes><Route path="/" element={<div/>}/></Routes></>; }',
  },
  {
    path: "src/Header.tsx",
    content:
      'import { BrowserRouter, Link } from "react-router-dom";\nexport default function Header(){ return <BrowserRouter><Link to="/">Home</Link></BrowserRouter>; }',
  },
]);
assert.match(
  nonDominating.files.find((f) => f.path === "src/main.tsx")?.content ?? "",
  /<BrowserRouter>/,
  "a reachable but non-dominating provider must not suppress root injection",
);

const commentOnlyProvider = fixMissingRouterProvider([
  { path: "src/main.tsx", content: 'import App from "./App";\nroot.render(<App />);' },
  {
    path: "src/App.tsx",
    content: 'import { Routes } from "react-router-dom";\n// Example: <BrowserRouter><Routes /></BrowserRouter>\nexport default function App(){ return <Routes />; }',
  },
]);
assert.match(commentOnlyProvider.files[0].content, /<BrowserRouter>/, "comments must not count as providers");

const callbackRender = fixMissingRouterProvider([
  {
    path: "src/main.tsx",
    content: 'import App from "./App";\nroot.render(<App onReady={() => console.log("ready")} />);',
  },
  { path: "src/App.tsx", content: 'import { Routes } from "react-router-dom";\nexport default function App(){ return <Routes />; }' },
]);
assert.match(callbackRender.files[0].content, /<BrowserRouter>[\s\S]*onReady=\{\(\) =>/, "callbacks inside render JSX must stay intact");

const helperBeforeApp = fixMissingRouterProvider([
  { path: "src/main.tsx", content: 'import App from "./App";\nconst node = <App />;\nroot.render(node);' },
  {
    path: "src/App.tsx",
    content: 'import { Routes } from "react-router-dom";\nfunction helper(){ return ("hello"); }\nexport default function App(){ return (\n<Routes />\n); }',
  },
]);
const helperApp = helperBeforeApp.files.find((f) => f.path === "src/App.tsx")?.content ?? "";
assert.match(helperApp, /function helper\(\)\{ return \("hello"\); \}/, "helper return must remain unchanged");
assert.match(helperApp, /function App\(\)[\s\S]*<BrowserRouter>[\s\S]*<Routes \/>/, "the default App return must be wrapped");

// Mixed families: a mounted TanStack <RouterProvider> must NOT satisfy
// react-router consumers — the root render still needs <BrowserRouter>.
const mixed = fixMissingRouterProvider([
  {
    path: "src/main.tsx",
    content:
      'import { RouterProvider } from "@tanstack/react-router";\nimport { router } from "./router";\nimport "./pages/Home";\ncreateRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);\n',
  },
  {
    path: "src/pages/Home.tsx",
    content: 'import { Link } from "react-router-dom";\nexport default function Home() { return <Link to="/a">a</Link>; }\n',
  },
]);
assert.ok(
  /<BrowserRouter>/.test(mixed.files.find((f) => f.path === "src/main.tsx")?.content ?? ""),
  "mixed tanstack/react-router graph should still get a BrowserRouter",
);

console.log("router-repairs: mixed-family assertion passed");
