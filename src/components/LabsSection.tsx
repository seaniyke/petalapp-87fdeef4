/**
 * LabsSection — toggles for experimental features. Lives in
 * Project Settings (per-user, not per-project, but rendered there because
 * that's where the rest of the gear-icon settings live).
 */
import { Beaker, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { LABS_FLAGS, useLabsFlags, type LabsFlagName } from "@/hooks/use-labs-flags";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { toast } from "sonner";

export function LabsSection() {
  const { flags, loading, setFlag } = useLabsFlags();
  const { isAdmin } = useIsAdmin();
  const flagNames = Object.keys(LABS_FLAGS) as LabsFlagName[];

  async function handleToggle(name: LabsFlagName, value: boolean) {
    try {
      await setFlag(name, value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update flag");
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Beaker className="h-4 w-4" /> Labs
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Experimental features. They may change, break, or disappear.
        {isAdmin && (
          <span className="ml-1 italic">(Admins see all flags forced on.)</span>
        )}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading flags…
        </div>
      ) : (
        <ul className="space-y-3">
          {flagNames.map((name) => {
            const meta = LABS_FLAGS[name];
            const checked = Boolean(flags[name]);
            return (
              <li
                key={name}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{meta.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                <Switch
                  checked={checked}
                  disabled={isAdmin}
                  onCheckedChange={(v) => handleToggle(name, v)}
                  aria-label={`Toggle ${meta.title}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
