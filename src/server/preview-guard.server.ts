import type { ProjectFile } from "./generate.server";

const GUARD_PATH = "public/__petal_guard.js";
const GUARD_VERSION = 2;
const DEFAULT_INGEST_URL =
  "https://buildwithpetal.com/api/public/track-runtime-error";

interface GuardOptions {
  /** Petal project UUID. When present, the guard POSTs runtime errors to
   *  the ingest endpoint so deployed/CDN previews surface crashes back to
   *  Petal even when there's no parent iframe to receive postMessage. */
  projectId?: string;
  /** Override the ingest URL (used for staging/preview environments). */
  ingestUrl?: string;
}

function buildGuardScript(opts: GuardOptions): string {
  const projectId = opts.projectId ? JSON.stringify(opts.projectId) : "null";
  const ingestUrl = JSON.stringify(opts.ingestUrl || DEFAULT_INGEST_URL);
  return `(() => {
  var VERSION = ${GUARD_VERSION};
  if (window.__petalPreviewGuardVersion && window.__petalPreviewGuardVersion >= VERSION) return;
  window.__petalPreviewGuardVersion = VERSION;
  var PROJECT_ID = ${projectId};
  var INGEST_URL = ${ingestUrl};
  var lastError = null;
  var overlayShown = false;
  var posted = false;

  function asText(value) {
    if (!value) return "Unknown preview error";
    if (value.message) return String(value.message);
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function stackOf(value) {
    return value && value.stack ? String(value.stack).slice(0, 5000) : "";
  }

  function post(type, payload) {
    try { parent.postMessage({ type: type, payload: payload }, "*"); } catch (_) {}
    // Also POST to Petal's ingest endpoint so deployed apps (no parent
    // iframe) surface crashes back to the project owner. Best-effort; we
    // never let an analytics failure break the user's app.
    if (!PROJECT_ID || posted) return;
    posted = true;
    try {
      var body = JSON.stringify({
        projectId: PROJECT_ID,
        kind: payload && payload.kind ? payload.kind : "error",
        message: (payload && payload.message) || "Unknown error",
        stack: (payload && payload.stack) || null,
        source: (payload && payload.source) || null,
        lineno: (payload && payload.lineno) || null,
        colno: (payload && payload.colno) || null,
        pageUrl: (location && location.href) ? String(location.href).slice(0, 1000) : null,
      });
      if (navigator && typeof navigator.sendBeacon === "function") {
        try {
          var blob = new Blob([body], { type: "application/json" });
          if (navigator.sendBeacon(INGEST_URL, blob)) return;
        } catch (_) {}
      }
      fetch(INGEST_URL, {
        method: "POST",
        mode: "cors",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: body,
      }).catch(function () {});
    } catch (_) {}
  }

  function showOverlay(title, detail, stack) {
    if (overlayShown) return;
    overlayShown = true;
    var panel = document.createElement("div");
    panel.setAttribute("data-petal-preview-guard", "true");
    panel.style.cssText = "position:fixed;inset:0;z-index:2147483647;box-sizing:border-box;display:grid;place-items:center;padding:24px;background:#09090bcc;color:#f7f7fb;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    var safeDetail = String(detail || "No extra detail was available.").replace(/[<>&]/g, function (c) { return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]; });
    var safeStack = String(stack || "").replace(/[<>&]/g, function (c) { return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]; });
    panel.innerHTML = '<main style="width:min(720px,100%);border:1px solid #34343d;border-radius:14px;background:#111118;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:22px">' +
      '<p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a1a1aa">Preview issue</p>' +
      '<h1 style="margin:0 0 12px;font-size:24px;line-height:1.15;color:#fff">' + title + '</h1>' +
      '<p style="margin:0;color:#d4d4dd;line-height:1.5;font-size:14px">' + safeDetail + '</p>' +
      (safeStack ? '<pre style="margin:16px 0 0;max-height:280px;overflow:auto;border:1px solid #2f2f38;border-radius:10px;background:#09090b;padding:12px;color:#c7c7d1;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap">' + safeStack + '</pre>' : '') +
      '</main>';
    (document.body || document.documentElement).appendChild(panel);
  }

  function visibleElementExists(root) {
    if (!root) return false;
    if ((root.textContent || "").trim().length > 0) return true;
    var nodes = root.querySelectorAll("canvas,svg,img,video,button,a,input,textarea,select,[role]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      var rect = el.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) return true;
    }
    return false;
  }

  function reportError(kind, err, source, lineno, colno) {
    lastError = err || asText(err);
    var payload = {
      message: asText(err),
      stack: stackOf(err) || null,
      source: source || null,
      lineno: lineno || null,
      colno: colno || null,
      kind: kind,
    };
    post("petal:runtime:error", payload);
    showOverlay("This preview crashed while rendering.", payload.message, payload.stack || "");
  }

  window.addEventListener("error", function (event) {
    var target = event && event.target;
    if (target && target !== window && (target.tagName === "SCRIPT" || target.tagName === "LINK" || target.tagName === "IMG")) {
      // A failed stylesheet / font / image / async script DOES NOT crash the
      // app. React still mounts, fonts fall back, images show broken icons.
      // Showing the unrecoverable "Preview crashed" overlay here is wrong —
      // users saw a fully-working app behind a fatal error card. Post a
      // non-fatal telemetry ping so Petal can still suggest a fix, but do
      // NOT show the overlay.
      var url = target.src || target.href || "unknown asset";
      try { parent.postMessage({ type: "petal:runtime:asset-error", payload: { tag: String(target.tagName).toLowerCase(), url: String(url).slice(0, 500) } }, "*"); } catch (_) {}
      return;
    }
    if (!event || !event.message || event.message === "Script error." || event.message.indexOf("ResizeObserver loop") === 0) return;
    reportError("error", event.error || event.message, event.filename, event.lineno, event.colno);
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    reportError("unhandledrejection", event && event.reason ? event.reason : "Unhandled promise rejection", null, null, null);
  });

  function checkBlank() {
    if (overlayShown) return;
    var root = document.getElementById("root");
    if (root && visibleElementExists(root)) return;
    var message = lastError ? asText(lastError) : "The app loaded, but nothing visible was rendered into #root.";
    var stack = lastError ? stackOf(lastError) : "";
    var payload = { message: message, stack: stack || null, source: null, lineno: null, colno: null, kind: "blank" };
    post("petal:preview:blank", payload);
    showOverlay("This preview rendered blank.", message, stack);
  }

  setTimeout(checkBlank, 2500);
  setTimeout(checkBlank, 6500);
})();
`;
}

export function injectPreviewGuard(
  files: ProjectFile[],
  opts: GuardOptions = {},
): { files: ProjectFile[]; injected: boolean } {
  const script = buildGuardScript(opts);
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  byPath.set(GUARD_PATH, script);

  const index = byPath.get("index.html");
  if (!index) {
    return { files: Array.from(byPath, ([path, content]) => ({ path, content })), injected: false };
  }

  const versionAttr = `data-petal-preview-guard-version="${GUARD_VERSION}"`;
  const guardTag = `<script src="/__petal_guard.js" ${versionAttr}></script>`;
  const stripped = index.replace(/\s*<script\s+src=["']\/__petal_guard\.js["'][^>]*><\/script>/gi, "");
  const moduleScript = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']\/src\/main\.tsx["'])[^>]*><\/script>/i;
  const moduleMatch = stripped.match(moduleScript)?.[0];
  const next = stripped.includes(guardTag)
    ? stripped
    : moduleMatch
      ? stripped.replace(moduleMatch, `${guardTag}\n    ${moduleMatch}`)
      : stripped.includes("</body>")
        ? stripped.replace("</body>", `  ${guardTag}\n</body>`)
        : `${stripped}\n${guardTag}\n`;
  byPath.set("index.html", next);

  return { files: Array.from(byPath, ([path, content]) => ({ path, content })), injected: next !== index || !files.some((file) => file.path === GUARD_PATH) };
}
