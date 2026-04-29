/**
 * Inline chat card: "Petal needs an API key."
 *
 * Streamed by the AI as `<lov-add-secret name="..." instructions="..." link="..." />`,
 * extracted by MarkdownMessage, and rendered here. Stays mounted across
 * streaming chunks so the user can submit the value as soon as it appears.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  cancelSecretRequest,
  createSecretRequestFromChat,
  fulfillSecretRequest,
} from "@/server/secrets/requests.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, ExternalLink, CheckCircle2 } from "lucide-react";

export function SecretRequestCard(props: {
  /** When omitted, the card auto-creates a pending request using projectId. */
  requestId?: string | null;
  projectId?: string | null;
  name: string;
  instructions?: string;
  link?: string;
}) {
  const [resolvedId, setResolvedId] = useState<string | null>(props.requestId ?? null);
  const [value, setValue] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fulfill = useMutation({
    mutationFn: async () => {
      if (!resolvedId) throw new Error("This secret request expired — ask Petal again.");
      return fulfillSecretRequest({ data: { requestId: resolvedId, value } });
    },
    onSuccess: () => { setDone(true); setValue(""); setError(null); },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Could not save the secret.");
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!resolvedId) return { ok: true };
      return cancelSecretRequest({ data: { requestId: resolvedId } });
    },
    onSuccess: () => setDone(true),
  });

  // Auto-create a pending request the first time the tag appears in chat.
  useEffect(() => {
    setDone(false);
    setError(null);
    if (resolvedId || !props.projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await createSecretRequestFromChat({
          data: {
            projectId: props.projectId!,
            secretName: props.name,
            instructions: props.instructions,
            link: props.link,
          },
        });
        if (!cancelled) setResolvedId(res.request.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not initialize secret request.");
      }
    })();
    return () => { cancelled = true; };
  }, [props.projectId, props.name, props.instructions, props.link, resolvedId]);

  if (done) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-emerald-300/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-100">
        <CheckCircle2 className="h-4 w-4" />
        <span>
          Saved <code className="rounded bg-emerald-100 px-1 dark:bg-emerald-900/50">{props.name}</code> securely.
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Lock className="h-4 w-4 text-muted-foreground" />
        Petal needs <code className="rounded bg-muted px-1">{props.name}</code>
      </div>
      {props.instructions ? (
        <p className="mt-1 text-muted-foreground">{props.instructions}</p>
      ) : null}
      {props.link ? (
        <a
          href={props.link}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs underline text-muted-foreground"
        >
          Where to find this <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={fulfill.isPending}
        />
        <Button
          size="sm"
          onClick={() => fulfill.mutate()}
          disabled={!value || fulfill.isPending || !props.requestId}
        >
          {fulfill.isPending ? "Saving…" : "Save securely"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
        >
          Skip
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Stored encrypted (AES-256-GCM). Only your server code can read it.
      </p>
    </div>
  );
}
