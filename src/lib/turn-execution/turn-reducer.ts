/**
 * Turn execution state — ONE deterministic view of ONE durable turn.
 *
 *   durable turn_events ──replay──┐
 *                                 ├──▶ turnReducer ──▶ TurnView ──▶ UI
 *   live SSE (same events) ──────┘
 *
 * Live and replayed events go through the exact same reducer, so staying on
 * the page, refreshing, reconnecting or coming back later all converge on the
 * same state. Nothing here invents activity: every line is a deterministic
 * translation of a real backend event or a real build-row snapshot.
 *
 * Deduplication is by authoritative `seq` for replayed events. Live events
 * carry no seq; a replay from seq 0 rebuilds the derived state from the
 * durable log, so a live stream followed by a full replay never
 * double-counts. Per-item keys (file path, check step, picture URL) make
 * repeated application idempotent. Lifecycle is DERIVED, never stored, and
 * its inputs only ever move forward — a late event cannot make READY look
 * like BUILDING again.
 */

export type RawTurnEvent = { type: string; seq?: number } & Record<string, unknown>;

export type ActivityKind =
  | "understand"
  | "design"
  | "plan"
  | "file"
  | "asset"
  | "validation"
  | "repair"
  | "recovery"
  | "build"
  | "verify"
  | "save"
  | "terminal";

export type Activity = {
  /** Stable key — same event always produces the same key. */
  key: string;
  kind: ActivityKind;
  status: "active" | "done" | "failed";
  /** Human-first line. */
  label: string;
  /** Technical detail (file path, validator message…) for the Details view. */
  tech?: string;
};

/** Pipeline timeline entry — same shape the Details sheet already renders. */
export type TimelineItem = {
  step: string;
  outcome: "ok" | "fixed" | "skipped" | "failed";
  message: string;
  count?: number;
  url?: string;
  ts: number;
};

export type DeploySnapshot = {
  buildId: string;
  status: "pending" | "building" | "ready" | "failed";
  progressLabel: string | null;
  errorMessage: string | null;
  verification: { ok: boolean; defects: string[]; skipped?: string } | null;
};

export type StopState =
  | { phase: "none" }
  | { phase: "requested" }
  | { phase: "cancelled" }
  | { phase: "completion_won" }
  | { phase: "unconfirmed" };

type GenState = {
  lastSeq: number;
  liveCount: number;
  seen: string[];
  activities: Activity[];
  files: Record<string, { status: "writing" | "written" | "validated" | "issue"; errors?: string[] }>;
  assets: string[];
  steps: string[];
  current: string | null;
  error: { message: string; kind?: string; raw?: string } | null;
  recovering: boolean;
  outcome: "applied" | "answered" | "blocked" | "failed" | null;
  noFileChanges: boolean;
  done: "succeeded" | "failed" | "aborted" | "awaiting_credits" | "plan_proposed" | null;
  tech: string[];
  /** Files in the order Kimble started writing them. */
  paths: string[];
  latestPath: string | null;
  latestNarration: string | null;
  timeline: TimelineItem[];
};

export type TurnState = {
  turnId: string | null;
  /** Build row that was live when this turn began — never "this turn's" build. */
  baselineBuildId: string | null;
  gen: GenState;
  deploy: DeploySnapshot | null;
  stop: StopState;
};

export type Lifecycle =
  | "idle"
  | "running"
  | "stopping"
  | "cancelled"
  | "failed"
  | "answered"
  | "awaiting_approval"
  | "paused"
  | "generated"
  | "building"
  | "build_failed"
  | "verify_failed"
  | "ready";

export type TurnAction =
  | { type: "turn_started"; turnId: string; baselineBuildId: string | null }
  | { type: "event"; event: RawTurnEvent; source: "live" | "replay" }
  | { type: "deploy"; snapshot: DeploySnapshot | null }
  | { type: "stop_requested" }
  | { type: "stop_result"; result: "cancelled" | "completion_won" | "unconfirmed" }
  | { type: "reset" };

function emptyGen(): GenState {
  return {
    lastSeq: 0,
    liveCount: 0,
    seen: [],
    activities: [],
    files: {},
    assets: [],
    steps: [],
    current: null,
    error: null,
    recovering: false,
    outcome: null,
    noFileChanges: false,
    done: null,
    tech: [],
    paths: [],
    latestPath: null,
    latestNarration: null,
    timeline: [],
  };
}

const TIMELINE_LIMIT = 30;
function pushTimeline(g: GenState, item: TimelineItem): TimelineItem[] {
  const dup = item.url
    ? g.timeline.some((t) => t.url === item.url)
    : g.timeline.some((t) => t.step === item.step && t.ts === item.ts && t.message === item.message);
  if (dup || g.timeline.length >= TIMELINE_LIMIT) return g.timeline;
  return [...g.timeline, item];
}
const OUTCOMES = ["ok", "fixed", "skipped", "failed"] as const;

export const initialTurnState: TurnState = {
  turnId: null,
  baselineBuildId: null,
  gen: emptyGen(),
  deploy: null,
  stop: { phase: "none" },
};

// ─── Human language ────────────────────────────────────────────────────────

/** "src/pages/Home.tsx" → "Home page"; "src/components/Nav.tsx" → "Nav". */
export function humanFileName(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.(tsx|ts|jsx|js|css|json|sql|md)$/i, "");
  const words = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").trim();
  if (/\/pages?\//i.test(path) || /\/routes\//i.test(path)) {
    if (/^index$/i.test(words)) return "Home page";
    return /page$/i.test(words) ? words : `${words} page`;
  }
  if (/^app$/i.test(words)) return "app shell";
  if (/\.css$/i.test(path)) return "styles";
  return words;
}

const PHASE_LINES: Record<string, string> = {
  thinking: "Understanding your request",
  designing: "Choosing a design direction",
  writing: "Writing your app",
  polishing: "Checking the work",
};

const TIMELINE_LINES: Record<string, { ok: string; fixed: string; failed: string }> = {
  local_verifier: { ok: "Code checked", fixed: "Fixed a code issue", failed: "Found a code issue" },
  esbuild_parse: { ok: "Code compiles cleanly", fixed: "Fixed a compile issue", failed: "Compile check failed" },
  stream_autofix: { ok: "Output checked", fixed: "Repaired cut-off output", failed: "Output was incomplete" },
  post_stream_autofix: { ok: "Code checked", fixed: "Repaired an issue", failed: "Repair didn't succeed" },
  npm_preflight: { ok: "Packages checked", fixed: "Fixed package versions", failed: "Package check failed" },
  render_risk: { ok: "Pages render safely", fixed: "Fixed a rendering risk", failed: "Found a rendering risk" },
  rls_sanity: { ok: "Data privacy checked", fixed: "Fixed data privacy rules", failed: "Data privacy check failed" },
  prd_contract: { ok: "Everything you asked for is there", fixed: "Added a missing piece", failed: "Something you asked for is missing" },
  continuation: { ok: "Continued writing", fixed: "Continued writing", failed: "Couldn't continue writing" },
  file_budget: { ok: "Scope checked", fixed: "Trimmed unrelated changes", failed: "Scope check failed" },
};

/** Status strings the server sends only to fill silence — never narrate them. */
const FILLER = /^(still working|reviewing the pieces|almost there|polishing the last)/i;

// ─── Reducer ───────────────────────────────────────────────────────────────

function upsert(list: Activity[], a: Activity): Activity[] {
  const i = list.findIndex((x) => x.key === a.key);
  if (i === -1) return [...list, a];
  const next = list.slice();
  next[i] = { ...next[i], ...a };
  return next;
}

/** Close whatever was "active" so exactly one thing is current. */
function settle(list: Activity[], exceptKey?: string): Activity[] {
  // Plan steps close only on their own step_status event — never implicitly.
  return list.map((a) =>
    a.status === "active" && a.key !== exceptKey && !(a.key.startsWith("step:") && !exceptKey?.startsWith("step:"))
      ? { ...a, status: "done" }
      : a,
  );
}

function pushTech(g: GenState, line: string): string[] {
  return [...g.tech, line].slice(-200);
}

function applyEvent(g: GenState, e: RawTurnEvent): GenState {
  // eslint-disable-next-line no-param-reassign -- local rebinding only
  const str = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : "");
  switch (e.type) {
    case "phase": {
      const phase = str("phase");
      const label = PHASE_LINES[phase];
      if (!label) return g;
      const key = `phase:${phase}`;
      return { ...g, current: label, activities: upsert(settle(g.activities, key), { key, kind: phase === "designing" ? "design" : "understand", status: "active", label }) };
    }
    case "design_vibe":
      return { ...g, tech: pushTech(g, `Design: ${str("vibe")}`) };
    case "build_steps": {
      const steps = Array.isArray(e.steps) ? (e.steps as unknown[]).filter((s): s is string => typeof s === "string") : [];
      return { ...g, steps };
    }
    case "step_status": {
      const idx = typeof e.index === "number" ? e.index : -1;
      const label = g.steps[idx];
      if (!label) return g;
      const key = `step:${idx}`;
      const status = str("status") === "done" ? "done" : "active";
      const acts = status === "active" ? settle(g.activities, key) : g.activities;
      return { ...g, current: status === "active" ? label : g.current, activities: upsert(acts, { key, kind: "plan", status, label }) };
    }
    case "file_progress": {
      const path = str("latestPath");
      if (!path) return g;
      const moved = g.latestPath !== path;
      const base = {
        ...g,
        paths: g.paths.includes(path) ? g.paths : [...g.paths, path],
        latestPath: path,
        latestNarration: moved ? null : g.latestNarration,
      };
      if (g.files[path] && g.files[path].status !== "writing") return base;
      const key = `file:${path}`;
      const label = `Creating ${humanFileName(path)}`;
      return {
        ...base,
        current: label,
        files: { ...g.files, [path]: { status: "writing" } },
        activities: upsert(settle(g.activities, key), { key, kind: "file", status: "active", label, tech: path }),
      };
    }
    case "file_complete": {
      const path = str("path");
      if (!path) return g;
      const prev = g.files[path];
      const key = `file:${path}`;
      return {
        ...g,
        files: { ...g.files, [path]: { status: prev?.status === "validated" ? "validated" : "written" } },
        activities: upsert(g.activities, { key, kind: "file", status: "done", label: `Created ${humanFileName(path)}`, tech: path }),
        tech: pushTech(g, `wrote ${path}${typeof e.bytes === "number" ? ` (${e.bytes} bytes)` : ""}`),
      };
    }
    case "file_validated": {
      const path = str("path");
      if (!path) return g;
      const ok = Boolean(e.ok);
      const errors = Array.isArray(e.errors) ? (e.errors as string[]) : undefined;
      const next = { ...g, files: { ...g.files, [path]: { status: ok ? ("validated" as const) : ("issue" as const), errors } } };
      if (ok) return { ...next, tech: pushTech(g, `validated ${path}`) };
      const key = `repair:${path}`;
      return {
        ...next,
        current: `Fixing an issue in ${humanFileName(path)}`,
        activities: upsert(settle(g.activities, key), { key, kind: "repair", status: "active", label: `Fixing an issue in ${humanFileName(path)}`, tech: `${path}: ${(errors ?? []).join("; ")}` }),
      };
    }
    case "narration": {
      const path = str("path");
      const adopt = g.latestPath === null || g.latestPath === path;
      return { ...g, latestNarration: adopt ? str("text") : g.latestNarration, tech: pushTech(g, `${path}: ${str("text")}`) };
    }
    case "cycle_start": {
      if (str("intent") !== "fixing") return g;
      const key = `cycle:${e.cycle}`;
      return { ...g, current: "Fixing what the checks found", activities: upsert(settle(g.activities, key), { key, kind: "repair", status: "active", label: "Fixing what the checks found" }) };
    }
    case "cycle_end": {
      const key = `cycle:${e.cycle}`;
      if (!g.activities.some((a) => a.key === key)) return g;
      const outcome = str("outcome");
      return { ...g, activities: upsert(g.activities, { key, kind: "repair", status: outcome === "hard-stop" ? "failed" : "done", label: outcome === "clean" ? "Fixed what the checks found" : outcome === "hard-stop" ? "Couldn't fix everything the checks found" : "Trying the fix again" }) };
    }
    case "timeline": {
      const step = str("step");
      const outcome = str("outcome");
      const message = str("message");
      const url = str("url");
      const oc = OUTCOMES.find((o) => o === outcome) ?? "ok";
      g = {
        ...g,
        timeline: pushTimeline(g, {
          step,
          outcome: oc,
          message,
          count: typeof e.count === "number" ? e.count : undefined,
          url: url || undefined,
          ts: typeof e.ts === "number" ? e.ts : (g.timeline[g.timeline.length - 1]?.ts ?? 0),
        }),
      };
      if (url) {
        if (g.assets.includes(url)) return g;
        const assets = [...g.assets, url];
        return {
          ...g,
          assets,
          current: "Generating imagery",
          activities: upsert(g.activities, { key: "assets", kind: "asset", status: "active", label: assets.length === 1 ? "Made 1 picture" : `Made ${assets.length} pictures` }),
          tech: pushTech(g, `image ${url}`),
        };
      }
      if (outcome === "skipped") return { ...g, tech: pushTech(g, `${step}: skipped ${message}`) };
      const lines = TIMELINE_LINES[step];
      if (!lines) return { ...g, tech: pushTech(g, `${step}: ${outcome} ${message}`) };
      const key = `check:${step}`;
      const status: Activity["status"] = outcome === "failed" ? "failed" : "done";
      const label = outcome === "fixed" ? lines.fixed : outcome === "failed" ? lines.failed : lines.ok;
      return { ...g, activities: upsert(g.activities, { key, kind: outcome === "fixed" ? "repair" : "validation", status, label, tech: message || undefined }), tech: pushTech(g, `${step}: ${outcome} ${message}`) };
    }
    case "tool_step":
      return {
        ...g,
        timeline: pushTimeline(g, {
          step: "agent_tool",
          outcome: e.isError ? "failed" : "ok",
          message: str("label"),
          ts: typeof e.ts === "number" ? e.ts : (g.timeline[g.timeline.length - 1]?.ts ?? 0),
        }),
        tech: pushTech(g, `tool: ${str("label")}${e.isError ? " (error)" : ""}`) };
    case "status": {
      const m = str("message");
      if (!m || FILLER.test(m)) return g;
      return { ...g, tech: pushTech(g, m) };
    }
    case "recovering":
      return { ...g, recovering: true, current: "Reconnecting to the AI service", activities: upsert(settle(g.activities, "recovery"), { key: "recovery", kind: "recovery", status: "active", label: "Switched to a backup AI service" }) };
    case "result": {
      const noFileChanges = Boolean(e.noFileChanges);
      const acts = settle(g.activities).map((a) => (a.key === "assets" ? { ...a, status: "done" as const } : a));
      return {
        ...g,
        noFileChanges,
        recovering: false,
        activities: noFileChanges ? acts : upsert(acts, { key: "save", kind: "save", status: "done", label: "Saved your changes" }),
      };
    }
    case "turn_outcome": {
      const o = str("outcome");
      if (o === "applied" || o === "answered" || o === "blocked" || o === "failed") return { ...g, outcome: o };
      return g;
    }
    case "error":
      return {
        ...g,
        error: { message: str("message") || "Kimble couldn't finish this build.", kind: str("kind") || undefined, raw: str("raw") || undefined },
        tech: pushTech(g, `error${str("kind") ? ` [${str("kind")}]` : ""}: ${str("raw") || str("message")}`),
      };
    case "done": {
      const s = str("status");
      const done = (["succeeded", "failed", "aborted", "awaiting_credits", "plan_proposed"] as const).find((x) => x === s) ?? "succeeded";
      const acts = done === "succeeded" ? g.activities.map((a) => (a.status === "active" ? { ...a, status: "done" as const } : a)) : g.activities.map((a) => (a.status === "active" ? { ...a, status: "failed" as const } : a));
      return { ...g, done, current: null, recovering: false, activities: acts };
    }
    default:
      return g;
  }
}

function eventKey(e: RawTurnEvent): string | null {
  if (typeof e.seq === "number" && e.seq > 0) return `s${e.seq}`;
  return null;
}

export function turnReducer(state: TurnState, action: TurnAction): TurnState {
  switch (action.type) {
    case "reset":
      return initialTurnState;
    case "turn_started":
      if (state.turnId === action.turnId) return state;
      return { ...initialTurnState, turnId: action.turnId, baselineBuildId: action.baselineBuildId };
    case "stop_requested":
      if (isTerminal(deriveLifecycle(state)) || state.stop.phase !== "none") return state;
      return { ...state, stop: { phase: "requested" } };
    case "stop_result":
      if (state.stop.phase === "none") return state;
      if (action.result === "unconfirmed" && state.stop.phase !== "requested") return state;
      return { ...state, stop: { phase: action.result } };
    case "deploy": {
      const snap = action.snapshot;
      if (!snap || !state.turnId) return state;
      if (snap.buildId === state.baselineBuildId) return state;
      if (state.stop.phase === "cancelled" || state.gen.done === "aborted") return state;
      const prev = state.deploy;
      // A newer build row replaces an older one; within one row, status only
      // moves forward (pending → building → ready|failed).
      if (prev && prev.buildId === snap.buildId) {
        const rank = { pending: 0, building: 1, ready: 2, failed: 2 } as const;
        if (rank[snap.status] < rank[prev.status]) return state;
        if (rank[prev.status] === 2 && prev.status !== snap.status) return state;
      }
      return { ...state, deploy: snap };
    }
    case "event": {
      const e = action.event;
      if (!state.turnId) return state;
      // Replay from the very beginning: rebuild derived state from the durable
      // log. Live events already applied are replaced, never double counted.
      if (e.type === "resume_start") {
        const after = typeof e.after === "number" ? e.after : 0;
        if (after === 0) return { ...state, gen: emptyGen() };
        return state;
      }
      if (e.type === "resume_timeout") return state;
      const g = state.gen;
      // Terminal generation state is final.
      if (g.done) return state;
      // Stop won: nothing after confirmation may resurrect the turn.
      if (state.stop.phase === "cancelled") return state;
      const key = eventKey(e);
      if (key) {
        const seq = e.seq as number;
        if (seq <= g.lastSeq || g.seen.includes(key)) return state;
        const next = applyEvent(g, e);
        return { ...state, gen: { ...next, lastSeq: seq, seen: [...g.seen, key].slice(-2000) } };
      }
      // Live event (no seq). Applied in arrival order; a later full replay
      // (resume_start after=0) rebuilds from the durable log instead.
      const next = applyEvent(g, e);
      return { ...state, gen: { ...next, liveCount: g.liveCount + 1 } };
    }
  }
}

// ─── Derived view ──────────────────────────────────────────────────────────

const TERMINAL: Lifecycle[] = ["cancelled", "failed", "answered", "awaiting_approval", "paused", "build_failed", "verify_failed", "ready"];
export function isTerminal(l: Lifecycle): boolean {
  return TERMINAL.includes(l);
}

export function deriveLifecycle(s: TurnState): Lifecycle {
  if (!s.turnId) return "idle";
  const g = s.gen;
  if (g.done === "aborted" || s.stop.phase === "cancelled") return "cancelled";
  if (g.done === "failed") return "failed";
  if (g.done === "plan_proposed") return "awaiting_approval";
  if (g.done === "awaiting_credits") return "paused";
  if (g.done === "succeeded") {
    if (g.noFileChanges || g.outcome === "answered") return "answered";
    if (g.outcome === "failed" || g.outcome === "blocked") return "failed";
    const d = s.deploy;
    if (!d) return "generated";
    if (d.status === "pending" || d.status === "building") return "building";
    if (d.status === "failed") return "build_failed";
    if (d.verification && !d.verification.ok && !d.verification.skipped) return "verify_failed";
    return "ready";
  }
  if (s.stop.phase === "requested" || s.stop.phase === "unconfirmed") return "stopping";
  return "running";
}

export type TurnView = {
  lifecycle: Lifecycle;
  headline: string;
  detail: string | null;
  completed: Activity[];
  current: Activity | null;
  failedSteps: Activity[];
  filesChanged: number;
  assets: string[];
  error: GenState["error"];
  stop: StopState["phase"];
  tech: string[];
  deploy: DeploySnapshot | null;
  hasActivity: boolean;
  /** Legacy-shaped projections for the Details sheet / image strip. */
  writtenPaths: string[];
  completedPaths: Set<string>;
  latestPath: string | undefined;
  latestNarration: string | undefined;
  buildSteps: string[];
  activeStepIndex: number;
  doneStepIndexes: number[];
  timeline: TimelineItem[];
};

export function deriveView(s: TurnState): TurnView {
  const lifecycle = deriveLifecycle(s);
  const g = s.gen;
  const d = s.deploy;
  const acts = [...g.activities];
  if (g.done === "succeeded" && !g.noFileChanges && g.outcome !== "answered") {
    if (d?.status === "pending" || d?.status === "building") {
      acts.push({ key: "build", kind: "build", status: "active", label: "Building your application", tech: d.progressLabel ?? undefined });
    } else if (d?.status === "failed") {
      acts.push({ key: "build", kind: "build", status: "failed", label: "The app build failed", tech: d.errorMessage ?? undefined });
    } else if (d?.status === "ready") {
      acts.push({ key: "build", kind: "build", status: "done", label: "Built your application" });
      if (d.verification?.skipped) acts.push({ key: "verify", kind: "verify", status: "done", label: "Live check skipped", tech: d.verification.skipped });
      else if (d.verification?.ok) acts.push({ key: "verify", kind: "verify", status: "done", label: "Checked your live pages" });
      else if (d.verification && !d.verification.ok) acts.push({ key: "verify", kind: "verify", status: "failed", label: "The live check found problems", tech: d.verification.defects.join("; ") });
    }
  }
  const actives = acts.filter((a) => a.status === "active");
  const current = [...actives].reverse().find((a) => !a.key.startsWith("step:")) ?? actives[actives.length - 1] ?? null;
  const completed = acts.filter((a) => a.status === "done");
  const failedSteps = acts.filter((a) => a.status === "failed");

  const HEAD: Record<Lifecycle, string> = {
    idle: "",
    running: current?.label ?? g.current ?? "Getting started",
    stopping: "Stopping…",
    cancelled: "Stopped — nothing further will run",
    failed: "Kimble couldn't finish this build",
    answered: "Answered — no changes needed",
    awaiting_approval: "Waiting for your go-ahead",
    paused: "Paused — add credits to continue",
    generated: "Changes saved — preparing your app",
    building: "Building your application",
    build_failed: "Your changes were saved, but the app build failed",
    verify_failed: "Built, but the live check found problems",
    ready: "Your app is ready",
  };
  let detail: string | null = null;
  if (lifecycle === "running") detail = g.recovering ? "Your progress is kept." : null;
  if (lifecycle === "building") detail = d?.progressLabel ?? null;
  if (lifecycle === "failed") detail = g.error?.message ?? null;
  if (lifecycle === "build_failed") detail = d?.errorMessage ?? null;
  if (lifecycle === "verify_failed") detail = d?.verification?.defects[0] ?? null;
  if (lifecycle === "stopping" && s.stop.phase === "unconfirmed") detail = "Couldn't confirm yet — check your connection.";
  if (s.stop.phase === "completion_won" && !isTerminal(lifecycle)) detail = "This request had already finished — showing the result.";

  const tech = [...g.tech];
  if (d) tech.push(`build ${d.buildId.slice(0, 8)}: ${d.status}${d.progressLabel ? ` — ${d.progressLabel}` : ""}`);

  return {
    lifecycle,
    headline: HEAD[lifecycle],
    detail,
    completed,
    current: lifecycle === "running" || lifecycle === "building" || lifecycle === "generated" ? current : null,
    failedSteps,
    filesChanged: Object.keys(g.files).length,
    assets: g.assets,
    error: g.error,
    stop: s.stop.phase,
    tech,
    deploy: d,
    hasActivity: acts.length > 0 || lifecycle !== "running",
    writtenPaths: g.paths,
    completedPaths: new Set(Object.entries(g.files).filter(([, f]) => f.status !== "writing").map(([p]) => p)),
    latestPath: g.latestPath ?? undefined,
    latestNarration: g.latestNarration ?? undefined,
    buildSteps: g.steps,
    activeStepIndex: (() => {
      const a = g.activities.find((x) => x.key.startsWith("step:") && x.status === "active");
      return a ? Number(a.key.slice(5)) : -1;
    })(),
    doneStepIndexes: g.activities.filter((x) => x.key.startsWith("step:") && x.status === "done").map((x) => Number(x.key.slice(5))),
    timeline: g.timeline,
  };
}
