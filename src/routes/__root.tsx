import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Petal — Build real apps with AI" },
      {
        name: "description",
        content:
          "Petal turns conversations into working web apps. Chat, preview, and ship — no setup required.",
      },
      { name: "author", content: "Petal" },
      { property: "og:title", content: "Petal — Build real apps with AI" },
      {
        property: "og:description",
        content: "Turn conversations into working web apps in minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Petal — Build real apps with AI" },
      {
        name: "twitter:description",
        content: "Turn conversations into working web apps in minutes.",
      },
      // og:image / twitter:image intentionally omitted at the root —
      // TanStack concatenates head() across matched routes and a root og:image
      // would override every leaf route's own image. Each shareable leaf route
      // (/, /gallery, /p/$slug, etc.) sets its own when appropriate.
      { name: "description", content: "Chat Build Studio is a platform for building real apps through conversational AI." },
      { property: "og:description", content: "Chat Build Studio is a platform for building real apps through conversational AI." },
      { name: "twitter:description", content: "Chat Build Studio is a platform for building real apps through conversational AI." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/c49a8307-2264-4e94-96da-33bc69cc7713" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/c49a8307-2264-4e94-96da-33bc69cc7713" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/petal-logo.png" },
      { rel: "apple-touch-icon", href: "/petal-logo.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

// Blocking inline script — runs before first paint, before React hydrates.
// Reads the persisted theme (or system preference) and toggles `.dark` on
// <html> so SSR HTML renders with the correct tokens. Without this, the page
// paints with `:root` (light) tokens until the useEffect in useTheme runs,
// causing a visible flash on every refresh.
const themeInitScript = `(function(){try{var k='petal:theme';var v=localStorage.getItem(k);var t=(v==='light'||v==='dark'||v==='system')?v:'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

// If a long-lived tab survives a deployment, Safari can keep old HTML that
// points at CSS files the new deployment no longer has. The page then renders
// as raw, unstyled HTML until the user refreshes. Catch failed stylesheet loads
// early and do one automatic cache-busting reload.
const stylesheetRecoveryScript = `(function(){var key='petal:reloaded-after-style-miss';function reload(){try{if(sessionStorage.getItem(key)==='1')return;sessionStorage.setItem(key,'1');}catch(e){}var u=new URL(location.href);u.searchParams.set('__petal_css_recover',Date.now().toString(36));location.replace(u.toString());}window.addEventListener('error',function(e){var t=e&&e.target;if(!t||t.tagName!=='LINK')return;var rel=(t.getAttribute('rel')||'').toLowerCase();var href=t.getAttribute('href')||'';if(rel.indexOf('stylesheet')!==-1&&(href.indexOf('/assets/')===0||href.indexOf(location.origin+'/assets/')===0))reload();},true);window.addEventListener('load',function(){setTimeout(function(){try{var sheets=[].slice.call(document.styleSheets||[]);var local=sheets.filter(function(s){return s.href&&new URL(s.href,location.href).origin===location.origin&&new URL(s.href,location.href).pathname.indexOf('/assets/')===0;});if(!local.length){reload();return;}try{sessionStorage.removeItem(key);}catch(e){}}catch(e){}},1200);});})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: stylesheetRecoveryScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster />
    </AuthProvider>
  );
}
