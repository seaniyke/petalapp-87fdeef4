/**
 * Live Preview Share — create shareable preview links and read comments.
 *
 * Comments are anchored to a CSS selector + viewport-relative coordinates so
 * the share page can pin a sticky-note exactly where the visitor clicked.
 */
import { supabase } from "@/integrations/supabase/client";

export type PreviewShare = {
  id: string;
  project_id: string;
  token: string;
  created_by: string;
  allow_comments: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type PreviewComment = {
  id: string;
  share_id: string;
  project_id: string;
  page_path: string;
  selector: string | null;
  x_pct: number | null;
  y_pct: number | null;
  body: string;
  viewport_width: number | null;
  author_name: string | null;
  status: "open" | "resolved";
  resolved_at: string | null;
  created_at: string;
};

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

export async function getOrCreateShareForProject(
  projectId: string,
  userId: string,
): Promise<PreviewShare> {
  const { data: existing } = await supabase
    .from("preview_shares")
    .select("*")
    .eq("project_id", projectId)
    .eq("created_by", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as PreviewShare;

  const { data, error } = await supabase
    .from("preview_shares")
    .insert({
      project_id: projectId,
      created_by: userId,
      token: randomToken(),
      allow_comments: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PreviewShare;
}

export async function rotateShareToken(shareId: string): Promise<PreviewShare> {
  const { data, error } = await supabase
    .from("preview_shares")
    .update({ token: randomToken() })
    .eq("id", shareId)
    .select()
    .single();
  if (error) throw error;
  return data as PreviewShare;
}

export async function setShareCommentsEnabled(
  shareId: string,
  allow: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("preview_shares")
    .update({ allow_comments: allow })
    .eq("id", shareId);
  if (error) throw error;
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase
    .from("preview_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId);
  if (error) throw error;
}

export async function getShareByToken(token: string): Promise<PreviewShare | null> {
  const { data } = await supabase
    .from("preview_shares")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return (data as PreviewShare) ?? null;
}

export async function listProjectComments(
  projectId: string,
): Promise<PreviewComment[]> {
  const { data } = await supabase
    .from("preview_comments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data as PreviewComment[]) ?? [];
}

export async function postComment(input: {
  shareId: string;
  projectId: string;
  pagePath: string;
  selector: string | null;
  xPct: number | null;
  yPct: number | null;
  body: string;
  viewportWidth: number | null;
  authorName: string | null;
}): Promise<PreviewComment> {
  const { data, error } = await supabase
    .from("preview_comments")
    .insert({
      share_id: input.shareId,
      project_id: input.projectId,
      page_path: input.pagePath,
      selector: input.selector,
      x_pct: input.xPct,
      y_pct: input.yPct,
      body: input.body.slice(0, 2000),
      viewport_width: input.viewportWidth,
      author_name: input.authorName?.slice(0, 80) ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PreviewComment;
}

export async function resolveComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from("preview_comments")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) throw error;
}

export function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}
