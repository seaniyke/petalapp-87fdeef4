/**
 * ConnectorsSheet — third-party services your app can talk to.
 *
 * Wraps the existing integrations marketplace so connectors are reachable
 * as their own destination from the builder menu, not buried in settings.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Plug } from "lucide-react";
import { IntegrationsSection } from "@/components/IntegrationsSection";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

export function ConnectorsSheet({ open, onOpenChange, projectId }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" /> Connectors
          </SheetTitle>
          <SheetDescription>
            Connect your app to the services it needs. Petal wires the SDK and
            asks for any keys it needs along the way.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-2">
          <IntegrationsSection projectId={projectId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
