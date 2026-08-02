/**
 * Deterministic "add more sections" patch builder.
 *
 * "Add more sections to the website" is one of the most common follow-up
 * asks, and it used to be the one Petal was worst at: the model would
 * stream prose, fail to emit a usable patch twice, and the turn degraded
 * to "I couldn't pin down a safe change" — which reads as a refusal for a
 * request that is completely unambiguous.
 *
 * The old fallback only fired for prompts that literally said "page", only
 * looked at three hard-coded file paths, and required a `<CtaSection />`
 * line to anchor against. Any other shape → no patch.
 *
 * This module makes the same intent land on essentially any generated app:
 *   - broad trigger vocabulary (site / website / app / landing / home / page)
 *   - target resolution by convention AND by content shape
 *   - new sections live in their OWN file, so nothing depends on being able
 *     to append safely to the tail of an existing component
 *   - two tiny, uniqueness-checked `replace` ops: one import, one render
 */

import type { ProjectFile } from "./generate.server";

export interface SectionExpansionPatch {
  plan: string;
  summary: string;
  recap: string;
  ops: Array<
    | { op: "create"; path: string; content: string }
    | { op: "replace"; path: string; search: string; replace: string }
  >;
}

const ADD_RE = /\b(add|more|extra|additional|expand|extend|new|another|fill\s+out|flesh\s+out|richer)\b/i;
const SURFACE_RE =
  /\b(sections?|blocks?|content|contents|landing|home\s?page|homepage|main\s+page|front\s+page|page|site|website|web\s?site|app)\b/i;

export function wantsMoreSections(prompt: string): boolean {
  if (!prompt) return false;
  const text = prompt.slice(0, 2000);
  return ADD_RE.test(text) && SURFACE_RE.test(text);
}

const SCAFFOLD_RE = /^src\/(components\/(ui|blocks|examples|mobile)\/|integrations\/)/;

function isAppOwned(path: string): boolean {
  return /\.(tsx|jsx)$/.test(path) && !SCAFFOLD_RE.test(path);
}

/** The page most likely to be "the website" the user is looking at. */
export function pickSectionTarget(files: ProjectFile[]): ProjectFile | null {
  const byPath = [
    "src/pages/Home.tsx",
    "src/pages/Index.tsx",
    "src/pages/Landing.tsx",
    "src/routes/index.tsx",
    "src/App.tsx",
  ];
  for (const p of byPath) {
    const hit = files.find((f) => f.path === p);
    if (hit && /return\s*\(/.test(hit.content)) return hit;
  }
  const candidates = files
    .filter((f) => isAppOwned(f.path) && /return\s*\(/.test(f.content))
    .filter((f) => /<h1|hero|landing|homepage/i.test(f.content))
    .sort((a, b) => b.content.length - a.content.length);
  return candidates[0] ?? null;
}

function uniqueName(files: ProjectFile[], base: string): { path: string; component: string } {
  for (let i = 0; i < 20; i++) {
    const component = i === 0 ? base : `${base}${i + 1}`;
    const path = `src/components/${component}.tsx`;
    if (!files.some((f) => f.path === path)) return { path, component };
  }
  return { path: `src/components/${base}${Date.now()}.tsx`, component: `${base}${Date.now()}` };
}

/** Grow a snippet backwards until it occurs exactly once in the file. */
function uniqueSearch(content: string, index: number, length: number): string | null {
  for (const pad of [0, 120, 320, 700, 1400]) {
    const start = Math.max(0, index - pad);
    const snippet = content.slice(start, index + length);
    if (snippet && content.indexOf(snippet) === content.lastIndexOf(snippet)) return snippet;
  }
  return null;
}

/** Where the new <Sections /> call should go inside the page's JSX. */
function findRenderAnchor(content: string): { search: string; indent: string; before: string } | null {
  // Prefer sitting just above the footer, which is almost always last.
  const footer = content.match(/\n([ \t]*)<(Footer|SiteFooter|AppFooter)\b[^>]*\/>\n/);
  if (footer && typeof footer.index === "number") {
    const search = uniqueSearch(content, footer.index, footer[0].length);
    if (search) return { search, indent: footer[1], before: footer[0] };
  }
  // Otherwise: the closing tag of the component's top-level returned element.
  const closing = /\n([ \t]*)<\/([A-Za-z][\w.]*)>\n[ \t]*\);/g;
  let m: RegExpExecArray | null;
  while ((m = closing.exec(content)) !== null) {
    const search = uniqueSearch(content, m.index, m[0].length);
    if (search) return { search, indent: `${m[1]}  `, before: m[0] };
  }
  return null;
}

/** Import line insertion point: right after the last top-level import. */
function findImportAnchor(content: string): string | null {
  const imports = [...content.matchAll(/^import\s[^\n]*\n/gm)];
  if (!imports.length) return null;
  const last = imports[imports.length - 1];
  if (typeof last.index !== "number") return null;
  return uniqueSearch(content, last.index, last[0].length);
}

function sectionsFile(component: string): string {
  return `const features = [
  {
    title: "Everything in one place",
    body: "Browse, compare and book without juggling five different tabs.",
  },
  {
    title: "Built for real schedules",
    body: "Live availability means what you see is what you can actually book.",
  },
  {
    title: "Support that answers",
    body: "Real people, quick replies, and help before and after your trip.",
  },
];

const steps = [
  { step: "01", title: "Tell us what you need", body: "Dates, budget, and the vibe you're after." },
  { step: "02", title: "Compare real options", body: "Handpicked results with clear, upfront pricing." },
  { step: "03", title: "Book in a minute", body: "Instant confirmation and everything in your inbox." },
];

const testimonials = [
  { quote: "Booked in under five minutes and the whole trip just worked.", name: "Amara O." },
  { quote: "The clearest pricing I've seen anywhere. No surprises at all.", name: "Daniel K." },
  { quote: "Support replied in minutes when my plans changed. Rare these days.", name: "Priya S." },
];

const faqs = [
  { q: "How soon is my booking confirmed?", a: "Instantly — you'll get a confirmation the moment you finish checkout." },
  { q: "Can I change my dates later?", a: "Yes. Most bookings can be moved or cancelled free up to 24 hours before." },
  { q: "Are there hidden fees?", a: "No. The price you see at checkout is the price you pay." },
];

export default function ${component}() {
  return (
    <>
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Why us</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold md:text-5xl">
            Made for people who'd rather be on the trip than planning it
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-border bg-card p-6">
                <h3 className="text-xl font-semibold">{feature.title}</h3>
                <p className="mt-3 text-muted-foreground">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="max-w-2xl text-3xl font-bold md:text-5xl">How it works</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((item) => (
              <div key={item.step} className="rounded-2xl bg-card p-6">
                <div className="text-sm font-semibold text-primary">{item.step}</div>
                <h3 className="mt-3 text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="max-w-2xl text-3xl font-bold md:text-5xl">Loved by people who travel often</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {testimonials.map((item) => (
              <figure key={item.name} className="rounded-2xl border border-border bg-card p-6">
                <blockquote className="text-lg">"{item.quote}"</blockquote>
                <figcaption className="mt-4 text-sm font-medium text-muted-foreground">{item.name}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-3xl font-bold md:text-5xl">Questions, answered</h2>
          <div className="mt-10 divide-y divide-border">
            {faqs.map((faq) => (
              <div key={faq.q} className="py-6">
                <h3 className="text-lg font-semibold">{faq.q}</h3>
                <p className="mt-2 text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
`;
}

/**
 * Returns a ready-to-apply patch that adds four new sections to the app's
 * main page, or null when the intent doesn't apply / no safe anchor exists.
 */
export function buildSectionExpansionPatch(args: {
  currentFiles: ProjectFile[];
  prompt: string;
}): SectionExpansionPatch | null {
  if (!wantsMoreSections(args.prompt)) return null;

  const target = pickSectionTarget(args.currentFiles);
  if (!target) return null;

  const { path, component } = uniqueName(args.currentFiles, "MoreSections");
  const importAnchor = findImportAnchor(target.content);
  const render = findRenderAnchor(target.content);
  if (!importAnchor || !render) return null;

  const importLine = `import ${component} from "@/components/${component}";\n`;
  const call = `${render.indent}<${component} />\n`;

  const summary =
    "I added four new sections to the page — a features block, a how-it-works walkthrough, testimonials, and an FAQ — matching the existing design.";

  return {
    plan: "I’ll add a set of new sections to the main page in their own component, so the existing layout stays untouched.",
    summary,
    recap: `- \`${path}\` — new features, how-it-works, testimonials and FAQ sections\n- \`${target.path}\` — rendered the new sections on the page`,
    ops: [
      { op: "create", path, content: sectionsFile(component) },
      {
        op: "replace",
        path: target.path,
        search: importAnchor,
        replace: `${importAnchor}${importLine}`,
      },
      {
        op: "replace",
        path: target.path,
        search: render.search,
        replace: render.search.replace(render.before, `\n${call}${render.before.slice(1)}`),
      },
    ],
  };
}
