/**
 * Site-visitor accounts beyond email + password, for Petal-built sites on the
 * shared (or mirrored dedicated) backend: password reset by email, signed-in
 * password change, and Google sign-in through Petal's own Google app.
 *
 * Secrets only ever travel to addresses on the requesting site's own hosts
 * (`isSiteAddress`), inside the URL #fragment.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { storeFor } from "@/server/project-store.server";
import { hashPassword, issueUserToken } from "@/server/shared-backend.server";
import { DEFAULT_PUBLIC_ORIGIN } from "@/server/public-origin";
import {
  RESET_RULES,
  isSiteAddress,
  pagesProjectName,
  withFragment,
  type SiteHosts,
} from "@/server/shared-auth-rules";

type Visitor = { id: string; email: string; displayName: string | null };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function siteHosts(projectId: string): Promise<SiteHosts> {
  const [{ data: project }, { data: domains }] = await Promise.all([
    supabaseAdmin.from("projects").select("subdomain").eq("id", projectId).maybeSingle(),
    supabaseAdmin.from("project_domains").select("hostname, status").eq("project_id", projectId),
  ]);
  return {
    subdomain: (project?.subdomain as string | null) ?? null,
    pagesProject: pagesProjectName(projectId),
    domains: (domains ?? []).filter((d) => d.status === "active").map((d) => String(d.hostname)),
  };
}

export async function isAllowedSiteAddress(projectId: string, raw: string): Promise<boolean> {
  return isSiteAddress(raw, await siteHosts(projectId));
}

async function siteName(projectId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("site_title, title")
    .eq("id", projectId)
    .maybeSingle();
  return String(data?.site_title || data?.title || "your account").slice(0, 80);
}

async function findVisitorByEmail(projectId: string, email: string): Promise<Visitor | null> {
  const store = await storeFor(projectId);
  const { data } = await store.client
    .from(store.users)
    .select("id, email, display_name")
    .eq("project_id", projectId)
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return data ? { id: data.id as string, email: data.email as string, displayName: (data.display_name as string | null) ?? null } : null;
}

async function setPassword(projectId: string, userId: string, password: string): Promise<Visitor | null> {
  const store = await storeFor(projectId);
  const { data, error } = await store.client
    .from(store.users)
    .update({ password_hash: await hashPassword(password), updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("id", userId)
    .select("id, email, display_name")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id as string, email: data.email as string, displayName: (data.display_name as string | null) ?? null } : null;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function sendResetEmail(to: string, site: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !fromAddr) throw new Error("email_not_configured");
  const bare = fromAddr.match(/<([^>]+)>/)?.[1] ?? fromAddr;
  const name = site.replace(/["<>\r\n]/g, "");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${name} <${bare}>`,
      to: [to],
      subject: `Reset your ${name} password`,
      text: `Someone asked to reset the password for your ${name} account.\n\nChoose a new password here (the link works once, for one hour):\n${link}\n\nIf this wasn't you, ignore this email — your password stays the same.`,
      html: `<p>Someone asked to reset the password for your <strong>${escapeHtml(name)}</strong> account.</p><p><a href="${escapeHtml(link)}">Choose a new password</a></p><p style="color:#666">The link works once, for one hour. If this wasn't you, ignore this email — your password stays the same.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`email_send_failed_${res.status}`);
}

/**
 * Ask for a reset email. Always resolves the same way whether or not the
 * account exists, so the form never reveals who has an account.
 */
export async function requestPasswordReset(opts: {
  projectId: string;
  email: string;
  redirectTo: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!(await isAllowedSiteAddress(opts.projectId, opts.redirectTo))) {
    return { ok: false, error: "redirectTo must be a page on this site", status: 400 };
  }
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: projectCount } = await supabaseAdmin
    .from("shared_app_password_resets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", opts.projectId)
    .gte("created_at", hourAgo);
  if ((projectCount ?? 0) >= RESET_RULES.perProjectPerHour) {
    return { ok: false, error: "Too many reset requests. Please try again later.", status: 429 };
  }
  const visitor = await findVisitorByEmail(opts.projectId, opts.email);
  if (!visitor) return { ok: true };
  const { count: userCount } = await supabaseAdmin
    .from("shared_app_password_resets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", opts.projectId)
    .eq("user_id", visitor.id)
    .gte("created_at", hourAgo);
  if ((userCount ?? 0) >= RESET_RULES.perUserPerHour) return { ok: true };

  const token = randomToken();
  const { error } = await supabaseAdmin.from("shared_app_password_resets").insert({
    project_id: opts.projectId,
    user_id: visitor.id,
    token_hash: await sha256(token),
    expires_at: new Date(Date.now() + RESET_RULES.ttlMs).toISOString(),
  });
  if (error) throw new Error(error.message);
  await sendResetEmail(visitor.email, await siteName(opts.projectId), withFragment(opts.redirectTo, "petal_reset", token));
  return { ok: true };
}

/** Use a reset link: sets the new password, retires every open link, signs the visitor in. */
export async function confirmPasswordReset(opts: {
  projectId: string;
  token: string;
  password: string;
}): Promise<{ user: Visitor; token: string } | null> {
  const tokenHash = await sha256(opts.token);
  const now = new Date().toISOString();
  // Claim atomically: only one request can use a link.
  const { data: claimed } = await supabaseAdmin
    .from("shared_app_password_resets")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .eq("project_id", opts.projectId)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id")
    .maybeSingle();
  if (!claimed) return null;
  const userId = claimed.user_id as string;
  const user = await setPassword(opts.projectId, userId, opts.password);
  if (!user) return null;
  await supabaseAdmin
    .from("shared_app_password_resets")
    .update({ used_at: now })
    .eq("project_id", opts.projectId)
    .eq("user_id", userId)
    .is("used_at", null);
  return { user, token: await issueUserToken(opts.projectId, userId) };
}

/** Signed-in password change. */
export async function changePassword(projectId: string, userId: string, password: string): Promise<Visitor | null> {
  return setPassword(projectId, userId, password);
}

/* ---------------- Google sign-in ---------------- */

export function googleCallbackUrl(): string {
  const base = (process.env.PETAL_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, "");
  return `${base}/api/public/shared-oauth/google/callback`;
}

/** Find the visitor with this Google-verified email, or create their account. */
export async function visitorForGoogle(opts: {
  projectId: string;
  email: string;
  name: string | null;
}): Promise<Visitor> {
  const existing = await findVisitorByEmail(opts.projectId, opts.email);
  if (existing) return existing;
  const store = await storeFor(opts.projectId);
  // Google accounts get an unguessable password; "Forgot password" can set a real one.
  const { data, error } = await store.client
    .from(store.users)
    .insert({
      project_id: opts.projectId,
      email: opts.email.toLowerCase(),
      password_hash: await hashPassword(randomToken(32)),
      display_name: opts.name,
    })
    .select("id, email, display_name")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await findVisitorByEmail(opts.projectId, opts.email);
      if (again) return again;
    }
    throw new Error(error.message);
  }
  return { id: data.id as string, email: data.email as string, displayName: (data.display_name as string | null) ?? null };
}
