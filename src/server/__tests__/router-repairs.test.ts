import { strict as assert } from "node:assert";
import { fixTanstackRouterWithoutProvider } from "../tanstack-router-fallback.server";
import { fixMissingRouterProvider } from "../router-provider.server";

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
    content: "export const routeTree = rootRouteImport.addChildren([]);",
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
assert.match(
  contextOnlyFallback.files.find((f) => f.path === "src/root.tsx")?.content ?? "",
  /@\/lib\/router-compat/,
  "createRootRouteWithContext must not keep an unmounted TanStack import alive",
);

console.log("router-repairs: all assertions passed");