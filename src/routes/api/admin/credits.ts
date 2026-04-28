/**
 * Admin API: grant or deduct credits for any user.
 *
 * POST { action: "grant", target_user_id, amount, note? }
 *   - amount can be negative to deduct
 * POST { action: "lookup", query }
 *   - search users by email or id; returns up to 20 matches
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

async function assertAdmin(userId: string): Promise<Response | null> {
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/admin/credits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userIdOrResp = await authorize(request);
        if (userIdOrResp instanceof Response) return userIdOrResp;
        const adminId = userIdOrResp;
        const denied = await assertAdmin(adminId);
        if (denied) return denied;

        let body: { action?: string; [k: string]: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        try {
          if (body.action === "lookup") {
            const q = String(body.query ?? "").trim();
            if (q.length < 2) return Response.json({ users: [] });

            // Pull a page of users via admin auth; filter client-side by email.
            const { data, error } = await supabaseAdmin.auth.admin.listUsers({
              page: 1,
              perPage: 200,
            });
            if (error) {
              return Response.json({ error: error.message }, { status: 500 });
            }
            const lower = q.toLowerCase();
            const isUuid = UUID_RE.test(q);
            const matches = (data?.users ?? [])
              .filter((u) =>
                isUuid
                  ? u.id === q
                  : (u.email ?? "").toLowerCase().includes(lower),
              )
              .slice(0, 20)
              .map((u) => ({ id: u.id, email: u.email ?? null }));

            // Attach wallet balances.
            const ids = matches.map((m) => m.id);
            type WalletRow = {
              user_id: string;
              plan_code: string | null;
              monthly_credits_remaining: number | null;
              topup_credits_remaining: number | null;
            };
            let wallets: WalletRow[] = [];
            if (ids.length) {
              const { data: w } = await supabaseAdmin
                .from("user_wallets")
                .select(
                  "user_id, plan_code, monthly_credits_remaining, topup_credits_remaining",
                )
                .in("user_id", ids);
              wallets = (w ?? []) as WalletRow[];
            }
            const walletMap = new Map<string, WalletRow>();
            for (const w of wallets) walletMap.set(w.user_id, w);

            return Response.json({
              users: matches.map((m) => ({
                ...m,
                wallet: walletMap.get(m.id) ?? null,
              })),
            });
          }

          if (body.action === "grant") {
            const target = String(body.target_user_id ?? "");
            const amount = Number(body.amount);
            const note = body.note == null ? null : String(body.note).slice(0, 500);
            if (!UUID_RE.test(target)) {
              return Response.json({ error: "Invalid target_user_id" }, { status: 400 });
            }
            if (!Number.isFinite(amount) || amount === 0) {
              return Response.json({ error: "Amount must be non-zero" }, { status: 400 });
            }
            if (Math.abs(amount) > 100000) {
              return Response.json({ error: "Amount too large" }, { status: 400 });
            }
            const { data, error } = await supabaseAdmin.rpc("admin_grant_credit", {
              _target_user_id: target,
              _amount: amount as never,
              _note: note ?? undefined,
            });
            if (error) {
              return Response.json({ error: error.message }, { status: 500 });
            }
            const { data: wallet } = await supabaseAdmin
              .from("user_wallets")
              .select("topup_credits_remaining, monthly_credits_remaining, plan_code")
              .eq("user_id", target)
              .maybeSingle();
            return Response.json({ ok: true, ledger_id: data, wallet });
          }

          return Response.json({ error: "Unknown action" }, { status: 400 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Server error";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
