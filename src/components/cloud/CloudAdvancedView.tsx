/**
 * CloudAdvancedView — danger-zone actions for the project's managed backend.
 * Currently surfaces the existing disconnect flow; instance sizing will land
 * once infra exposes the resize endpoint.
 */
import { useState } from "react";
import { AlertTriangle, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disconnectProjectBackend } from "@/lib/projects";
import { toast } from "sonner";

type Props = {
  projectId: string;
  onDisconnected?: () => void;
};

export function CloudAdvancedView({ projectId, onDisconnected }: Props) {
  const [busy, setBusy] = useState(false);

  const onDisconnect = async () => {
    if (
      !confirm(
        "Disconnect this backend? Your generated app will lose access on the next change.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await disconnectProjectBackend(projectId);
      toast.success("Backend disconnected");
      onDisconnected?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl bg-muted/40 p-5">
        <div className="text-sm font-semibold">Instance size</div>
        <p className="mt-1 text-xs text-muted-foreground">
          All Petal Cloud projects run on our shared baseline tier today.
          Dedicated sizing will arrive soon — reach out if you need more
          headroom in the meantime.
        </p>
      </div>

      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Disconnecting removes the link between this project and its managed
          backend. Your generated app will stop reading and writing data on
          the next build.
        </p>
        <Button
          variant="destructive"
          size="sm"
          className="mt-3"
          onClick={onDisconnect}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Unplug className="mr-1 h-3.5 w-3.5" />
          )}
          Disconnect backend
        </Button>
      </div>
    </div>
  );
}
