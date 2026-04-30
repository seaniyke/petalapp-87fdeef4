/**
 * CloudSecretsView — list, add and remove encrypted environment variables.
 * Values are write-only: once set, only the name + timestamps are returned.
 */
import { useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listProjectSecrets,
  upsertProjectSecret,
  deleteProjectSecret,
  type CloudSecretRow,
} from "@/server/cloud-secrets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CloudEmptyState } from "./CloudEmptyState";

export function CloudSecretsView({ projectId }: { projectId: string }) {
  const fnList = useServerFn(listProjectSecrets);
  const fnUpsert = useServerFn(upsertProjectSecret);
  const fnDelete = useServerFn(deleteProjectSecret);

  const [loading, setLoading] = useState(true);
  const [secrets, setSecrets] = useState<CloudSecretRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setLoading(true);
      const r = await fnList({ data: { projectId } });
      setSecrets(r.secrets);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const onSave = async () => {
    if (!name.trim() || !value.trim()) return;
    setBusy(true);
    try {
      await fnUpsert({ data: { projectId, name, value } });
      toast.success(`${name.toUpperCase()} saved`);
      setName("");
      setValue("");
      setAdding(false);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save secret");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (n: string) => {
    if (!confirm(`Delete ${n}? Apps that use it will stop working.`)) return;
    try {
      await fnDelete({ data: { projectId, name: n } });
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="h-4 w-4" />
          <span>{secrets.length} secrets</span>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New secret
          </Button>
        )}
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl bg-muted/40 p-3">
          <Input
            placeholder="SECRET_NAME"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
          />
          <Input
            type="password"
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setName("");
                setValue("");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={busy || !name || !value}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : secrets.length === 0 && !adding ? (
        <CloudEmptyState
          title="No secrets yet"
          description="Store API keys and other sensitive values here. They're encrypted at rest and never shown again after saving."
        />
      ) : (
        <ul className="space-y-2">
          {secrets.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3 text-sm"
            >
              <div>
                <div className="font-mono text-sm font-medium">{s.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Updated {new Date(s.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(s.name)}
                className="text-muted-foreground transition hover:text-destructive"
                aria-label={`Delete ${s.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
