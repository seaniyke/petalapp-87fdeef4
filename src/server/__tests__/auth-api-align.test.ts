import { describe, expect, it } from "vitest";
import { alignAuthApi, availableAuthHelpers } from "../auth-api-align.server";

const sharedKit = {
  path: "src/integrations/backend/client.ts",
  content: `export const auth = {
  async signUp(email: string, password: string) { return null; },
  async signIn(email: string, password: string) { return null; },
  async me() { return null; },
  signOut() {},
};`,
};

const parityKit = {
  path: "src/integrations/backend/client.ts",
  content: `export const auth = {
  async signIn(email: string, password: string) { return null; },
  async signInWithPassword(email: string, password: string) { return null; },
  async signUpWithPassword(email: string, password: string) { return null; },
  signOut() {},
};`,
};

describe("auth api alignment", () => {
  it("reads the helper names the installed kit exposes", () => {
    const names = availableAuthHelpers([sharedKit]);
    expect(names.has("signIn")).toBe(true);
    expect(names.has("signInWithPassword")).toBe(false);
  });

  it("rewrites a call the shared kit does not expose", () => {
    const page = {
      path: "src/pages/SignIn.tsx",
      content: `const { error } = await auth.signInWithPassword(email, password);`,
    };
    const out = alignAuthApi([sharedKit, page]);
    const fixed = out.files.find((f) => f.path === page.path)!;
    expect(fixed.content).toContain("auth.signIn(email, password)");
    expect(out.notes.length).toBe(1);
  });

  it("leaves valid calls untouched and is idempotent", () => {
    const page = {
      path: "src/pages/SignIn.tsx",
      content: `await auth.signInWithPassword(email, password);\nawait auth.signOut();`,
    };
    const once = alignAuthApi([parityKit, page]);
    expect(once.notes).toEqual([]);
    const twice = alignAuthApi(once.files);
    expect(twice.files[1].content).toBe(page.content);
  });

  it("maps invented names like login/logout/register", () => {
    const page = {
      path: "src/pages/Auth.tsx",
      content: `await auth.login(e, p);\nawait auth.register(e, p);\nauth.logout();`,
    };
    const out = alignAuthApi([parityKit, page]);
    const fixed = out.files.find((f) => f.path === page.path)!;
    expect(fixed.content).toContain("auth.signInWithPassword(e, p)");
    expect(fixed.content).toContain("auth.signUpWithPassword(e, p)");
    expect(fixed.content).toContain("auth.signOut()");
  });

  it("never touches supabase.auth.*", () => {
    const page = {
      path: "src/pages/Auth.tsx",
      content: `await supabase.auth.signInWithOtp({ email });`,
    };
    const out = alignAuthApi([sharedKit, page]);
    expect(out.notes).toEqual([]);
  });

  it("does nothing when no backend kit is installed", () => {
    const page = { path: "src/pages/A.tsx", content: `await auth.login(e, p);` };
    expect(alignAuthApi([page]).notes).toEqual([]);
  });
});
