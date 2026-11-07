/**
 * Live Aura rebuild (7 Nov 2026): eight project cards got only two pictures.
 * Six distinct requests ("museum gallery", "rare books pavilion", "hotel
 * courtyard"…) were matched to a spa photo and a pool-house photo made for a
 * DIFFERENT project, because one shared word ("dark") cleared the match bar,
 * and the shared Custard account made every customer's pictures "the same
 * owner's". These checks pin the fixes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUserById = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => from(t), auth: { admin: { getUserById: (id: string) => getUserById(id) } } },
}));

import { fitsRequest, findRememberedPicture } from "../generated-pictures.server";
import { tokenize } from "../pictures.server";

const SPA = {
  id: "spa",
  url: "https://x/storage/v1/object/public/petal-images/spa.png",
  subject: "luxury-dark-basalt-stone-thermal-spa-interior-at-night-amber-underwater-architectural-lighting-steam-shadows",
  tags: ["luxury", "dark", "basalt", "stone", "thermal", "spa", "interior", "night", "amber", "underwater", "architectural", "lighting"],
  style: "photography",
  mood: "dark",
  aspect_ratio: "",
  orientation: "",
  shared: false,
  project_id: "other-project",
  owner_id: "owner",
};

function rows(list: unknown[]) {
  return () => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.eq = chain;
    b.order = chain;
    b.limit = () => Promise.resolve({ data: list, error: null });
    return b;
  };
}

beforeEach(() => {
  from.mockReset();
  getUserById.mockReset();
  getUserById.mockResolvedValue({ data: { user: { id: "owner", email: "a@b.c", user_metadata: {} } }, error: null });
});

describe("a picture slot only reuses a picture of the same thing", () => {
  it("rejects a spa photo for a museum books pavilion (two shared words)", () => {
    const words = tokenize("dark-timber-and-cast-bronze-rare-books-pavilion-precision-museum-track-spotlights-low-glare-conservation-lighting");
    expect(fitsRequest(SPA, words, "slot")).toBe(false);
  });

  it("accepts a near-identical request", () => {
    const words = tokenize("luxury dark basalt stone thermal spa interior at night amber underwater lighting");
    expect(fitsRequest(SPA, words, "slot")).toBe(true);
  });

  it("never reuses a picture already used elsewhere in the same build", async () => {
    from.mockImplementation(rows([{ ...SPA, project_id: "p1" }]));
    const hit = await findRememberedPicture({
      request: "luxury dark basalt stone thermal spa interior at night amber underwater lighting",
      scope: { projectId: "p1", ownerId: "owner" },
      exclude: new Set([SPA.url]),
    });
    expect(hit).toBeNull();
  });
});

describe("the shared Custard account never shares pictures between customers", () => {
  it("does not reuse a picture from another project of the service account", async () => {
    getUserById.mockResolvedValue({
      data: { user: { id: "svc", email: "service@custardai.dev", user_metadata: { service_account: true } } },
      error: null,
    });
    from.mockImplementation(rows([{ ...SPA, owner_id: "svc" }]));
    const hit = await findRememberedPicture({
      request: "luxury dark basalt stone thermal spa interior at night amber underwater lighting",
      scope: { projectId: "new-customer-project", ownerId: "svc" },
    });
    expect(hit).toBeNull();
  });

  it("still reuses across a normal person's own projects", async () => {
    from.mockImplementation(rows([SPA]));
    const hit = await findRememberedPicture({
      request: "luxury dark basalt stone thermal spa interior at night amber underwater lighting",
      scope: { projectId: "another-of-mine", ownerId: "owner" },
    });
    expect(hit?.url).toBe(SPA.url);
  });
});
