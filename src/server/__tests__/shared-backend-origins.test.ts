import { describe, expect, it } from "vitest";
import { sharedBackendKit } from "@/server/shared-backend-kit";

describe("shared backend client", () => {
  const files = sharedBackendKit({
    projectId: "p1",
    apiKey: "petal_pk_test",
    baseUrl: "https://primary.example",
    fallbackUrls: ["https://backup.example", "https://primary.example/"],
  });
  const client = files.find((f) => f.path === "src/integrations/backend/client.ts")!;

  it("bakes the key and every origin into the app", () => {
    expect(client.content).toContain("petal_pk_test");
    expect(client.content).toContain("https://primary.example/api/public/shared/p1");
    expect(client.content).toContain("https://backup.example/api/public/shared/p1");
  });

  it("does not repeat an origin", () => {
    const matches = client.content.match(/https:\/\/primary\.example\/api/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("falls through to a backup only on an outage, not on a real answer", () => {
    expect(client.content).toContain("RETRY_STATUS");
    expect(client.content).toContain("rememberBase(base)");
  });
});
