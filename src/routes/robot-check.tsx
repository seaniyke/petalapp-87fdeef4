import { createFileRoute } from "@tanstack/react-router";
import { RobotCrew } from "@/components/build/RobotCrew";
import { robotActivity } from "@/lib/robot-activity";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Stage } from "@/lib/turn-execution/turn-reducer";
export const Route = createFileRoute("/robot-check")({ component: Check });
function Check() {
  const [stage, setStage] = useState<Stage>("understanding");
  const [lifecycle, setLifecycle] = useState("running");
  return <main className="mx-auto max-w-xl px-5 py-10"><h1>Robotics verification fixture</h1><div className="flex flex-wrap gap-2">{["understanding", "planning", "writing", "verifying", "building", "ready", "failed", "cancelled"].map(s => <Button key={s} onClick={() => { setStage(s as Stage); setLifecycle(["ready", "failed", "cancelled"].includes(s) ? s : "running"); }}>{s}</Button>)}</div><RobotCrew {...robotActivity(lifecycle, stage, { busy: true })} /></main>;
}