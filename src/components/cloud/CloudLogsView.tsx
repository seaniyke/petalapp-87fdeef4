/**
 * CloudLogsView — placeholder for edge-function and database logs.
 * Wiring real log streaming requires an analytics_query proxy on the
 * project's managed backend; tracked separately. We render a friendly
 * "coming soon" so the panel stays consistent.
 */
import { ScrollText } from "lucide-react";

export function CloudLogsView() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ScrollText className="h-4 w-4" />
        <span>Logs</span>
      </div>
      <div className="rounded-2xl bg-muted/40 p-6 text-sm text-muted-foreground">
        Edge function and database logs will stream here in a future update.
        For now, you can inspect runtime errors directly in the chat as you
        build.
      </div>
    </div>
  );
}
