UPDATE public.project_files
SET content = 'import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { ThemeProvider } from "./components/ui/theme-provider";
import { AppProviders } from "./components/providers/app-providers";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <RouterProvider router={router} />
      </ThemeProvider>
    </AppProviders>
  </React.StrictMode>,
);',
    updated_at = now()
WHERE project_id = '51d0ef30-d894-4339-b7e8-64ff827c3c8d'::uuid
  AND path = 'src/main.tsx';

INSERT INTO public.project_files (project_id, path, content)
VALUES (
  '51d0ef30-d894-4339-b7e8-64ff827c3c8d'::uuid,
  'src/router.tsx',
  'import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({ routeTree });
'
)
ON CONFLICT (project_id, path)
DO UPDATE SET content = EXCLUDED.content, updated_at = now();