import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RobotCrew } from "@/components/build/RobotCrew";
import { Button } from "@/components/ui/button";
import { robotActivity } from "@/lib/robot-activity";
import type { Stage } from "@/lib/turn-execution/turn-reducer";
export const Route = createFileRoute("/robot-check")({ component: Check });
function Check() {
  const [stage, setStage] = useState<Stage>("writing");
  return <main className="mx-auto max-w-xl px-4 py-8"><h1>Workshop verification</h1><div className="flex flex-wrap gap-2">{(["understanding", "writing", "verifying", "building", "ready", "failed", "cancelled"] as Stage[]).map(s => <Button key={s} onClick={() => setStage(s)}>{s}</Button>)}</div><RobotCrew {...robotActivity(["ready", "failed", "cancelled"].includes(stage) ? stage : "running", stage, { busy: true })} /></main>;
}