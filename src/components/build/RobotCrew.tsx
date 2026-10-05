/**
 * The Kimble crew — four small robots that show which part of the work is
 * happening right now. Purely presentational: the active robot comes from the
 * real build phase, never from a timer, so the animation never fakes progress.
 */
import type { PhaseId } from "@/lib/build-phases";

type CrewId = "architect" | "builder" | "inspector" | "launcher";

const CREW: { id: CrewId; name: string; task: string; phases: PhaseId[] }[] = [
  { id: "architect", name: "Architect", task: "Planning", phases: ["thinking", "designing"] },
  { id: "builder", name: "Builder", task: "Building", phases: ["writing"] },
  { id: "inspector", name: "Inspector", task: "Checking", phases: ["polishing"] },
  { id: "launcher", name: "Launcher", task: "Launching", phases: ["deploying", "live"] },
];

function Tool({ id }: { id: CrewId }) {
  switch (id) {
    case "architect":
      // holographic blueprint
      return (
        <g className="crew-tool">
          <path d="M8 44 L22 30 L22 52 Z" className="fill-primary/20" />
          <rect x="2" y="44" width="14" height="10" rx="1.5" className="fill-none stroke-primary" strokeWidth="1.2" />
          <path d="M5 49h8M5 51.5h5" className="stroke-primary" strokeWidth="1" />
        </g>
      );
    case "builder":
      // hammer + spark
      return (
        <g className="crew-tool">
          <rect x="44" y="34" width="2.5" height="16" rx="1" className="fill-muted-foreground" />
          <rect x="40" y="31" width="11" height="5" rx="1.2" className="fill-foreground/80" />
          <circle cx="45" cy="54" r="1.6" className="crew-spark fill-primary" />
        </g>
      );
    case "inspector":
      // magnifier + scan beam
      return (
        <g className="crew-tool">
          <path d="M34 22 L54 54 L14 54 Z" className="crew-beam fill-primary/15" />
          <circle cx="45" cy="38" r="5" className="fill-background stroke-foreground/80" strokeWidth="1.6" />
          <path d="M48.5 41.5l4 4" className="stroke-foreground/80" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "launcher":
      // thruster flame
      return (
        <g className="crew-tool">
          <path d="M26 56 Q32 66 38 56 Z" className="crew-flame fill-primary" />
          <path d="M29 56 Q32 61 35 56 Z" className="crew-flame fill-background/80" />
        </g>
      );
  }
}

function Robot({ id, active, done }: { id: CrewId; active: boolean; done: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`h-11 w-11 overflow-visible transition-all duration-500 ${
        active ? "crew-active scale-110 opacity-100" : done ? "opacity-70" : "opacity-35 grayscale"
      }`}
      aria-hidden
    >
      <g className={active ? "crew-body" : undefined}>
        {/* antenna */}
        <line x1="32" y1="8" x2="32" y2="14" className="stroke-foreground/70" strokeWidth="1.6" />
        <circle cx="32" cy="7" r="2.4" className={active ? "crew-blink fill-primary" : "fill-muted-foreground"} />
        {/* head */}
        <rect x="18" y="14" width="28" height="20" rx="7" className="fill-card stroke-foreground/70" strokeWidth="1.6" />
        <rect x="22" y="19" width="20" height="10" rx="4" className="fill-foreground/90" />
        <circle cx="28" cy="24" r="2" className={active ? "crew-eyes fill-primary" : "fill-muted-foreground"} />
        <circle cx="36" cy="24" r="2" className={active ? "crew-eyes fill-primary" : "fill-muted-foreground"} />
        {/* body */}
        <rect x="22" y="36" width="20" height="18" rx="5" className="fill-card stroke-foreground/70" strokeWidth="1.6" />
        <rect x="28" y="41" width="8" height="5" rx="1.5" className={done ? "fill-primary/60" : "fill-muted"} />
        {/* arms */}
        <path d="M22 40 L16 46" className="stroke-foreground/70" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M42 40 L46 44" className={`stroke-foreground/70 ${active ? "crew-arm" : ""}`} strokeWidth="2.2" strokeLinecap="round" />
        {active && <Tool id={id} />}
      </g>
      {/* shadow */}
      <ellipse cx="32" cy="60" rx="10" ry="1.8" className={`fill-foreground/10 ${active ? "crew-shadow" : ""}`} />
    </svg>
  );
}

export function RobotCrew({
  phaseId,
  active,
  failed,
}: {
  phaseId?: PhaseId;
  active: boolean;
  failed?: boolean;
}) {
  const activeIdx = CREW.findIndex((c) => phaseId && c.phases.includes(phaseId));

  return (
    <div className="kimble-crew border-t border-border/60 px-3.5 py-3" data-testid="robot-crew">
      <div className="relative grid grid-cols-4 gap-1">
        {/* conveyor line connecting the crew */}
        <div className="pointer-events-none absolute inset-x-6 top-[22px] h-px bg-border" aria-hidden />
        <div
          className="pointer-events-none absolute left-6 top-[22px] h-px bg-primary transition-all duration-700"
          style={{ width: activeIdx < 0 ? 0 : `calc(${(activeIdx / (CREW.length - 1)) * 100}% - ${(activeIdx / (CREW.length - 1)) * 3}rem)` }}
          aria-hidden
        />
        {CREW.map((c, i) => {
          const isActive = active && !failed && i === activeIdx;
          const isDone = activeIdx > i;
          return (
            <div key={c.id} className="relative flex flex-col items-center gap-1">
              <div className="relative rounded-md bg-card/80 px-1">
                <Robot id={c.id} active={isActive} done={isDone} />
              </div>
              <span
                className={`text-[10.5px] font-semibold leading-none ${
                  isActive ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {c.name}
              </span>
              <span className="h-3 text-[9.5px] leading-none text-muted-foreground">
                {isActive ? <span className="petal-shimmer">{c.task}…</span> : isDone ? "Done" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
