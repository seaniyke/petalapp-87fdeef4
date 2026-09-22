/**
 * The sample app Kimble tests its own testing against.
 *
 * A testing system that is never itself tested is a claim, not a capability.
 * This fixture is a deliberately small app with two *known* faults:
 *
 *   1. a backend fault — the notes list calls a table that does not exist, so
 *      the page renders an error instead of the list (a failed request plus a
 *      page error the browser can actually see);
 *   2. a visual fault — the dashboard heading is rendered invisible, so the
 *      page "loads" while the thing the user came for is not on screen.
 *
 * Both are the kind of failure a build check alone would happily call a
 * success: the code compiles and the deployment serves HTML. Only driving the
 * real app catches them. The harness below simulates the browser reports the
 * defective app and its repaired version would produce, so the whole chain —
 * plan, judge, diagnose, repair, retest, readiness — can be exercised
 * deterministically, without a network or a live deployment.
 */
import type { BrowseReport } from "@/server/browse-client.server";
import type { ProjectFile } from "@/server/generate.server";
import type { TestCase } from "@/server/test-plan.server";
import type { VerifyPlan } from "@/server/verify-plan.server";

export const SAMPLE_PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";

export const defectiveAppFiles: ProjectFile[] = [
  {
    path: "src/App.tsx",
    content: `import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Notes from "./pages/Notes";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/notes" element={<Notes />} />
    </Routes>
  );
}`,
  },
  {
    path: "src/pages/Home.tsx",
    content: `export default function Home() {
  return <h1>Notely — keep every thought</h1>;
}`,
  },
  {
    path: "src/pages/Login.tsx",
    content: `export default function Login() {
  return (
    <form>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Sign in</button>
    </form>
  );
}`,
  },
  {
    // Visual fault: the heading is there in the DOM but painted transparent.
    path: "src/pages/Dashboard.tsx",
    content: `export default function Dashboard() {
  return (
    <main>
      <h1 style={{ opacity: 0 }}>Your dashboard</h1>
      <p>Recent activity</p>
    </main>
  );
}`,
  },
  {
    // Backend fault: the table name is wrong, so the query 404s at runtime.
    path: "src/pages/Notes.tsx",
    content: `import { supabase } from "@/integrations/supabase/client";

export default function Notes() {
  const load = async () => {
    const { data } = await supabase.from("note_entries").select("*");
    return data;
  };
  return <section>{String(load())}</section>;
}`,
  },
];

export const defectiveVerifyPlan: VerifyPlan = {
  routes: ["/", "/login", "/dashboard", "/notes"],
  auth: {
    signupPath: "/login",
    loginPath: "/login",
    email: "petal-verify+sample@example.com",
    password: "Sample-Passw0rd!",
    name: "Kimble Verify",
    protectedRoutes: ["/dashboard", "/notes"],
  },
  flows: [
    {
      name: "Write a note",
      requiresAuth: true,
      steps: [
        { action: "goto", path: "/notes" },
        { action: "expectText", value: "note" },
      ],
    },
  ],
};

/** The same app with both faults corrected. */
export const repairedAppFiles: ProjectFile[] = defectiveAppFiles.map((f) => {
  if (f.path === "src/pages/Dashboard.tsx") {
    return { ...f, content: f.content.replace(' style={{ opacity: 0 }}', "") };
  }
  if (f.path === "src/pages/Notes.tsx") {
    return { ...f, content: f.content.replace('"note_entries"', '"notes"') };
  }
  return f;
});

// ------------------------------------------------------------------ harness

const step = (over: Partial<BrowseReport["steps"][number]>): BrowseReport["steps"][number] => ({
  action: "goto",
  ok: true,
  durationMs: 40,
  ...over,
});

const baseReport = (over: Partial<BrowseReport>): BrowseReport => ({
  ok: true,
  baseUrl: "https://sample.example.app",
  finalUrl: "https://sample.example.app/",
  durationMs: 900,
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  ...over,
});

/**
 * Simulate driving a browser through one case, against either the defective
 * or the repaired app. The reports carry exactly the kind of evidence the
 * real steerable browser returns.
 */
export function simulateBrowse(testCase: TestCase, repaired: boolean): BrowseReport {
  const url = `https://sample.example.app${routeOf(testCase)}`;

  if (routeOf(testCase) === "/notes" && !repaired) {
    return baseReport({
      finalUrl: url,
      steps: [
        step({ action: "goto", url }),
        step({ action: "text", data: "Something went wrong", url }),
      ],
      pageErrors: ['TypeError: Cannot read properties of null (reading "map")'],
      failedRequests: ["GET /rest/v1/note_entries?select=* — 404 relation does not exist"],
    });
  }

  if (routeOf(testCase) === "/dashboard" && !repaired) {
    return baseReport({
      finalUrl: url,
      steps: [
        step({ action: "goto", url }),
        // The heading is invisible, so the visible text never contains it.
        step({ action: "text", data: "Recent activity", url }),
        step({ action: "screenshot", image: "ZmFrZS1zY3JlZW5zaG90", width: 1440, url }),
      ],
    });
  }

  return baseReport({
    finalUrl: url,
    steps: [
      step({ action: "goto", url }),
      step({
        action: "text",
        data:
          routeOf(testCase) === "/dashboard"
            ? "Your dashboard Recent activity"
            : routeOf(testCase) === "/notes"
              ? "Your notes"
              : routeOf(testCase) === "/login"
                ? "Sign in"
                : "Notely — keep every thought",
        url,
      }),
      step({ action: "screenshot", image: "ZmFrZS1zY3JlZW5zaG90", width: 1440, url }),
    ],
  });
}

function routeOf(testCase: TestCase): string {
  const goto = testCase.actions.find((a) => a.action === "goto") as { path?: string } | undefined;
  return goto?.path ?? "/";
}
