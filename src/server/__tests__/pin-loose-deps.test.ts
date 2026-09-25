import { expect, it } from "vitest";
import { pinLooseDeps } from "@/server/pin-loose-deps";
it("pins loose", () => {
  const [f] = pinLooseDeps([{ path: "package.json", content: JSON.stringify({ dependencies: { "framer-motion": "*", react: "^18.3.1", foo: "*" } }) }]);
  const d = JSON.parse(f.content).dependencies;
  expect(d["framer-motion"]).toBe("^11.18.0"); expect(d.react).toBe("^18.3.1"); expect(d.foo).toBe("*");
});
