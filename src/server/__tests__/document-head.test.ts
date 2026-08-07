import { describe, it, expect } from "vitest";
import { reconcileDocumentHeadOps, readHeadIntent, applyHeadIntent } from "../document-head.server";
import { applyOpsPartial, type FileOp, type ProjectFile } from "../generate.server";

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Old title</title>
    <meta name="description" content="old" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
    <script>window.__petalPreviewGuardVersion = 7;</script>
  </body>
</html>`;

const files = (): ProjectFile[] => [
  { path: "index.html", content: SHELL },
  { path: "src/App.tsx", content: "export default () => null;" },
];

describe("document head reconciliation (A1)", () => {
  it("absorbs an index.html replace op that could never have matched", () => {
    const ops: FileOp[] = [
      {
        op: "replace",
        path: "index.html",
        search: "<title>Something the model imagined</title>",
        replace: `<title>Stayora — book a stay</title>\n<meta name="description" content="Find rooms fast." />`,
      },
    ];
    const out = reconcileDocumentHeadOps(files(), ops);
    expect(out.handled).toBe(1);
    expect(out.ops).toHaveLength(0);
    const html = out.files[0].content;
    expect(html).toContain("<title>Stayora — book a stay</title>");
    expect(html).toContain('content="Find rooms fast."');
    expect(html).not.toContain('content="old"');
    // Machine-owned markup survives untouched.
    expect(html).toContain("__petalPreviewGuardVersion");
    expect(html).toContain('<div id="root">');
  });

  it("never lets an index.html op reach the text patcher", () => {
    const ops: FileOp[] = [
      { op: "replace", path: "index.html", search: "nope", replace: "<title>New</title>" },
      { op: "replace", path: "src/App.tsx", search: "null", replace: "<div />" },
    ];
    const out = reconcileDocumentHeadOps(files(), ops);
    const applied = applyOpsPartial(out.files, out.ops);
    expect(applied.failed).toHaveLength(0);
  });

  it("merges a full-document update without clobbering the body", () => {
    const ops: FileOp[] = [
      {
        op: "update",
        path: "index.html",
        content: `<!doctype html><html lang="fr" class="dark"><head><title>Nouveau</title><link rel="icon" href="data:image/svg+xml,<svg/>" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora" /></head><body><div id="root"></div></body></html>`,
      },
    ];
    const out = reconcileDocumentHeadOps(files(), ops);
    const html = out.files[0].content;
    expect(html).toContain("<title>Nouveau</title>");
    expect(html).toContain('lang="fr"');
    expect(html).toContain('class="dark"');
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("__petalPreviewGuardVersion");
    expect(html).toContain("/src/main.tsx");
  });

  it("drops head-less index.html edits instead of failing the turn", () => {
    const ops: FileOp[] = [
      { op: "replace", path: "index.html", search: "<div id=\"root\"></div>", replace: "<div id=\"app\"></div>" },
    ];
    const out = reconcileDocumentHeadOps(files(), ops);
    expect(out.ops).toHaveLength(0);
    expect(out.files[0].content).toContain('<div id="root">');
    expect(out.notes.join(" ")).toMatch(/managed by Petal/);
  });

  it("is idempotent", () => {
    const intent = readHeadIntent(`<title>Same</title><meta name="description" content="x" />`);
    const once = applyHeadIntent(SHELL, intent).html;
    const twice = applyHeadIntent(once, intent).html;
    expect(twice).toBe(once);
  });

  it("ignores script/module preloads and local stylesheets", () => {
    const intent = readHeadIntent(
      `<link rel="modulepreload" href="/x.js" /><link rel="stylesheet" href="/src/index.css" />`,
    );
    expect(intent.links.size).toBe(0);
  });

  it("leaves projects with no index.html alone", () => {
    const rn: ProjectFile[] = [{ path: "App.tsx", content: "x" }];
    const out = reconcileDocumentHeadOps(rn, [{ op: "update", path: "App.tsx", content: "y" }]);
    expect(out.handled).toBe(0);
    expect(out.ops).toHaveLength(1);
  });
});

describe("replace-op ambiguity ladder (A2)", () => {
  const src = `const a = "Book now, pay later";\nconst b = "Book now, pay later";\n`;

  it("applies a repeated snippet to every occurrence instead of failing", () => {
    const out = applyOpsPartial([{ path: "src/a.ts", content: src }], [
      { op: "replace", path: "src/a.ts", search: '"Book now, pay later"', replace: '"Reserve"' },
    ]);
    expect(out.failed).toHaveLength(0);
    expect(out.files[0].content).toBe(`const a = "Reserve";\nconst b = "Reserve";\n`);
  });


  it("still refuses a tiny ambiguous snippet", () => {
    const out = applyOpsPartial([{ path: "src/a.ts", content: "a;\na;\n" }], [
      { op: "replace", path: "src/a.ts", search: "a;", replace: "b;" },
    ]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].error).toMatch(/exactly one place/);
  });

  it("treats an already-applied edit as a no-op", () => {
    const done = `const a = "Reserve now, pay later";\n`;
    const out = applyOpsPartial([{ path: "src/a.ts", content: done }], [
      { op: "replace", path: "src/a.ts", search: '"Book now, pay later"', replace: '"Reserve now, pay later"' },
    ]);
    expect(out.failed).toHaveLength(0);
    expect(out.files[0].content).toBe(done);
  });
});
