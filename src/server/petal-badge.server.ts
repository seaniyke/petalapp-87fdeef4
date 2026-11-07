/**
 * "Powered by Kimble" badge injection.
 *
 * Adds a small, non-intrusive floating link to the bottom-right of built apps.
 * We append a <style> + <a> block to index.html so the badge renders on every
 * route of the deployed SPA without touching any generated React code.
 *
 * IMPORTANT: this lives in its own server module (not next to one specific
 * build entry point) so EVERY pathway that ships files to the Railway builder
 * — the normal `/api/builds/trigger` flow, manual rebuild scripts, future
 * autofix retries, anything else — gets the badge automatically. Free-plan
 * projects must show this badge; paid plans may opt out via project settings.
 */
import type { ProjectFile } from "@/server/generate.server";

// We use a <script> that injects the badge at runtime instead of inline HTML +
// <style>. Why: Vite's HTML transform pipeline processes <style> tags inside
// index.html (extracting them as CSS assets, sometimes dropping orphan ones
// that aren't tied to a JS import). That stripped our styles entirely on
// deployed builds, leaving an unstyled link nobody could see. A small inline
// <script> bypasses that pipeline and runs after React mounts so the badge is
// guaranteed present and styled on every route.
const PETAL_BADGE_HTML = `
<script id="petal-badge-loader">
(function(){
  if (window.__petalBadgeMounted) return;
  window.__petalBadgeMounted = true;
  function mount(){
    if (document.getElementById('petal-badge')) return;
    var a = document.createElement('a');
    a.id = 'petal-badge';
    a.href = 'https://custardai.dev';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Powered by Custard');
    a.style.cssText = [
      'position:fixed','right:14px','bottom:14px','z-index:2147483646',
      'display:inline-flex','align-items:center','gap:6px',
      'padding:6px 10px 6px 8px','border-radius:999px',
      'background:rgba(17,17,17,0.85)','color:#fff',
      'font:500 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'text-decoration:none',
      'box-shadow:0 6px 18px rgba(0,0,0,0.18),0 0 0 1px rgba(255,255,255,0.06) inset',
      '-webkit-backdrop-filter:saturate(140%) blur(6px)',
      'backdrop-filter:saturate(140%) blur(6px)',
      'opacity:0.92','transition:transform .15s ease, opacity .15s ease'
    ].join(';') + ';';
    var dot = document.createElement('span');
    dot.setAttribute('aria-hidden','true');
    dot.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;';
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width','16'); svg.setAttribute('height','16'); svg.setAttribute('viewBox','0 0 24 24');
    var bubble = document.createElementNS(NS, 'path');
    bubble.setAttribute('fill','#9DEDCB');
    bubble.setAttribute('d','M5 3h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H9.5L4 22.5V19.2A4 4 0 0 1 1 15V7a4 4 0 0 1 4-4z');
    svg.appendChild(bubble);
    [[7,9.5,12.5],[9.5,8,14],[12,6.5,15.5],[14.5,8,14],[17,9.5,12.5]].forEach(function(b){
      var bar = document.createElementNS(NS, 'path');
      bar.setAttribute('d','M'+b[0]+' '+b[1]+'V'+b[2]);
      bar.setAttribute('stroke','#101815'); bar.setAttribute('stroke-width','1.6'); bar.setAttribute('stroke-linecap','round');
      svg.appendChild(bar);
    });
    dot.appendChild(svg);
    var label = document.createElement('span');
    label.appendChild(document.createTextNode('Powered by '));
    var strong = document.createElement('strong');
    strong.style.fontWeight = '600';
    strong.textContent = 'Custard';
    label.appendChild(strong);
    a.appendChild(dot); a.appendChild(label);
    a.addEventListener('mouseenter', function(){ a.style.opacity='1'; a.style.transform='translateY(-1px)'; });
    a.addEventListener('mouseleave', function(){ a.style.opacity='0.92'; a.style.transform='none'; });
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(mount, 0); });
  } else {
    setTimeout(mount, 0);
  }
})();
</script>
`;

export function injectPetalBadge(files: ProjectFile[]): ProjectFile[] {
  return files.map((f) => {
    if (f.path !== "index.html") return f;
    if (f.content.includes('id="petal-badge-loader"') || f.content.includes('id="petal-badge"')) return f; // idempotent
    const closingBody = /<\/body>/i;
    if (closingBody.test(f.content)) {
      return { ...f, content: f.content.replace(closingBody, `${PETAL_BADGE_HTML}\n</body>`) };
    }
    // Fallback: append to end if no </body> tag (very unusual).
    return { ...f, content: `${f.content}\n${PETAL_BADGE_HTML}\n` };
  });
}
