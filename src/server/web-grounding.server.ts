/**
 * Web grounding — "Build from real content".
 *
 * When a user pastes a URL and asks Petal to build a landing page LIKE it,
 * CLONE it, RECREATE it, use it as INSPIRATION, or grab COPY / TEXT from it,
 * we fetch the page(s), strip to plain text, and inject the content as a
 * grounding block. The main model then writes real, up-to-date copy grounded
 * in the fetched material instead of hallucinating.
 *
 * Design notes:
 *   - Zero new dependencies — reuses plain `fetch` + a lightweight HTML→text
 *     stripper. Good enough for marketing copy; not a full SPA renderer.
 *   - Bounded: at most 2 URLs per turn, 12 KB of text per URL, 6s timeout.
 *   - Failure-tolerant: any fetch/parse error is swallowed; the build proceeds
 *     without grounding. Never blocks a turn.
 *   - Intent-gated: we only scrape when the prompt clearly asks us to (clone
 *     / like / recreate / inspired by / from this site / copy from). Random
 *     URLs in a chat message are NOT fetched — that would waste tokens.
 */

const URL_RE = /https?:\/\/[^\s<>()"']+/gi;

const CLONE_INTENT_RE =
  /\b(clone|copy|recreate|rebuild|replicate|inspired\s+by|based\s+on|like\s+(this|the)\s+(site|page|website)|similar\s+to|from\s+(this|the)\s+(site|page|website|url|link)|use\s+(this|the)\s+(site|page|website|url|link)|grab\s+(copy|content|text|info)\s+from|pull\s+(copy|content|text|info)\s+from|scrape|fetch\s+content|research\s+this|read\s+this\s+(site|page|url|link))\b/i;

const MAX_URLS = 2;
const MAX_BYTES = 12_000;
const FETCH_TIMEOUT_MS = 6_000;

export type GroundedPage = {
  url: string;
  title: string;
  text: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 200) : "";
}

async function fetchOne(url: string): Promise<GroundedPage | null> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PetalBuilder/1.0; +https://buildwithpetal.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) return null;
    const ctype = resp.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ctype)) return null;
    const html = (await resp.text()).slice(0, 200_000);
    const title = extractTitle(html);
    const text = stripHtml(html).slice(0, MAX_BYTES);
    if (text.length < 80) return null;
    return { url, title, text };
  } catch {
    return null;
  }
}

/**
 * Detect URLs the user wants Petal to ground the build in. Returns [] unless
 * the prompt shows explicit clone/copy/inspired-by intent.
 */
export function detectGroundingUrls(prompt: string): string[] {
  if (!prompt) return [];
  const text = prompt.slice(0, 8000);
  if (!CLONE_INTENT_RE.test(text)) return [];
  const urls = Array.from(text.matchAll(URL_RE), (m) => m[0]);
  // Dedupe + strip trailing punctuation that regex often includes.
  const cleaned = urls
    .map((u) => u.replace(/[.,;:!?)\]]+$/g, ""))
    .filter((u, i, arr) => arr.indexOf(u) === i);
  return cleaned.slice(0, MAX_URLS);
}

/** Fetch grounding pages for a prompt. Failure-tolerant, bounded. */
export async function fetchGroundingPages(prompt: string): Promise<GroundedPage[]> {
  const urls = detectGroundingUrls(prompt);
  if (urls.length === 0) return [];
  const results = await Promise.all(urls.map((u) => fetchOne(u)));
  return results.filter((r): r is GroundedPage => r !== null);
}

/** Render grounding pages as a prompt block for the builder model. */
export function renderGroundingBlock(pages: GroundedPage[]): string {
  if (pages.length === 0) return "";
  const sections = pages
    .map(
      (p, i) =>
        `### Source ${i + 1}: ${p.url}\n${p.title ? `Title: ${p.title}\n` : ""}\`\`\`\n${p.text}\n\`\`\``,
    )
    .join("\n\n");
  return (
    `\n\n## Project grounding — real content fetched from the URLs the user shared\n` +
    `The user asked you to build FROM the following real page(s). Ground the site's copy, section names, feature descriptions, testimonials, pricing, and voice in this material. Rewrite (do NOT copy verbatim), keep facts accurate, and skip anything that looks like nav chrome, cookie banners, or legal footers. If the source is thin, augment with sensible inferences rather than "Lorem ipsum".\n\n${sections}\n`
  );
}
