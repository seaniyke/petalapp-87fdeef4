/**
 * IntegrationsSection — marketplace grid + install/remove dialogs.
 *
 * Gated by the `integrations_marketplace` Labs flag. Each card shows:
 *   - name, tagline, category badge
 *   - "Add" button (or "Installed ✓" + "Remove" if already installed)
 * Clicking "Add" opens a dialog with the integration's required fields.
 */
import { useEffect, useState } from "react";
import {
  Plug,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Trash2,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Field = {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  kind: "string" | "secret" | "url" | "domain";
  required?: boolean;
};

type CatalogEntry = {
  code: string;
  name: string;
  tagline: string;
  category: string;
  docsUrl?: string;
  requiresBackend: boolean;
  fields: Field[];
};

type Installed = {
  code: string;
  installedAt: string;
  publicValues: Record<string, string>;
};

async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export function IntegrationsSection({ projectId }: { projectId: string }) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [installed, setInstalled] = useState<Installed[] | null>(null);
  const [installing, setInstalling] = useState<CatalogEntry | null>(null);

  async function refresh() {
    const [catRes, listRes] = await Promise.all([
      fetch("/api/integrations?action=catalog"),
      authedFetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", projectId }),
      }),
    ]);
    if (catRes.ok) {
      const j = (await catRes.json()) as { integrations: CatalogEntry[] };
      setCatalog(j.integrations);
    }
    if (listRes.ok) {
      const j = (await listRes.json()) as { installed: Installed[] };
      setInstalled(j.installed);
    } else {
      setInstalled([]);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleRemove(entry: CatalogEntry) {
    const ok = window.confirm(
      `Remove ${entry.name}? This deletes the files Petal added during install. Your other code stays untouched.`,
    );
    if (!ok) return;
    const res = await authedFetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        projectId,
        integrationCode: entry.code,
      }),
    });
    if (res.ok) {
      toast.success(`${entry.name} removed`);
      await refresh();
    } else {
      toast.error(await res.text());
    }
  }

  return (
    <section id="settings-integrations" className="mt-8 scroll-mt-4 border-t border-border pt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Plug className="h-4 w-4" /> Integrations
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Add APIs, email, and analytics to this project. Petal writes the
        scaffold files and keeps your secrets server-side.
      </p>

      {catalog === null || installed === null ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : catalog.length === 0 ? (
        <p className="text-xs text-muted-foreground">No integrations available yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {catalog.map((entry) => {
            const isInstalled = installed.some((i) => i.code === entry.code);
            return (
              <li
                key={entry.code}
                className="rounded-lg border border-border/60 bg-muted/20 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{entry.name}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-secondary-foreground">
                        {entry.category}
                      </span>
                      {isInstalled && (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
                          title="Installed"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Installed
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {entry.tagline}
                    </p>
                    {entry.docsUrl && (
                      <a
                        href={entry.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Docs <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isInstalled ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(entry)}
                        className="h-7 px-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => setInstalling(entry)}
                        className="h-7 gap-1 px-2 text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {installing && (
        <InstallDialog
          entry={installing}
          projectId={projectId}
          onClose={() => setInstalling(null)}
          onInstalled={async () => {
            setInstalling(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

/* ---------------- install dialog ---------------- */

function InstallDialog({
  entry,
  projectId,
  onClose,
  onInstalled,
}: {
  entry: CatalogEntry;
  projectId: string;
  onClose: () => void;
  onInstalled: () => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          projectId,
          integrationCode: entry.code,
          fields: values,
        }),
      });
      if (!res.ok) {
        toast.error(await res.text());
        return;
      }
      toast.success(`${entry.name} installed`);
      await onInstalled();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Install {entry.name}</DialogTitle>
          <DialogDescription>{entry.tagline}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {entry.fields.map((f) => (
            <div key={f.id} className="space-y-1">
              <Label htmlFor={`fld-${f.id}`} className="text-xs">
                {f.label}
                {(f.required ?? true) && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              <Input
                id={`fld-${f.id}`}
                type={f.kind === "secret" ? "password" : "text"}
                placeholder={f.placeholder}
                autoComplete={f.kind === "secret" ? "off" : undefined}
                value={values[f.id] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.id]: e.target.value }))
                }
              />
              {f.description && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {f.description}
                </p>
              )}
            </div>
          ))}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-1.5">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Install
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
