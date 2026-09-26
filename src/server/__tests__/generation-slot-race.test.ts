/**
 * Concurrency boundary for "one running generation per project".
 * Runs the REAL migration SQL (partial unique index + claim_generation_turn)
 * in an embedded Postgres, then races generation attempts through the real
 * client path (`streamGenerate`) against a server stub backed by that claim.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { interpretClaim } from "@/server/turn-recorder.server";
import { isUnbillableTurn } from "@/lib/build-outcome";

vi.mock("@/lib/auth-token", () => ({ getSupabaseAccessToken: async () => "tok" }));

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).filter((f) => readFileSync(join(dir, f), "utf8").includes("claim_generation_turn")).sort().pop()!;
const migration = readFileSync(join(dir, file), "utf8");

let db: PGlite;
const P = "00000000-0000-0000-0000-00000000000a";
const U = "00000000-0000-0000-0000-0000000000aa";
let n = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;

async function claim(turnId: string, projectId = P) {
  const r = await db.query<{ turn_id: string; claimed: boolean }>(
    "select * from public.claim_generation_turn($1,$2,$3)",
    [turnId, projectId, U],
  );
  return r.rows[0];
}
const running = async (projectId = P) =>
  (await db.query<{ c: number }>("select count(*)::int c from public.turns where project_id=$1 and status='running'", [projectId])).rows[0].c;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.turns (
      id uuid primary key, project_id uuid, user_id uuid, status text,
      started_at timestamptz default now(), ended_at timestamptz, error_message text,
      created_at timestamptz not null default now(), heartbeat_at timestamptz, last_progress_at timestamptz,
      credits_charged numeric default 0);
  `);
  await db.exec(migration);
});

describe("generation slot — database-enforced", () => {
  it("simultaneous claims: exactly one wins, the other gets the winner's id", async () => {
    const [a, b] = [uuid(), uuid()];
    const results = await Promise.all([claim(a), claim(b)]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const winner = results.find((r) => r.claimed)!.turn_id;
    const loser = results.find((r) => !r.claimed)!;
    expect(loser.turn_id).toBe(winner);
    expect(await running()).toBe(1);
    expect(interpretClaim(winner === a ? b : a, loser)).toEqual({ kind: "taken", existingTurnId: winner });
  });

  it("the index itself refuses a second running row even if the function is bypassed", async () => {
    await expect(
      db.query("insert into public.turns (id, project_id, user_id, status) values ($1,$2,$3,'running')", [uuid(), P, U]),
    ).rejects.toThrow(/turns_one_running_per_project|duplicate key/);
  });

  it("a retried send of the same turn id is idempotent", async () => {
    const r = (await db.query<{ id: string }>("select id from public.turns where project_id=$1 and status='running'", [P])).rows[0];
    expect(await claim(r.id)).toEqual({ turn_id: r.id, claimed: false });
    expect(await running()).toBe(1);
  });

  it("after the running turn reaches a terminal state, a new generation starts normally", async () => {
    await db.query("update public.turns set status='succeeded', ended_at=now() where project_id=$1 and status='running'", [P]);
    const next = uuid();
    expect(await claim(next)).toEqual({ turn_id: next, claimed: true });
    expect(await running()).toBe(1);
  });

  it("a stale running turn (no life for the window) never blocks a legitimate build", async () => {
    await db.query(
      "update public.turns set created_at=now()-interval '1 hour', heartbeat_at=now()-interval '30 minutes', last_progress_at=null where project_id=$1 and status='running'",
      [P],
    );
    const next = uuid();
    expect((await claim(next)).claimed).toBe(true);
    expect(await running()).toBe(1);
  });

  it("a long but alive turn (old created_at, fresh heartbeat) keeps its slot", async () => {
    await db.query("update public.turns set created_at=now()-interval '25 minutes', heartbeat_at=now() where project_id=$1 and status='running'", [P]);
    expect((await claim(uuid())).claimed).toBe(false);
  });

  it("different projects never contend", async () => {
    const other = "00000000-0000-0000-0000-00000000000b";
    expect((await claim(uuid(), other)).claimed).toBe(true);
  });
});

describe("two simultaneous requests through the real client path", () => {
  it("one generation, one build, second follows, no duplicate mutation or charge", async () => {
    const project = "00000000-0000-0000-0000-00000000000c";
    let generationsStarted = 0;
    let buildsTriggered = 0;
    let mutations = 0;
    const charges = new Set<string>(); // settlement is idempotent per turn id
    const followed: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/generate") {
          const body = JSON.parse(String(init?.body));
          const c = await claim(body.turnId, project);
          const o = interpretClaim(body.turnId, c);
          if (o.kind === "taken") {
            return new Response("Generation already running", { status: 409, headers: { "x-kimble-turn-id": o.existingTurnId } });
          }
          generationsStarted++;
          mutations++;
          buildsTriggered++;
          if (!isUnbillableTurn({ changedPathCount: 1, unappliedPathCount: 0, txCommitted: true, outcomeStatus: "committed" })) charges.add(body.turnId);
          const enc = new TextEncoder();
          return new Response(
            new ReadableStream({ start(ctl) { ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done", status: "succeeded" })}\n\n`)); ctl.close(); } }),
            { status: 200 },
          );
        }
        const m = /\/api\/turns\/([^/]+)\/events/.exec(url);
        if (m) {
          followed.push(m[1]);
          const enc = new TextEncoder();
          return new Response(new ReadableStream({ start(ctl) { ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done", status: "succeeded" })}\n\n`)); ctl.close(); } }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }),
    );
    const { streamGenerate } = await import("@/lib/stream");
    const ids = [uuid(), uuid()];
    const tracked: string[] = [];
    await Promise.all(
      ids.map((turnId) =>
        streamGenerate({ projectId: project, turnId, messages: [] } as never, { onTurnId: (t: string) => tracked.push(t) } as never),
      ),
    );
    vi.unstubAllGlobals();

    expect(generationsStarted).toBe(1);
    expect(buildsTriggered).toBe(1);
    expect(mutations).toBe(1);
    expect(charges.size).toBe(1);
    expect(await running(project)).toBe(1);
    const winner = (await db.query<{ id: string }>("select id from public.turns where project_id=$1 and status='running'", [project])).rows[0].id;
    expect(followed).toEqual([winner]);
    expect(tracked).toContain(winner);
  });
});

describe("running build + second request: correct message, never 'Retry'", () => {
  it("shows 'still working', follow action, no retry", async () => {
    const { PipelineError, toFriendlyError } = await import("@/lib/friendly-errors");
    const card = toFriendlyError(new PipelineError("x", "generation_running", "slot"));
    expect(card.origin).toBe("in_progress");
    expect(card.title).toBe("Kimble is still working on your last request.");
    expect(card.title).not.toMatch(/breather/i);
    expect(card.actionKind).not.toBe("retry");
    expect(card.actionLabel).toBe("Keep watching");
  });

  it("the per-worker 429 for a running build is classified the same way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "You already have a build running. Wait for it to finish before starting another one." }), { status: 429 })));
    const { streamGenerate } = await import("@/lib/stream");
    const err = await streamGenerate({ projectId: "p", turnId: uuid(), messages: [] } as never, {} as never).then(() => null, (e) => e);
    vi.unstubAllGlobals();
    const { toFriendlyError } = await import("@/lib/friendly-errors");
    expect(toFriendlyError(err).origin).toBe("in_progress");
  });
});
