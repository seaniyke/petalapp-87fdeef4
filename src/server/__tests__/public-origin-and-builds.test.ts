import { describe, expect, it } from "vitest";
import { trustedAppOrigin } from "@/server/public-origin";
import { toPublicBuild } from "@/server/service-api.server";

describe("build server callback origin", () => {
  it("keeps a public https origin", () => {
    expect(trustedAppOrigin("https://petalapp.lovable.app/api/generate", {})).toBe("https://petalapp.lovable.app");
  });
  it("never hands localhost or private addresses to the build server", () => {
    expect(trustedAppOrigin("http://localhost:8080/api/generate", {})).toBe("https://petalapp.lovable.app");
    expect(trustedAppOrigin("https://127.0.0.1/api/generate", {})).toBe("https://petalapp.lovable.app");
    expect(trustedAppOrigin("https://192.168.1.5/api/generate", {})).toBe("https://petalapp.lovable.app");
  });
  it("uses PETAL_PUBLIC_ORIGIN as the fallback when set", () => {
    expect(trustedAppOrigin("http://localhost:8080/x", { PETAL_PUBLIC_ORIGIN: "https://engine.example.com/" })).toBe(
      "https://engine.example.com",
    );
  });
});

describe("public build view", () => {
  const row = {
    id: "b1",
    status: "ready",
    project_revision: 7,
    turn_id: "t1",
    dist_path: "https://petal-abc.pages.dev",
    deployed: true,
    progress_label: null,
    error_message: null,
    created_at: "2026-11-07T00:00:00Z",
    ready_at: "2026-11-07T00:02:00Z",
  };
  it("exposes the live address only for a ready build", () => {
    expect(toPublicBuild(row).deploymentUrl).toBe("https://petal-abc.pages.dev");
    expect(toPublicBuild({ ...row, status: "building" }).deploymentUrl).toBeNull();
  });
  it("reports the error only for a failed build", () => {
    expect(toPublicBuild({ ...row, status: "failed", error_message: "compile error" }).error).toBe("compile error");
    expect(toPublicBuild({ ...row, error_message: "old" }).error).toBeNull();
  });
});
