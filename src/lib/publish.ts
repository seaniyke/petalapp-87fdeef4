/**
 * Client helper for the `/api/publish` route — pin the latest build as
 * the project's "published" build and/or change visibility.
 *
 * See `src/routes/api/publish.ts` for the full server-side contract.
 */
import { supabase } from "@/integrations/supabase/client";

export type PublishVisibility = "public" | "private" | "unpublished";

export type PublishResult = {
  ok: true;
  project: {
    id: string;
    published_build_id: string | null;
    published_visibility: string;
    published_at: string | null;
    latest_build_id: string | null;
  };
};

export async function publishProject(input: {
  projectId: string;
  /** When omitted, publish keeps current visibility (or flips first-time
   *  unpublished projects to `public`). Pass to override. */
  visibility?: PublishVisibility;
  /** Default true — pin the latest ready build as the published build. Set
   *  to false when you only want to change visibility (e.g. "Unpublish"). */
  pinLatestBuild?: boolean;
}): Promise<PublishResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const resp = await fetch("/api/publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      projectId: input.projectId,
      visibility: input.visibility,
      pinLatestBuild: input.pinLatestBuild ?? true,
    }),
  });

  let payload: unknown = null;
  try {
    payload = await resp.json();
  } catch {
    /* fall through */
  }

  if (!resp.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Publish failed (${resp.status})`;
    throw new Error(message);
  }

  return payload as PublishResult;
}
