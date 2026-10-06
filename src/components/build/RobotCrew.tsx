import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { PhaseId } from "@/lib/build-phases";
import type { RobotPalette } from "./RobotScene";

const Scene = lazy(() => import("./RobotScene"));
const roles = ["Architect", "Builder", "Inspector", "Launcher"];
const tasks = ["Planning", "Building", "Checking", "Launching"];
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function readPalette(element: HTMLElement): RobotPalette {
  const style = getComputedStyle(element);
  // Convert semantic CSS tokens to sRGB for the Three renderer.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  function color(token: string) {
    if (!context) return style.getPropertyValue(token).trim();
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = style.getPropertyValue(token).trim();
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r},${g},${b})`;
  }
  return {
    shell: color("--robot-shell"),
    joint: color("--robot-joint"),
    face: color("--robot-face"),
    light: color("--robot-light"),
    floor: color("--robot-floor"),
    line: color("--robot-line"),
  };
}
export function RobotCrew({
  phaseId = "thinking",
  active,
  failed = false,
}: {
  phaseId?: PhaseId;
  active: boolean;
  failed?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<RobotPalette | null>(null);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const selected =
    phaseId === "writing"
      ? 1
      : phaseId === "polishing"
        ? 2
        : ["deploying", "live"].includes(phaseId)
          ? 3
          : 0;
  const working = active && !failed;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const refresh = () => setPalette(readPalette(element));
    refresh();
    const theme = new MutationObserver(refresh);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    motion();
    media.addEventListener("change", motion);
    let intersecting = true;
    const visibility = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      visibility();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      theme.disconnect();
      observer.disconnect();
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const fallback = <div className="robot-fallback text-sm text-muted-foreground">{unavailable ? "Robotics unavailable" : "Preparing workshop…"}</div>;
  return (
    <div
      ref={container}
      className="kimble-robotics my-3 w-full"
      data-testid="robot-crew"
      data-active={working}
      data-moving={working && visible && !reduced && !unavailable}
      data-phase={phaseId}
      aria-label={`Kimble crew: ${failed ? "Stopped after an error" : working ? tasks[selected] : "At rest"}`}
    >
      <div className="robotics-scene" aria-hidden="true">
        {palette && !unavailable ? (
          <SceneBoundary fallback={fallback}>
            <Suspense fallback={fallback}>
              <Scene
                palette={palette}
                selected={selected}
                moving={working && visible && !reduced}
                onUnavailable={() => setUnavailable(true)}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          fallback
        )}
      </div>
      <div className="grid grid-cols-4 gap-1 text-center">
        {roles.map((role, i) => (
          <div key={role} className="min-w-0">
            <span
              className={`block text-[11px] font-semibold sm:text-xs ${selected === i ? "text-foreground" : "text-muted-foreground"}`}
            >
              {role}
            </span>
            <span className="block h-5 text-[10px] text-muted-foreground">
              {selected === i ? (failed ? "Stopped" : working ? `${tasks[i]}…` : "At rest") : "Standby"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
