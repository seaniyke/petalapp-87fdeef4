/**
 * Custard AI staff widget. Apps built for Custard AI (owned by the service
 * account) get Custard's chat/voice widget right before </body>. Idempotent.
 *
 * Custard identifies which AI staff member belongs to a site with
 * `data-agent="<id>"` and/or `?agent=<id>` on the script. index.html is
 * machine-owned (document-head only merges head metadata), so a tag the model
 * copied from the brief never survives. Instead the tag is parsed from the
 * request, sanitised, stored on `projects.custard_widget_tag`, and injected
 * here at the ship boundary with its attributes and query string intact.
 */
import type { ProjectFile } from "@/server/generate.server";

const WIDGET_SRC = "https://custardai.dev/widget.js";
export const CUSTARD_WIDGET_TAG = `<script src="${WIDGET_SRC}" async></script>`;

const SAFE_VALUE = /^[A-Za-z0-9_\-.:]{1,200}$/;
const SAFE_ATTR = /^data-[a-z0-9-]{1,40}$/;
const WIDGET_RE = /<script\b[^>]*custardai\.dev\/widget\.js[^>]*>(?:\s*<\/script>)?/gi;

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build a clean widget tag. Only data-* attributes and safe query values pass. */
export function buildCustardWidgetTag(opts: {
  query?: Record<string, string>;
  data?: Record<string, string>;
}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (/^[A-Za-z0-9_-]{1,40}$/.test(k) && SAFE_VALUE.test(v)) params.set(k, v);
  }
  const qs = params.toString();
  const attrs = Object.entries(opts.data ?? {})
    .filter(([k, v]) => SAFE_ATTR.test(k) && SAFE_VALUE.test(v))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  return `<script src="${WIDGET_SRC}${qs ? `?${qs}` : ""}"${attrs} async></script>`;
}

/** Tag for a bare staff id (API `agentId` field). */
export function custardWidgetTagForAgent(agentId: string): string | null {
  const id = agentId.trim();
  if (!SAFE_VALUE.test(id)) return null;
  return buildCustardWidgetTag({ query: { agent: id }, data: { "data-agent": id } });
}

/**
 * Find a Custard widget <script> in free text (a prompt or an HTML file) and
 * return a sanitised copy that keeps its data-* attributes and query string.
 * Returns null when there is no tag, or the tag carries nothing beyond the
 * bare default (nothing worth storing).
 */
export function parseCustardWidgetTag(text: string | null | undefined): string | null {
  if (!text) return null;
  // Briefs are sometimes HTML-escaped by the sender.
  const src = text.includes("&lt;script") ? text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : text;
  for (const tag of src.match(WIDGET_RE) ?? []) {
    const srcAttr = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    let query: Record<string, string> = {};
    try {
      const u = new URL(srcAttr.replace(/&amp;/g, "&"));
      if (u.hostname !== "custardai.dev" || u.pathname !== "/widget.js") continue;
      query = Object.fromEntries(u.searchParams.entries());
    } catch {
      continue;
    }
    const data: Record<string, string> = {};
    for (const m of tag.matchAll(/\s(data-[a-z0-9-]+)\s*=\s*["']([^"']*)["']/gi)) {
      data[m[1].toLowerCase()] = m[2];
    }
    const built = buildCustardWidgetTag({ query, data });
    if (built !== CUSTARD_WIDGET_TAG) return built;
  }
  return null;
}

/**
 * Put Custard's widget right before </body>, exactly once. When a specific
 * tag is given it replaces any existing (bare or stale) widget tag; without
 * one, an existing widget tag is left untouched so attributes survive.
 */
export function injectCustardWidget(files: ProjectFile[], tag?: string | null): ProjectFile[] {
  const wanted = tag && tag.includes("custardai.dev/widget.js") ? tag : null;
  return files.map((f) => {
    if (f.path !== "index.html") return f;
    const existing = f.content.match(WIDGET_RE) ?? [];
    if (existing.length > 0 && (!wanted || (existing.length === 1 && existing[0] === wanted))) return f;
    const cleaned = existing.length > 0 ? f.content.replace(WIDGET_RE, "").replace(/\n{3,}/g, "\n\n") : f.content;
    const insert = wanted ?? CUSTARD_WIDGET_TAG;
    const closingBody = /<\/body>/i;
    if (closingBody.test(cleaned)) {
      return { ...f, content: cleaned.replace(closingBody, `${insert}\n</body>`) };
    }
    return { ...f, content: `${cleaned}\n${insert}\n` };
  });
}

/** True when the project belongs to the Custard AI service account. */
export async function isCustardOwned(ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const { serviceUserId } = await import("@/server/service-api.server");
    return ownerId === (await serviceUserId());
  } catch {
    return false;
  }
}

/** Stored widget tag for a project, or null (bare default is used). */
export async function readCustardWidgetTag(projectId: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("projects").select("custard_widget_tag").eq("id", projectId).maybeSingle();
    const tag = (data as { custard_widget_tag?: string | null } | null)?.custard_widget_tag ?? null;
    // Re-sanitise on read so a hand-edited row can never inject markup.
    return parseCustardWidgetTag(tag);
  } catch {
    return null;
  }
}

/** Save the widget tag for a project. Never throws. */
export async function saveCustardWidgetTag(projectId: string, tag: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("projects").update({ custard_widget_tag: tag }).eq("id", projectId);
  } catch (e) {
    console.warn(`[custard-widget] could not save tag for project=${projectId}:`, e instanceof Error ? e.message : String(e));
  }
}
