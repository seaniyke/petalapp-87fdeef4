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

console.log("router-repairs: all assertions passed");