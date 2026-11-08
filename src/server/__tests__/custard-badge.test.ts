import { describe, expect, it } from "vitest";
import { injectPetalBadge } from "@/server/petal-badge.server";
import { COMPOSITION_RULES } from "@/server/engine/first-build";

describe("Custard AI badge and image rules", () => {
  it("badge says Powered by Custard AI, sits bottom-left and links to custardai.dev", () => {
    const [f] = injectPetalBadge([{ path: "index.html", content: "<html><body></body></html>" }]);
    expect(f.content).toContain("'Powered by '");
    expect(f.content).toContain("strong.textContent = 'Custard AI';");
    expect(f.content).toContain("'Powered by Custard AI'");
    expect(f.content).toContain("'left:14px','bottom:14px'");
    expect(f.content).not.toContain("right:14px");
    expect(f.content).not.toContain("Built with");
    expect(f.content).toContain("https://custardai.dev");
    expect(f.content).not.toContain("kimble.cloud");
  });
  it("first builds are told to use the image tool, never fake pictures", () => {
    expect(COMPOSITION_RULES).toContain("petal-image://");
    expect(COMPOSITION_RULES).toContain("Never write data:image");
  });
});
