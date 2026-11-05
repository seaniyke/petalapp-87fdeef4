/**
 * Visual QA — the last quality gate before a build is called good.
 *
 * The builder captures a couple of compressed screenshots of the deployed app
 * at a phone width (390) and a desktop width (1440). This module hands those
 * images to a vision model with the same craft rules the generator was told to
 * follow (docs/petal-frontend-quality-bible.md) and converts what it sees into
 * defect strings. Those defects join `verification.defects`, which is what the
 * repair loop already reads — so a visually broken page gets repaired exactly
 * like a console error does.
 *
 * Hard rules:
 *  - Never throws. A vision failure is a missing opinion, not a build failure.
 *  - Only reports defects a screenshot can actually prove (overlap, clipping,
 *    unreadable contrast, blank hero, cramped mobile). Taste notes are dropped.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";

export interface VisualShot {
  path: string;
  width: number;
  image: string;
}

const MODEL = "google/gemini-3.8-flash";
const MAX_SHOTS = 8;
const MAX_DEFECTS = 8;

/** Only these categories are actionable from a still image. */
const ALLOWED_KINDS = new Set([
  "overlap",
  "clipped",
  "unreadable",
  "blank",
  "cramped",
  "overflow",
  "broken-image",
  "misaligned",
  "transparent-overlay",
]);

const RULES = `You are Kimble's visual QA reviewer. You are shown screenshots of a freshly generated web app.
Report ONLY defects that are visibly provable in the image. Be strict but literal — never guess about behaviour you cannot see.

Report a defect when you see:
- overlap: two elements sit on top of each other and obscure content
- clipped: text or a component is cut off by its container or the viewport
- unreadable: text has too little contrast against its background, or is smaller than ~12px
- blank: the page (or its hero) is empty, or shows only a spinner/skeleton
- cramped: on the 390px shot, content touches the screen edges, buttons look under ~44px tall, or a desktop table/multi-column grid is squeezed
- overflow: content spills horizontally past the viewport
- broken-image: a broken/placeholder image icon or an obvious grey missing-image box
- misaligned: elements that should share a baseline/grid are visibly off
- transparent-overlay: a menu, sheet, or dropdown is see-through so the page behind bleeds through and makes it unreadable

Do NOT report: subjective taste, colour preference, copy wording, "could be more modern", spacing you merely dislike, or anything requiring interaction.

Respond with JSON only:
{"defects":[{"kind":"<one of the kinds above>","where":"<short location, e.g. hero, top nav, pricing cards>","detail":"<one sentence a developer can act on>"}]}
Return {"defects":[]} when the screens look correct.`;

type RawDefect = { kind?: unknown; where?: unknown; detail?: unknown };

/**
 * Pick a representative spread of shots instead of the first N.
 *
 * The builder captures route-major, width-minor, so a naive `slice(0, 4)`
 * would hand the reviewer four phone screenshots of the same two pages and
 * nothing else. Round-robin across widths first, then routes, so every screen
 * size and as many distinct pages as possible get reviewed.
 */
export function pickShotSpread(shots: VisualShot[], max: number): VisualShot[] {
  const valid = shots.filter((s) => s && typeof s.image === "string" && s.image.startsWith("data:image/"));
  if (valid.length <= max) return valid;

  const byWidth = new Map<number, VisualShot[]>();
  for (const s of valid) {
    const list = byWidth.get(s.width);
    if (list) list.push(s);
    else byWidth.set(s.width, [s]);
  }
  const widths = Array.from(byWidth.keys()).sort((a, b) => a - b);
  const out: VisualShot[] = [];
  for (let i = 0; out.length < max; i++) {
    let progressed = false;
    for (const w of widths) {
      const pick = byWidth.get(w)![i];
      if (!pick) continue;
      progressed = true;
      out.push(pick);
      if (out.length >= max) break;
    }
    if (!progressed) break;
  }
  return out;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function parseVisualDefects(content: string, shots: VisualShot[]): string[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { defects?: unknown })?.defects;
  if (!Array.isArray(list)) return [];

  const widths = Array.from(new Set(shots.map((s) => s.width))).sort((a, b) => a - b);
  const scope = widths.length ? `at ${widths.join("px / ")}px` : "";

  const out: string[] = [];
  for (const item of list as RawDefect[]) {
    const kind = str(item?.kind, 40).toLowerCase();
    if (!ALLOWED_KINDS.has(kind)) continue;
    const detail = str(item?.detail, 240);
    if (!detail) continue;
    const where = str(item?.where, 60);
    out.push(
      `Visual QA (${kind})${where ? ` — ${where}` : ""} ${scope}: ${detail}`.replace(/\s+/g, " ").trim(),
    );
  }
  return Array.from(new Set(out)).slice(0, MAX_DEFECTS);
}

/**
 * Score deployed screenshots and return defect strings for the repair loop.
 * Returns [] on any failure.
 */
export async function scoreVisualQA(args: {
  shots: VisualShot[];
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<string[]> {
  const shots = pickShotSpread(args.shots ?? [], MAX_SHOTS);
  if (shots.length === 0) return [];

  const content: unknown[] = [
    {
      type: "text",
      text: `Review these ${shots.length} screenshots of one app: ${shots
        .map((s) => `${s.path} at ${s.width}px`)
        .join(
          ", ",
        )}. Shots under 700px are phones — judge them by mobile standards. Shots between 700px and 1100px are tablets: check that desktop grids have actually reflowed and that nothing is stretched or orphaned at that width. Shots above 1100px are desktop.`,
    },
  ];
  for (const s of shots) {
    content.push({ type: "text", text: `Screenshot: ${s.path} @ ${s.width}px` });
    content.push({ type: "image_url", image_url: { url: s.image } });
  }

  try {
    const res = await aiChatCompletions({
      feature: "design",
      budgetAware: true,
      body: {
        model: MODEL,
        temperature: 0,
        max_tokens: 700,
        messages: [
          { role: "system", content: RULES },
          { role: "user", content },
        ],
      },
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "visual-qa",
        hadAttachments: true,
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return parseVisualDefects(text, shots);
  } catch {
    return [];
  }
}
