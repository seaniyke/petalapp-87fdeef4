import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { ConsentBanner } from "@/components/ConsentBanner";

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
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/petal-logo.png" },
      { rel: "apple-touch-icon", href: "/petal-logo.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
    ],
    scripts: [
      {
        src: "https://www.googletagmanager.com/gtag/js?id=G-3DLEXWLWEW",
        async: true,
      },
      {
        // Consent Mode v2: every signal defaults to "denied" until the
        // ConsentBanner updates it after the visitor chooses.
        children:
          "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});gtag('js', new Date());gtag('config', 'G-3DLEXWLWEW');",
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
// The check must test whether the page is ACTUALLY unstyled, not whether a
// `/assets/*.css` link exists: in dev (and whenever CSS is inlined) Vite
// injects <style> tags instead, so the old link-only heuristic fired on every
// load and forced a wasteful full reload of the builder.
// Pre-paint auth hint: a signed-in user refreshing the landing page used to
// see the marketing hero for one frame before React hydrated and the session
// resolved. The server can't know about the session, so the SSR HTML is always
// the marketing page — but a returning user has an `sb-*-auth-token` key in
// localStorage. This script runs before first paint and flags <html>; CSS then
// keeps the landing's auth-sensitive UI hidden until AuthProvider resolves the
// real session and removes the flag. Signed-out visitors and crawlers have no
// token, so they get the marketing page immediately, fully visible.
const authHintScript = `(function(){try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')>0&&localStorage.getItem(k)){document.documentElement.setAttribute('data-petal-auth-hint','1');return}}}catch(e){}})();`;

const stylesheetRecoveryScript = `(function(){var key='petal:reloaded-after-style-miss';function reload(){try{if(sessionStorage.getItem(key)==='1')return;sessionStorage.setItem(key,'1');}catch(e){}var u=new URL(location.href);u.searchParams.set('__petal_css_recover',Date.now().toString(36));location.replace(u.toString());}function styled(){try{var v=getComputedStyle(document.documentElement).getPropertyValue('--background');if(v&&v.trim())return true;}catch(e){}try{var sheets=[].slice.call(document.styleSheets||[]);for(var i=0;i<sheets.length;i++){try{if(sheets[i].cssRules&&sheets[i].cssRules.length)return true;}catch(e){return true;}}}catch(e){}return false;}window.addEventListener('error',function(e){var t=e&&e.target;if(!t||t.tagName!=='LINK')return;var rel=(t.getAttribute('rel')||'').toLowerCase();var href=t.getAttribute('href')||'';if(rel.indexOf('stylesheet')!==-1&&(href.indexOf('/assets/')===0||href.indexOf(location.origin+'/assets/')===0)&&!styled())reload();},true);window.addEventListener('load',function(){setTimeout(function(){if(!styled()){reload();return;}try{sessionStorage.removeItem(key);}catch(e){}},1200);});})();`;

// AuthProvider lives in the SHELL, not in `component`. The shell wraps every
// router state — including the error and not-found components, which render
// OUTSIDE `component`. Providing auth only in `component` meant any route that
// errored during SSR re-rendered its error UI without a provider, and any
// consumer there threw "useAuthReady must be used inside <AuthProvider>",
// turning a recoverable route error into a full server-render crash.
function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: authHintScript }} />
        <script dangerouslySetInnerHTML={{ __html: stylesheetRecoveryScript }} />
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          {children}
          <Toaster />
          <ConsentBanner />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
