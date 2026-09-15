/**
 * Craft QA (Engine 3.0, phase 5).
 *
 * `visual-qa.server.ts` answers "is this broken?" — overlap, clipping, blank
 * heroes. This pass answers the question users actually complain about: "does
 * this look like a designed product, or like AI output?" It reviews the same
 * deployed screenshots against the committed design system contract (the one
 * the PIC authored before any code was written) and reports craft defects:
 * a hero with no composition, one flat section rhythm, default-looking type,
 * palette drift, cards with no hierarchy.
 *
 * Hard rules, same as every other quality gate:
 *  - Never throws. A missing opinion is not a build failure.
 *  - Craft findings are ADVISORY by construction: they are prefixed so the
 *    severity judge routes them as polish, never as a rollback reason. A
 *    slightly plain page must never take a working app offline.
 *  - Off switch: PETAL_CRAFT_QA=0.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";
import { pickShotSpread, type VisualShot } from "@/server/visual-qa.server";

const MODEL = "google/gemini-2.5-flash";
const MAX_SHOTS = 6;
const MAX_DEFECTS = 6;

/** Craft categories. Anything outside this list is dropped as taste. */
const ALLOWED_KINDS = new Set([
  "flat-hero",
  "no-hierarchy",
  "default-type",
  "palette-drift",
  "uniform-rhythm",
  "empty-space",
  "unstyled-control",
  "placeholder-content",
  "generic-layout",
]);

const RULES = `You are Petal's craft reviewer. You are shown screenshots of a freshly generated app that shipped WITHOUT crashes — your job is judging whether it looks designed.

Report a craft defect only when the screenshot proves it:
- flat-hero: the first screen is a centered headline + paragraph + button with no imagery, product visual, layered composition or depth
- no-hierarchy: everything on screen has near-identical size and weight, so nothing leads
- default-type: type looks like an unstyled system/default sans at one size, with no display face or scale contrast
- palette-drift: the screen uses greys/blues that do not match the committed palette, or the accent colour never appears
- uniform-rhythm: every section is the same height and layout (stacked equal blocks), no variation in composition
- empty-space: a section is mostly blank because content was never filled in
- unstyled-control: a button/input/card renders with browser-default styling
- placeholder-content: lorem ipsum, "Feature one/two/three", "Your text here", obvious dummy copy
- generic-layout: the page is an interchangeable template with nothing specific to the product

Never report: personal colour taste, "could be more modern", anything about behaviour, anything you cannot see.
If the app genuinely looks designed, say so with an empty list — do NOT invent findings.

Respond with JSON only:
{"defects":[{"kind":"<one of the kinds above>","where":"<short location>","fix":"<one concrete change a developer can make>"}]}`;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function craftQaEnabled(): boolean {
  const raw = process.env["PETAL_CRAFT_QA"];
  if (raw == null || raw === "") return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

export function parseCraftDefects(content: string): string[] {
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

  const out: string[] = [];
  for (const raw of list) {
    const item = raw as { kind?: unknown; where?: unknown; fix?: unknown };
    const kind = str(item?.kind, 40).toLowerCase();
    if (!ALLOWED_KINDS.has(kind)) continue;
    const fix = str(item?.fix, 240);
    if (!fix) continue;
    const where = str(item?.where, 60);
    // The "Craft QA" prefix is load-bearing: the severity judge treats craft
    // findings as polish, so they queue a follow-up pass instead of failing
    // a healthy deploy.
    out.push(`Craft QA (${kind})${where ? ` — ${where}` : ""}: ${fix}`);
  }
  return Array.from(new Set(out)).slice(0, MAX_DEFECTS);
}

/** Short description of the committed design contract, for the reviewer. */
export interface CraftContract {
  productName?: string | null;
  summary?: string | null;
  palette?: string[] | null;
  typography?: string | null;
  personality?: string | null;
}

function contractBlock(contract?: CraftContract | null): string {
  if (!contract) return "No design contract was recorded — judge against general craft standards.";
  const lines = [
    contract.productName ? `Product: ${contract.productName}` : "",
    contract.summary ? `What it is: ${contract.summary}` : "",
    contract.palette?.length ? `Committed palette: ${contract.palette.slice(0, 8).join(", ")}` : "",
    contract.typography ? `Committed typography: ${contract.typography}` : "",
    contract.personality ? `Intended personality: ${contract.personality}` : "",
  ].filter(Boolean);
  return lines.length
    ? `COMMITTED DESIGN CONTRACT (the app was supposed to look like this):\n${lines.join("\n")}`
    : "No design contract was recorded — judge against general craft standards.";
}

/**
 * Score deployed screenshots for craft. Returns advisory defect strings for
 * the polish pass; [] on any failure.
 */
export async function scoreCraftQA(args: {
  shots: VisualShot[];
  contract?: CraftContract | null;
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (!craftQaEnabled()) return [];
  const shots = pickShotSpread(args.shots ?? [], MAX_SHOTS);
  if (shots.length === 0) return [];

  const content: unknown[] = [
    {
      type: "text",
      text: `${contractBlock(args.contract)}\n\nReview these ${shots.length} screenshots of one app.`,
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
        max_tokens: 600,
        messages: [
          { role: "system", content: RULES },
          { role: "user", content },
        ],
      },
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "craft-qa",
        hadAttachments: true,
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseCraftDefects(json.choices?.[0]?.message?.content ?? "");
  } catch {
    return [];
  }
}
