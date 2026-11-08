import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  custardWidgetTagForAgent,
  injectCustardWidget,
  parseCustardWidgetTag,
} from "@/server/custard-widget.server";
import { COMPOSITION_RULES } from "@/server/engine/first-build";

const AGENT = "3f2a9c1e-7b4d-4e0a-9c55-1d2e3f4a5b6c";
const page = (body = "<div id=root></div>") => [{ path: "index.html", content: `<html><body>${body}</body></html>` }];

describe("Custard widget keeps the AI staff member", () => {
  it("keeps data-agent from a tag pasted in the brief", () => {
    const tag = parseCustardWidgetTag(
      `Build a salon site. Embed: <script src="https://custardai.dev/widget.js" data-agent="${AGENT}" async></script>`,
    );
    expect(tag).toBe(`<script src="https://custardai.dev/widget.js" data-agent="${AGENT}" async></script>`);
  });

  it("keeps the ?agent= query", () => {
    const tag = parseCustardWidgetTag(`<script src="https://custardai.dev/widget.js?agent=${AGENT}" async></script>`);
    expect(tag).toBe(`<script src="https://custardai.dev/widget.js?agent=${AGENT}" async></script>`);
  });

  it("an agentId alone gives both forms", () => {
    expect(custardWidgetTagForAgent(AGENT)).toBe(
      `<script src="https://custardai.dev/widget.js?agent=${AGENT}" data-agent="${AGENT}" async></script>`,
    );
  });

  it("drops anything that is not data-* or a safe value", () => {
    const tag = parseCustardWidgetTag(
      `<script src="https://custardai.dev/widget.js" data-agent="${AGENT}" onload="alert(1)" data-x="a&quot;><img"></script>`,
    );
    expect(tag).toBe(`<script src="https://custardai.dev/widget.js" data-agent="${AGENT}" async></script>`);
    expect(parseCustardWidgetTag(`<script src="https://evil.dev/widget.js?x=custardai.dev/widget.js"></script>`)).toBeNull();
  });

  it("a bare tag is nothing to store", () => {
    expect(parseCustardWidgetTag(`<script src="https://custardai.dev/widget.js" async></script>`)).toBeNull();
  });

  it("the stored tag replaces a bare widget tag, once", () => {
    const tag = custardWidgetTagForAgent(AGENT)!;
    const bare = injectCustardWidget(page());
    const fixed = injectCustardWidget(injectCustardWidget(bare, tag), tag);
    const html = fixed[0].content;
    expect(html).toContain(`data-agent="${AGENT}"`);
    expect(html).toContain(`?agent=${AGENT}`);
    expect(html.match(/widget\.js/g)?.length).toBe(1);
  });

  it("without a stored tag, an existing widget tag keeps its attributes", () => {
    const own = `<script src="https://custardai.dev/widget.js" data-agent="${AGENT}" async></script>`;
    const out = injectCustardWidget(page(own));
    expect(out[0].content).toContain(`data-agent="${AGENT}"`);
    expect(out[0].content.match(/widget\.js/g)?.length).toBe(1);
  });
});

describe("Custard canvas and chat buttons", () => {
  it("local testing may embed published sites", () => {
    for (const file of ["builder/src/build.ts", "subdomain-worker/src/index.js"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("http://localhost:*");
      expect(src).toContain("http://127.0.0.1:*");
    }
  });

  it("chat-led sites open the Custard chat from their booking buttons", () => {
    expect(COMPOSITION_RULES).toContain("window.CustardWidget.open()");
    expect(COMPOSITION_RULES).toContain("Never add the chat widget <script> tag yourself");
  });
});
