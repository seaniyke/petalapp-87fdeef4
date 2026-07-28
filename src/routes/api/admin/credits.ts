/**
 * Admin API — single endpoint that fans out by `action`.
 *
 * Auth: requires Bearer token of an admin user (verified via has_role RPC).
 *
 * Actions:
 *   - lookup            { query }                              -> users[]
 *   - list_users        { page?, page_size?, query? }          -> users[], total, has_more
 *   - user_detail       { user_id }                            -> { user, wallet, projects, transactions, ledger }
 *   - grant             { target_user_id, amount, note? }      -> { ledger_id, wallet }
 *   - suspend_user      { target_user_id, banned: boolean }    -> { ok }
 *   - delete_user       { target_user_id }                     -> { ok }
 *   - list_projects     { page?, page_size?, query?, filter? } -> projects[], total, has_more
 *   - feature_project   { project_id, is_featured }            -> { ok }
 *   - delete_project    { project_id }                         -> { ok }
 *   - list_transactions { page?, page_size?, status?, since? } -> transactions[], total
 *   - list_ledger       { page?, page_size?, since? }          -> ledger[], total
 *   - dashboard         { since_days? }                        -> rich metrics
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WalletRow = {
  user_id: string;
  plan_code: string | null;
  monthly_credits_remaining: number | null;
  topup_credits_remaining: number | null;
};

async function authorize(
  request: Request,
): Promise<{ userId: string; token: string } | Response> {
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
  return { userId: data.claims.sub, token };
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

function userScopedClient(token: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Page through admin.listUsers and collect all users (cap at 5000 for safety). */
async function fetchAllAuthUsers(): Promise<
  Array<{ id: string; email: string | null; created_at: string; banned_until: string | null }>
> {
  const out: Array<{ id: string; email: string | null; created_at: string; banned_until: string | null }> = [];
  let page = 1;
  const perPage = 200;
  // Loop with hard cap to avoid runaway.
  while (page <= 25) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    for (const u of users) {
      const meta = (u as unknown as { banned_until?: string | null }).banned_until ?? null;
      out.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        banned_until: meta,
      });
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return out;
}

export const Route = createFileRoute("/api/admin/credits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorize(request);
        if (authResult instanceof Response) return authResult;
        const { userId: adminId, token: adminToken } = authResult;
        const denied = await assertAdmin(adminId);
        if (denied) return denied;

        let body: { action?: string; [k: string]: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        try {
          // ----- USERS -----
          if (body.action === "lookup" || body.action === "list_users") {
            const q = String(body.query ?? "").trim().toLowerCase();
            const page = Math.max(1, Number(body.page ?? 1) | 0);
            const pageSize = Math.min(100, Math.max(1, Number(body.page_size ?? 50) | 0));

            const all = await fetchAllAuthUsers();
            const filtered = q
              ? all.filter((u) =>
                  UUID_RE.test(q) ? u.id === q : (u.email ?? "").toLowerCase().includes(q),
                )
              : all;
            // newest first
            filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            const total = filtered.length;
            const start = (page - 1) * pageSize;
            const slice = filtered.slice(start, start + pageSize);

            const ids = slice.map((u) => u.id);
            let wallets: WalletRow[] = [];
            const projectCounts = new Map<string, number>();
            const spendByUser = new Map<string, number>();
            if (ids.length) {
              const [{ data: w }, { data: projs }, { data: txs }] = await Promise.all([
                supabaseAdmin
                  .from("user_wallets")
                  .select("user_id, plan_code, monthly_credits_remaining, topup_credits_remaining")
                  .in("user_id", ids),
                supabaseAdmin.from("projects").select("owner_id").in("owner_id", ids),
                supabaseAdmin
                  .from("paystack_transactions")
                  .select("user_id, usd_amount_cents, status")
                  .in("user_id", ids)
                  .eq("status", "success"),
              ]);
              wallets = (w ?? []) as WalletRow[];
              for (const p of projs ?? []) {
                const k = (p as { owner_id: string }).owner_id;
                projectCounts.set(k, (projectCounts.get(k) ?? 0) + 1);
              }
              for (const t of txs ?? []) {
                const row = t as { user_id: string; usd_amount_cents: number };
                spendByUser.set(row.user_id, (spendByUser.get(row.user_id) ?? 0) + Number(row.usd_amount_cents || 0));
              }
            }
            const walletMap = new Map(wallets.map((w) => [w.user_id, w]));

            return Response.json({
              users: slice.map((u) => ({
                id: u.id,
                email: u.email,
                created_at: u.created_at,
                banned_until: u.banned_until,
                wallet: walletMap.get(u.id) ?? null,
                project_count: projectCounts.get(u.id) ?? 0,
                lifetime_spend_usd_cents: spendByUser.get(u.id) ?? 0,
              })),
              total,
              has_more: start + slice.length < total,
              page,
              page_size: pageSize,
            });
          }

          if (body.action === "user_detail") {
            const target = String(body.user_id ?? "");
            if (!UUID_RE.test(target)) {
              return Response.json({ error: "Invalid user_id" }, { status: 400 });
            }
            const [{ data: authUser }, { data: wallet }, { data: projects }, { data: transactions }, { data: ledger }] =
              await Promise.all([
                supabaseAdmin.auth.admin.getUserById(target),
                supabaseAdmin
                  .from("user_wallets")
                  .select("*")
                  .eq("user_id", target)
                  .maybeSingle(),
                supabaseAdmin
                  .from("projects")
                  .select("id, title, slug, is_public, is_featured, published_visibility, updated_at, created_at, remix_count")
                  .eq("owner_id", target)
                  .order("updated_at", { ascending: false })
                  .limit(50),
                supabaseAdmin
                  .from("paystack_transactions")
                  .select("id, reference, status, amount_minor, currency_code, usd_amount_cents, purpose, item_code, created_at, paid_at")
                  .eq("user_id", target)
                  .order("created_at", { ascending: false })
                  .limit(50),
                supabaseAdmin
                  .from("credit_ledger")
                  .select("id, delta, balance_after, reason, created_at, project_id")
                  .eq("user_id", target)
                  .order("created_at", { ascending: false })
                  .limit(50),
              ]);
            const u = authUser?.user;
            return Response.json({
              user: u
                ? {
                    id: u.id,
                    email: u.email ?? null,
                    created_at: u.created_at,
                    last_sign_in_at: u.last_sign_in_at ?? null,
                    banned_until: (u as unknown as { banned_until?: string | null }).banned_until ?? null,
                  }
                : null,
              wallet,
              projects: projects ?? [],
              transactions: transactions ?? [],
              ledger: ledger ?? [],
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
            const { data, error } = await userScopedClient(adminToken).rpc("admin_grant_credit", {
              _target_user_id: target,
              _amount: amount as never,
              _note: note ?? undefined,
            });
            if (error) return Response.json({ error: error.message }, { status: 500 });
            const { data: wallet } = await supabaseAdmin
              .from("user_wallets")
              .select("topup_credits_remaining, monthly_credits_remaining, plan_code")
              .eq("user_id", target)
              .maybeSingle();
            return Response.json({ ok: true, ledger_id: data, wallet });
          }

          if (body.action === "suspend_user") {
            const target = String(body.target_user_id ?? "");
            const banned = Boolean(body.banned);
            if (!UUID_RE.test(target)) {
              return Response.json({ error: "Invalid target_user_id" }, { status: 400 });
            }
            if (target === adminId) {
              return Response.json({ error: "Refusing to suspend yourself" }, { status: 400 });
            }
            const { error } = await supabaseAdmin.auth.admin.updateUserById(target, {
              ban_duration: banned ? "876600h" : "none", // ~100 years; "none" lifts ban
            } as never);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ ok: true });
          }

          if (body.action === "delete_user") {
            const target = String(body.target_user_id ?? "");
            if (!UUID_RE.test(target)) {
              return Response.json({ error: "Invalid target_user_id" }, { status: 400 });
            }
            if (target === adminId) {
              return Response.json({ error: "Refusing to delete yourself" }, { status: 400 });
            }
            const { error } = await supabaseAdmin.auth.admin.deleteUser(target);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ ok: true });
          }

          // ----- PROJECTS -----
          if (body.action === "list_projects") {
            const page = Math.max(1, Number(body.page ?? 1) | 0);
            const pageSize = Math.min(100, Math.max(1, Number(body.page_size ?? 50) | 0));
            const q = String(body.query ?? "").trim();
            const filter = String(body.filter ?? "all"); // all | published | featured | private
            const start = (page - 1) * pageSize;

            let query = supabaseAdmin
              .from("projects")
              .select(
                "id, title, slug, owner_id, is_public, is_featured, published_visibility, published_at, updated_at, created_at, remix_count",
                { count: "exact" },
              )
              .order("updated_at", { ascending: false })
              .range(start, start + pageSize - 1);

            if (filter === "published") query = query.eq("published_visibility", "public");
            else if (filter === "featured") query = query.eq("is_featured", true);
            else if (filter === "private") query = query.neq("published_visibility", "public");

            if (q) query = query.ilike("title", `%${q}%`);

            const { data: projects, count, error } = await query;
            if (error) return Response.json({ error: error.message }, { status: 500 });

            const ownerIds = Array.from(new Set((projects ?? []).map((p) => (p as { owner_id: string }).owner_id)));
            const emailMap = new Map<string, string | null>();
            if (ownerIds.length) {
              // Fetch emails for owners (paged through admin list — small N here OK).
              const all = await fetchAllAuthUsers();
              for (const u of all) emailMap.set(u.id, u.email);
            }
            return Response.json({
              projects: (projects ?? []).map((p) => ({
                ...p,
                owner_email: emailMap.get((p as { owner_id: string }).owner_id) ?? null,
              })),
              total: count ?? 0,
              has_more: start + (projects?.length ?? 0) < (count ?? 0),
              page,
              page_size: pageSize,
            });
          }

          if (body.action === "feature_project") {
            const id = String(body.project_id ?? "");
            const isFeatured = Boolean(body.is_featured);
            if (!UUID_RE.test(id)) return Response.json({ error: "Invalid project_id" }, { status: 400 });
            const { error } = await supabaseAdmin
              .from("projects")
              .update({ is_featured: isFeatured })
              .eq("id", id);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ ok: true });
          }

          if (body.action === "delete_project") {
            const id = String(body.project_id ?? "");
            if (!UUID_RE.test(id)) return Response.json({ error: "Invalid project_id" }, { status: 400 });
            const { error } = await supabaseAdmin.from("projects").delete().eq("id", id);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ ok: true });
          }

          // ----- LEDGERS / TX -----
          if (body.action === "list_transactions") {
            const page = Math.max(1, Number(body.page ?? 1) | 0);
            const pageSize = Math.min(200, Math.max(1, Number(body.page_size ?? 50) | 0));
            const status = body.status ? String(body.status) : null;
            const sinceDays = Number(body.since_days ?? 0) | 0;
            const start = (page - 1) * pageSize;

            let q = supabaseAdmin
              .from("paystack_transactions")
              .select(
                "id, user_id, reference, status, amount_minor, currency_code, usd_amount_cents, purpose, item_code, channel, created_at, paid_at",
                { count: "exact" },
              )
              .order("created_at", { ascending: false })
              .range(start, start + pageSize - 1);
            if (status) q = q.eq("status", status);
            if (sinceDays > 0) {
              const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
              q = q.gte("created_at", since);
            }
            const { data: rows, count, error } = await q;
            if (error) return Response.json({ error: error.message }, { status: 500 });

            const userIds = Array.from(new Set((rows ?? []).map((r) => (r as { user_id: string }).user_id)));
            const emailMap = new Map<string, string | null>();
            if (userIds.length) {
              const all = await fetchAllAuthUsers();
              for (const u of all) emailMap.set(u.id, u.email);
            }
            return Response.json({
              transactions: (rows ?? []).map((r) => ({
                ...r,
                user_email: emailMap.get((r as { user_id: string }).user_id) ?? null,
              })),
              total: count ?? 0,
              has_more: start + (rows?.length ?? 0) < (count ?? 0),
              page,
              page_size: pageSize,
            });
          }

          if (body.action === "list_ledger") {
            const page = Math.max(1, Number(body.page ?? 1) | 0);
            const pageSize = Math.min(200, Math.max(1, Number(body.page_size ?? 50) | 0));
            const sinceDays = Number(body.since_days ?? 0) | 0;
            const start = (page - 1) * pageSize;

            let q = supabaseAdmin
              .from("credit_ledger")
              .select("id, user_id, project_id, delta, balance_after, reason, created_at", {
                count: "exact",
              })
              .order("created_at", { ascending: false })
              .range(start, start + pageSize - 1);
            if (sinceDays > 0) {
              const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
              q = q.gte("created_at", since);
            }
            const { data: rows, count, error } = await q;
            if (error) return Response.json({ error: error.message }, { status: 500 });

            const userIds = Array.from(new Set((rows ?? []).map((r) => (r as { user_id: string }).user_id)));
            const emailMap = new Map<string, string | null>();
            if (userIds.length) {
              const all = await fetchAllAuthUsers();
              for (const u of all) emailMap.set(u.id, u.email);
            }
            return Response.json({
              ledger: (rows ?? []).map((r) => ({
                ...r,
                user_email: emailMap.get((r as { user_id: string }).user_id) ?? null,
              })),
              total: count ?? 0,
              has_more: start + (rows?.length ?? 0) < (count ?? 0),
              page,
              page_size: pageSize,
            });
          }

          // ----- DASHBOARD -----
          if (body.action === "dashboard") {
            const sinceDays = Math.max(1, Math.min(365, Number(body.since_days ?? 30) | 0));
            const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
            const prevSince = new Date(Date.now() - 2 * sinceDays * 86_400_000).toISOString();

            const [
              { data: txs },
              { data: prevTxs },
              { count: ledgerCount },
              { count: walletsTotal },
              { count: walletsPaid },
              { count: projectsTotal },
              { count: projectsPublished },
              { data: topSpenders },
              { data: recentTx },
              { data: recentLedger },
            ] = await Promise.all([
              supabaseAdmin
                .from("paystack_transactions")
                .select("usd_amount_cents, created_at, user_id, status")
                .eq("status", "success")
                .gte("created_at", since),
              supabaseAdmin
                .from("paystack_transactions")
                .select("usd_amount_cents")
                .eq("status", "success")
                .gte("created_at", prevSince)
                .lt("created_at", since),
              supabaseAdmin.from("credit_ledger").select("id", { count: "exact", head: true }).gte("created_at", since),
              supabaseAdmin.from("user_wallets").select("user_id", { count: "exact", head: true }),
              supabaseAdmin
                .from("user_wallets")
                .select("user_id", { count: "exact", head: true })
                .neq("plan_code", "free"),
              supabaseAdmin.from("projects").select("id", { count: "exact", head: true }),
              supabaseAdmin
                .from("projects")
                .select("id", { count: "exact", head: true })
                .eq("published_visibility", "public"),
              supabaseAdmin
                .from("paystack_transactions")
                .select("user_id, usd_amount_cents")
                .eq("status", "success")
                .gte("created_at", since),
              supabaseAdmin
                .from("paystack_transactions")
                .select("id, user_id, status, amount_minor, currency_code, usd_amount_cents, purpose, created_at")
                .order("created_at", { ascending: false })
                .limit(10),
              supabaseAdmin
                .from("credit_ledger")
                .select("id, user_id, delta, reason, created_at")
                .order("created_at", { ascending: false })
                .limit(10),
            ]);

            const revenueCents = (txs ?? []).reduce((s, t) => s + Number((t as { usd_amount_cents: number }).usd_amount_cents || 0), 0);
            const prevRevenueCents = (prevTxs ?? []).reduce(
              (s, t) => s + Number((t as { usd_amount_cents: number }).usd_amount_cents || 0),
              0,
            );

            // Daily revenue series
            const buckets = new Map<string, number>();
            for (let i = 0; i < sinceDays; i++) {
              const d = new Date(Date.now() - (sinceDays - 1 - i) * 86_400_000);
              buckets.set(d.toISOString().slice(0, 10), 0);
            }
            for (const t of txs ?? []) {
              const row = t as { created_at: string; usd_amount_cents: number };
              const k = row.created_at.slice(0, 10);
              if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + Number(row.usd_amount_cents || 0));
            }

            // Top spenders
            const spend = new Map<string, number>();
            for (const t of topSpenders ?? []) {
              const row = t as { user_id: string; usd_amount_cents: number };
              spend.set(row.user_id, (spend.get(row.user_id) ?? 0) + Number(row.usd_amount_cents || 0));
            }
            const top = Array.from(spend.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);

            // Resolve emails for top spenders + recent activity
            const idsNeeded = new Set<string>();
            top.forEach(([id]) => idsNeeded.add(id));
            (recentTx ?? []).forEach((r) => idsNeeded.add((r as { user_id: string }).user_id));
            (recentLedger ?? []).forEach((r) => idsNeeded.add((r as { user_id: string }).user_id));
            const emailMap = new Map<string, string | null>();
            if (idsNeeded.size) {
              const all = await fetchAllAuthUsers();
              for (const u of all) emailMap.set(u.id, u.email);
            }

            // Signups in window
            const allUsers = await fetchAllAuthUsers();
            const signupsInWindow = allUsers.filter((u) => u.created_at >= since).length;
            const signupsPrev = allUsers.filter((u) => u.created_at >= prevSince && u.created_at < since).length;

            return Response.json({
              since_days: sinceDays,
              revenue_usd_cents: revenueCents,
              prev_revenue_usd_cents: prevRevenueCents,
              ledger_entries: ledgerCount ?? 0,
              wallets_total: walletsTotal ?? 0,
              wallets_paid: walletsPaid ?? 0,
              projects_total: projectsTotal ?? 0,
              projects_published: projectsPublished ?? 0,
              signups_in_window: signupsInWindow,
              signups_prev: signupsPrev,
              users_total: allUsers.length,
              revenue_series: Array.from(buckets.entries()).map(([date, cents]) => ({ date, cents })),
              top_spenders: top.map(([user_id, cents]) => ({
                user_id,
                email: emailMap.get(user_id) ?? null,
                lifetime_window_cents: cents,
              })),
              recent_transactions: (recentTx ?? []).map((r) => ({
                ...r,
                user_email: emailMap.get((r as { user_id: string }).user_id) ?? null,
              })),
              recent_ledger: (recentLedger ?? []).map((r) => ({
                ...r,
                user_email: emailMap.get((r as { user_id: string }).user_id) ?? null,
              })),
            });
          }

          if (body.action === "pipeline_stats") {
            const sinceHours = Math.max(1, Math.min(24 * 30, Number(body.since_hours ?? 24) | 0));
            const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

            const { data: events, error: evErr } = await supabaseAdmin
              .from("pipeline_tier_events")
              .select("turn_id, project_id, message_id, model, tier, tier_order, outcome, duration_ms, issue_count, details, created_at")
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(5000);
            if (evErr) return Response.json({ error: evErr.message }, { status: 500 });

            const rows = events ?? [];

            // Per-tier aggregates
            type TierAgg = {
              tier: string;
              total: number;
              ok: number;
              failed: number;
              fixed: number;
              warned: number;
              skipped: number;
              durations: number[];
              issues: number;
            };
            const byTier = new Map<string, TierAgg>();
            const turns = new Set<string>();
            const halluCounts = new Map<string, number>();
            const handoffReasons = new Map<string, number>();

            for (const r of rows) {
              const row = r as {
                tier: string;
                outcome: string;
                duration_ms: number;
                issue_count: number;
                turn_id: string;
                details: Record<string, unknown> | null;
              };
              turns.add(row.turn_id);
              let agg = byTier.get(row.tier);
              if (!agg) {
                agg = { tier: row.tier, total: 0, ok: 0, failed: 0, fixed: 0, warned: 0, skipped: 0, durations: [], issues: 0 };
                byTier.set(row.tier, agg);
              }
              agg.total += 1;
              agg.durations.push(Number(row.duration_ms || 0));
              agg.issues += Number(row.issue_count || 0);
              const o = row.outcome as keyof TierAgg;
              if (o === "ok" || o === "failed" || o === "fixed" || o === "warned" || o === "skipped") {
                (agg[o] as number) += 1;
              }
              const det = row.details ?? {};
              const hallu = (det as { hallucinated_packages?: unknown }).hallucinated_packages;
              if (Array.isArray(hallu)) {
                for (const pkg of hallu) {
                  if (typeof pkg === "string") halluCounts.set(pkg, (halluCounts.get(pkg) ?? 0) + 1);
                }
              }
              const handoff = (det as { handoff_reason?: unknown }).handoff_reason;
              if (typeof handoff === "string") {
                handoffReasons.set(handoff, (handoffReasons.get(handoff) ?? 0) + 1);
              }
            }

            const pct = (n: number) => Math.round(n);
            const percentile = (arr: number[], p: number): number => {
              if (!arr.length) return 0;
              const sorted = [...arr].sort((a, b) => a - b);
              const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
              return sorted[idx];
            };

            const tierStats = Array.from(byTier.values())
              .sort((a, b) => a.tier.localeCompare(b.tier))
              .map((a) => ({
                tier: a.tier,
                total: a.total,
                ok: a.ok,
                failed: a.failed,
                fixed: a.fixed,
                warned: a.warned,
                skipped: a.skipped,
                ok_pct: a.total ? pct((a.ok / a.total) * 100) : 0,
                failed_pct: a.total ? pct((a.failed / a.total) * 100) : 0,
                p50_ms: percentile(a.durations, 50),
                p95_ms: percentile(a.durations, 95),
                avg_issues: a.total ? +(a.issues / a.total).toFixed(2) : 0,
              }));

            const topHallu = Array.from(halluCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([pkg, count]) => ({ package: pkg, count }));

            const handoffs = Array.from(handoffReasons.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => ({ reason, count }));

            const recent = rows.slice(0, 50).map((r) => {
              const row = r as Record<string, unknown>;
              return {
                turn_id: row.turn_id,
                tier: row.tier,
                outcome: row.outcome,
                duration_ms: row.duration_ms,
                issue_count: row.issue_count,
                model: row.model,
                project_id: row.project_id,
                created_at: row.created_at,
                details: row.details,
              };
            });

            return Response.json({
              since_hours: sinceHours,
              total_events: rows.length,
              total_turns: turns.size,
              tier_stats: tierStats,
              top_hallucinated: topHallu,
              handoff_reasons: handoffs,
              recent_events: recent,
            });
          }

          if (body.action === "pipeline_failures") {
            const sinceHours = Math.max(1, Math.min(24 * 30, Number(body.since_hours ?? 24) | 0));
            const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

            const { data: rowsRaw, error: pfErr } = await supabaseAdmin
              .from("pipeline_failures")
              .select("id, project_id, surface, raw_message, signature, tool_name, model, stream_tail, url, extra, created_at")
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(1000);
            if (pfErr) return Response.json({ error: pfErr.message }, { status: 500 });

            const rows = (rowsRaw ?? []) as Array<{
              id: string;
              project_id: string | null;
              surface: string;
              raw_message: string;
              signature: string;
              tool_name: string | null;
              model: string | null;
              stream_tail: string | null;
              url: string | null;
              extra: Record<string, unknown> | null;
              created_at: string;
            }>;

            // Group by signature so we can rank "what's actually breaking"
            // — the whole point of this view.
            const bySig = new Map<
              string,
              { signature: string; count: number; surfaces: Set<string>; models: Set<string>; sample: typeof rows[number] }
            >();
            for (const r of rows) {
              const g = bySig.get(r.signature);
              if (!g) {
                bySig.set(r.signature, {
                  signature: r.signature,
                  count: 1,
                  surfaces: new Set([r.surface]),
                  models: new Set(r.model ? [r.model] : []),
                  sample: r,
                });
              } else {
                g.count += 1;
                g.surfaces.add(r.surface);
                if (r.model) g.models.add(r.model);
              }
            }
            const groups = Array.from(bySig.values())
              .sort((a, b) => b.count - a.count)
              .slice(0, 100)
              .map((g) => ({
                signature: g.signature,
                count: g.count,
                surfaces: Array.from(g.surfaces),
                models: Array.from(g.models),
                sample: g.sample,
              }));

            return Response.json({
              since_hours: sinceHours,
              total: rows.length,
              groups,
              recent: rows.slice(0, 50),
            });
          }

          if (body.action === "project_ai_spend") {
            const sinceDays = Math.max(1, Math.min(90, Number(body.since_days ?? 30) | 0));
            const limit = Math.max(10, Math.min(500, Number(body.limit ?? 100) | 0));
            const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

            // Aggregate in-app — Supabase JS doesn't expose GROUP BY, and the
            // dataset (last 30d of ai_call_log) is small enough to pull and
            // bucket here.
            const { data: rows, error: aiErr } = await supabaseAdmin
              .from("ai_call_log")
              .select("project_id, cost_usd_micro, total_tokens, status, created_at")
              .gte("created_at", since)
              .not("project_id", "is", null)
              .limit(50000);
            if (aiErr) return Response.json({ error: aiErr.message }, { status: 500 });

            type Agg = {
              project_id: string;
              calls: number;
              errors: number;
              tokens: number;
              cost_usd_cents: number;
              last_call_at: string;
            };
            const byProject = new Map<string, Agg>();
            for (const r of (rows ?? []) as Array<{
              project_id: string | null;
              cost_usd_micro: number | null;
              total_tokens: number | null;
              status: number | null;
              created_at: string;
            }>) {
              if (!r.project_id) continue;
              const a = byProject.get(r.project_id) ?? {
                project_id: r.project_id,
                calls: 0,
                errors: 0,
                tokens: 0,
                cost_usd_cents: 0,
                last_call_at: r.created_at,
              };
              a.calls += 1;
              if ((r.status ?? 0) >= 400) a.errors += 1;
              a.tokens += Number(r.total_tokens ?? 0);
              // cost_usd_micro is USD × 1e6; convert to cents (× 1e-4).
              a.cost_usd_cents += Number(r.cost_usd_micro ?? 0) / 10_000;
              if (r.created_at > a.last_call_at) a.last_call_at = r.created_at;
              byProject.set(r.project_id, a);
            }

            const ranked = Array.from(byProject.values())
              .sort((a, b) => b.cost_usd_cents - a.cost_usd_cents)
              .slice(0, limit);

            // Hydrate with project title + owner email.
            const projectIds = ranked.map((r) => r.project_id);
            const [{ data: projects }, allUsers] = await Promise.all([
              projectIds.length
                ? supabaseAdmin
                    .from("projects")
                    .select("id, title, slug, owner_id, published_visibility")
                    .in("id", projectIds)
                : Promise.resolve({ data: [] as Array<{ id: string; title: string; slug: string; owner_id: string; published_visibility: string }> }),
              fetchAllAuthUsers(),
            ]);
            const projMap = new Map((projects ?? []).map((p) => [p.id, p]));
            const emailMap = new Map(allUsers.map((u) => [u.id, u.email]));

            const total_cost_cents = Array.from(byProject.values()).reduce(
              (s, a) => s + a.cost_usd_cents,
              0,
            );
            const total_calls = Array.from(byProject.values()).reduce((s, a) => s + a.calls, 0);

            return Response.json({
              since_days: sinceDays,
              total_projects: byProject.size,
              total_cost_cents: Math.round(total_cost_cents),
              total_calls,
              projects: ranked.map((r) => {
                const p = projMap.get(r.project_id);
                return {
                  project_id: r.project_id,
                  title: p?.title ?? "(deleted)",
                  slug: p?.slug ?? null,
                  owner_id: p?.owner_id ?? null,
                  owner_email: p ? emailMap.get(p.owner_id) ?? null : null,
                  published: p?.published_visibility === "public",
                  calls: r.calls,
                  errors: r.errors,
                  tokens: r.tokens,
                  cost_usd_cents: Math.round(r.cost_usd_cents),
                  last_call_at: r.last_call_at,
                };
              }),
            });
          }

          /* ------------------------------ Waitlist ------------------------------ */

          if (body.action === "waitlist_settings") {
            const { data } = await supabaseAdmin
              .from("system_settings")
              .select("value")
              .eq("key", "access.waitlist_mode")
              .maybeSingle();
            const { count } = await supabaseAdmin
              .from("waitlist_signups" as never)
              .select("id", { count: "exact", head: true });
            const { count: pending } = await supabaseAdmin
              .from("waitlist_signups" as never)
              .select("id", { count: "exact", head: true })
              .is("notified_at", null);
            return Response.json({
              enabled: data?.value === true,
              total: count ?? 0,
              pending: pending ?? 0,
            });
          }

          if (body.action === "waitlist_toggle") {
            const enabled = Boolean(body.enabled);
            const { error } = await supabaseAdmin
              .from("system_settings")
              .upsert(
                {
                  key: "access.waitlist_mode",
                  value: enabled as never,
                  description:
                    "When true, visitors see the waitlist instead of sign-up/sign-in.",
                  updated_by: auth.userId,
                } as never,
                { onConflict: "key" },
              );
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ ok: true, enabled });
          }

          if (body.action === "waitlist_list") {
            const page = Math.max(0, Number(body.page ?? 0) | 0);
            const pageSize = Math.min(200, Math.max(1, Number(body.page_size ?? 50) | 0));
            const query = String(body.query ?? "").trim();
            let q = supabaseAdmin
              .from("waitlist_signups" as never)
              .select("id, name, email, source, notified_at, created_at", { count: "exact" })
              .order("created_at", { ascending: false })
              .range(page * pageSize, page * pageSize + pageSize - 1);
            if (query) q = q.or(`email.ilike.%${query}%,name.ilike.%${query}%`);
            const { data, error, count } = await q;
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({
              entries: data ?? [],
              total: count ?? 0,
              has_more: (page + 1) * pageSize < (count ?? 0),
            });
          }

          if (body.action === "waitlist_announce") {
            const secret = process.env.BUILDER_SHARED_SECRET;
            if (!secret) {
              return Response.json(
                { error: "Email sending is not configured on this environment." },
                { status: 500 },
              );
            }

            const subject = String(body.subject ?? "").trim().slice(0, 200);
            const heading = String(body.heading ?? "").trim().slice(0, 200);
            const text = String(body.body ?? "").trim().slice(0, 8000);
            const ctaLabel = String(body.cta_label ?? "").trim().slice(0, 60);
            const ctaUrl = String(body.cta_url ?? "").trim().slice(0, 500);
            if (!subject || !text) {
              return Response.json(
                { error: "Subject and message are required." },
                { status: 400 },
              );
            }
            if (ctaUrl && !/^https:\/\//i.test(ctaUrl)) {
              return Response.json({ error: "Link must start with https://" }, { status: 400 });
            }

            const onlyPending = body.only_pending !== false;
            const batchSize = Math.min(100, Math.max(1, Number(body.batch_size ?? 50) | 0));
            let announcementId =
              typeof body.announcement_id === "string" && UUID_RE.test(body.announcement_id)
                ? body.announcement_id
                : null;

            // Count the audience up front on the first call.
            if (!announcementId) {
              let cq = supabaseAdmin
                .from("waitlist_signups" as never)
                .select("id", { count: "exact", head: true });
              if (onlyPending) cq = cq.is("notified_at", null);
              const { count } = await cq;
              const { data: created, error: cErr } = await supabaseAdmin
                .from("waitlist_announcements" as never)
                .insert({
                  subject,
                  heading: heading || null,
                  body: text,
                  cta_label: ctaLabel || null,
                  cta_url: ctaUrl || null,
                  recipients_total: count ?? 0,
                  created_by: auth.userId,
                  status: "running",
                } as never)
                .select("id")
                .single();
              if (cErr) return Response.json({ error: cErr.message }, { status: 500 });
              announcementId = (created as { id: string }).id;
            }

            // Pull one batch of recipients that still need this send.
            let rq = supabaseAdmin
              .from("waitlist_signups" as never)
              .select("id, name, email")
              .order("created_at", { ascending: true })
              .limit(batchSize);
            if (onlyPending) rq = rq.is("notified_at", null);
            else rq = rq.or(`notified_at.is.null,notified_at.lt.${new Date(Date.now() - 60_000).toISOString()}`);
            const { data: rows, error: rErr } = await rq;
            if (rErr) return Response.json({ error: rErr.message }, { status: 500 });

            const recipients = (rows ?? []) as Array<{
              id: string;
              name: string;
              email: string;
            }>;

            const sendUrl = new URL(
              "/lovable/email/transactional/send",
              new URL(request.url).origin,
            ).toString();

            let sent = 0;
            let failed = 0;
            const sentIds: string[] = [];

            // Sequential with a tiny gap — the email queue does the real
            // throttling, this just keeps us well inside rate limits.
            for (const r of recipients) {
              try {
                const resp = await fetch(sendUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-petal-internal-secret": secret,
                  },
                  body: JSON.stringify({
                    templateName: "waitlist-announcement",
                    recipientEmail: r.email,
                    idempotencyKey: `waitlist-ann-${announcementId}-${r.id}`,
                    templateData: {
                      name: r.name,
                      subject,
                      heading: heading || subject,
                      body: text,
                      ctaLabel: ctaLabel || undefined,
                      ctaUrl: ctaUrl || undefined,
                    },
                  }),
                });
                if (resp.ok) {
                  sent += 1;
                  sentIds.push(r.id);
                } else {
                  failed += 1;
                  console.warn("[waitlist-announce] send failed", resp.status, await resp.text().catch(() => ""));
                }
              } catch (e) {
                failed += 1;
                console.warn("[waitlist-announce] send threw", e);
              }
            }

            if (sentIds.length) {
              await supabaseAdmin
                .from("waitlist_signups" as never)
                .update({ notified_at: new Date().toISOString() } as never)
                .in("id", sentIds);
            }

            // Roll up counters on the announcement row.
            const { data: annRow } = await supabaseAdmin
              .from("waitlist_announcements" as never)
              .select("sent_count, failed_count, recipients_total")
              .eq("id", announcementId)
              .maybeSingle();
            const prev = (annRow ?? { sent_count: 0, failed_count: 0 }) as {
              sent_count: number;
              failed_count: number;
            };
            const done = recipients.length < batchSize;
            await supabaseAdmin
              .from("waitlist_announcements" as never)
              .update({
                sent_count: prev.sent_count + sent,
                failed_count: prev.failed_count + failed,
                status: done ? "done" : "running",
              } as never)
              .eq("id", announcementId);

            return Response.json({
              announcement_id: announcementId,
              batch_sent: sent,
              batch_failed: failed,
              total_sent: prev.sent_count + sent,
              total_failed: prev.failed_count + failed,
              done,
            });
          }

          if (body.action === "waitlist_announcements") {
            const { data, error } = await supabaseAdmin
              .from("waitlist_announcements" as never)
              .select(
                "id, subject, recipients_total, sent_count, failed_count, status, created_at",
              )
              .order("created_at", { ascending: false })
              .limit(20);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ announcements: data ?? [] });
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
