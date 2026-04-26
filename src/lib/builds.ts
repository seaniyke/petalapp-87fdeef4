import { supabase } from "@/integrations/supabase/client";

/**
 * Kick off a Cloudflare Pages build for the given project. Authenticated
 * via the user's Supabase access token (passed as a Bearer header — same
 * pattern as `streamGenerate`). Resolves once the server has accepted the
 * request and inserted the `pending` build row; the actual build runs
 * async on Railway and reports back via the callback webhook.
 */
export async function triggerBuild(projectId: string): Promise<{
  buildId: string;
  status: "pending" | "failed";
}> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const resp = await fetch("/api/builds/trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ projectId }),
  });

  let payload: unknown = null;
  try {
    payload = await resp.json();
  } catch {
    /* fall through */
  }

  if (!resp.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload &&
        typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : null) ?? `Build trigger failed (${resp.status})`;
    throw new Error(message);
  }

  return payload as { buildId: string; status: "pending" | "failed" };
}
