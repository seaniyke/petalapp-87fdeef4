/**
 * Native feel for phone apps — applied at the final shipping boundary.
 *
 * Every shipped index.html gets `viewport-fit=cover` (so safe-area insets are
 * real numbers) and a tiny script that, only inside the phone app (Custard Go /
 * store shell, `?petal_app=1`, or a home-screen install), marks <html> with
 * `petal-app` and applies: status-bar safe area at the top, sticky headers
 * pinned below the status bar, no rubber-band or scroll chaining, momentum
 * scrolling, no tap flash / text-selection callouts, hidden scrollbars.
 * Browsers visiting the website are untouched.
 */
import type { ProjectFile } from "@/server/generate.server";

const VIEWPORT = "width=device-width, initial-scale=1, viewport-fit=cover";

const CSS = [
  "html.petal-app{overscroll-behavior:none;-webkit-text-size-adjust:100%;background:var(--background,#fff)}",
  "html.petal-app body{overscroll-behavior-y:none;-webkit-overflow-scrolling:touch;padding-top:env(safe-area-inset-top);-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}",
  "html.petal-app input,html.petal-app textarea,html.petal-app [contenteditable]{-webkit-user-select:text;user-select:text}",
  "html.petal-app a,html.petal-app button,html.petal-app [role=button],html.petal-app [role=tab]{touch-action:manipulation}",
  "html.petal-app *{scrollbar-width:none}html.petal-app *::-webkit-scrollbar{display:none}",
  "html.petal-app *{overscroll-behavior-x:contain}",
  "html.petal-app .sticky.top-0,html.petal-app header.sticky{top:env(safe-area-inset-top)!important}",
  "html.petal-app .fixed.top-0{top:env(safe-area-inset-top)!important}",
  "html.petal-app #petal-badge{display:none!important}",
  "#petal-status-bar{position:fixed;left:0;right:0;top:0;height:env(safe-area-inset-top);background:var(--background,#fff);z-index:2147483645;pointer-events:none}",
].join("");

const SCRIPT = `<script id="petal-native-feel">(function(){try{var q=new URLSearchParams(location.search).get("petal_app")==="1";if(q)sessionStorage.setItem("petal_app","1");var C=window.Capacitor,inApp=q||sessionStorage.getItem("petal_app")==="1"||(C&&C.isNativePlatform&&C.isNativePlatform())||matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(!inApp)return;var d=document.documentElement;d.classList.add("petal-app");var s=document.createElement("style");s.textContent=${JSON.stringify(CSS)};document.head.appendChild(s);function bar(){if(document.getElementById("petal-status-bar")||!document.body)return;var b=document.createElement("div");b.id="petal-status-bar";b.setAttribute("aria-hidden","true");document.body.appendChild(b)}if(document.body)bar();else document.addEventListener("DOMContentLoaded",bar)}catch(e){}})();</script>`;

export function ensureNativeFeel(files: ProjectFile[]): ProjectFile[] {
  return files.map((f) => {
    if (f.path !== "index.html") return f;
    let html = f.content;
    const vp = /<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i;
    if (vp.test(html)) html = html.replace(vp, `<meta name="viewport" content="${VIEWPORT}" />`);
    else html = html.replace(/<head[^>]*>/i, (h) => `${h}<meta name="viewport" content="${VIEWPORT}" />`);
    if (!html.includes('id="petal-native-feel"')) {
      html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${SCRIPT}</head>`) : `${SCRIPT}${html}`;
    }
    return html === f.content ? f : { ...f, content: html };
  });
}
