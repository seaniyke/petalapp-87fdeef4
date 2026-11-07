import { describe, expect, it, afterEach } from "vitest";
import { injectCustardWidget } from "@/server/custard-widget.server";
import { previewFields, serviceKey } from "@/server/service-api.server";

describe("Custard AI contract", () => {
  afterEach(() => {
    delete process.env.PETAL_API_KEY;
  });

  it("puts the staff widget right before </body>, once", () => {
    const files = [{ path: "index.html", content: "<html><body><div id=root></div></body></html>" }];
    const once = injectCustardWidget(files);
    const twice = injectCustardWidget(once);
    const html = twice[0].content;
    expect(html).toContain('<script src="https://custardai.dev/widget.js" async></script>\n</body>');
    expect(html.match(/widget\.js/g)?.length).toBe(1);
  });

  it("exposes the live address under all three names", () => {
    expect(previewFields("https://x.pages.dev")).toEqual({
      previewUrl: "https://x.pages.dev",
      preview_url: "https://x.pages.dev",
      publishedUrl: "https://x.pages.dev",
    });
  });

  it("signs with PETAL_API_KEY when set", () => {
    process.env.PETAL_API_KEY = "petal-key";
    expect(serviceKey()).toBe("petal-key");
  });
});
