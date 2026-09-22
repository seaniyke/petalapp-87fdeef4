/**
 * What Kimble checked on your app — in plain language, with the proof.
 *
 * This is the customer-facing half of the Test Lab. It never shows raw agent
 * traces, selectors or stack internals: one headline, the checks that matter,
 * and the screenshots Kimble took while driving the live app. A check Kimble
 * could not run says so — it is never counted as working.
 */
import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, CircleSlash, Loader2, MinusCircle } from "lucide-react";
import { getProjectTestRun, type TestCaseView, type TestRunView } from "@/lib/test-lab.functions";

const STATUS_META: Record<
  string,
  { label: string; Icon: typeof CheckCircle2; tone: string }
> = {
  passed: { label: "Works", Icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Did not work", Icon: CircleAlert, tone: "text-destructive" },
  blocked: { label: "Could not check", Icon: CircleSlash, tone: "text-amber-600 dark:text-amber-400" },
  skipped: { label: "Not checked", Icon: MinusCircle, tone: "text-muted-foreground" },
};

function CaseRow({ item }: { item: TestCaseView }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[item.status] ?? STATUS_META.skipped;
  const { Icon } = meta;
  const hasDetail =
    Boolean(item.reason || item.actual || item.url) ||
    item.screenshots.length > 0 ||
    item.pageErrors.length > 0 ||
    item.failedRequests.length > 0;

  return (
    <li className="border-t border-border py-2 first:border-t-0">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.tone}`} aria-hidden />
        <span className="flex-1">{item.title}</span>
        <span className={`text-xs ${meta.tone}`}>{meta.label}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-6 text-xs text-muted-foreground">
          {item.reason && <p>{item.reason}</p>}
          {item.url && <p className="break-all">Page: {item.url}</p>}
          {item.actual && <p className="break-words">What appeared: {item.actual}</p>}
          {item.pageErrors.length > 0 && (
            <p className="break-words">Page error: {item.pageErrors[0]}</p>
          )}
          {item.failedRequests.length > 0 && (
            <p className="break-words">Failed request: {item.failedRequests[0]}</p>
          )}
          {item.suppressed.length > 0 && (
            <p>
              Kimble blocked {item.suppressed.length} request
              {item.suppressed.length === 1 ? "" : "s"} so nothing real was charged or sent.
            </p>
          )}
          {item.screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.screenshots.map((src) => (
                <a key={src} href={src} target="_blank" rel="noreferrer">
                  <img
                    src={src}
                    alt={`Screenshot from the check: ${item.title}`}
                    loading="lazy"
                    className="h-24 w-auto rounded border border-border object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function TestResultsCard() {
  const search = useSearch({ strict: false }) as { id?: string };
  const projectId = typeof search?.id === "string" ? search.id : undefined;
  const load = useServerFn(getProjectTestRun);
  const [run, setRun] = useState<TestRunView | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const fetchRun = async () => {
      try {
        const data = await load({ data: { projectId } });
        if (!cancelled) setRun(data);
      } catch {
        /* the card simply stays hidden if results cannot be read */
      }
    };
    void fetchRun();
    const timer = setInterval(fetchRun, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, load]);

  if (!run) return null;
  const running = run.status === "running";
  const { totals } = run;

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : totals.failed > 0 ? (
          <CircleAlert className="h-4 w-4 text-destructive" aria-hidden />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        )}
        <span>What Kimble checked</span>
      </div>

      <p className="mt-2 text-muted-foreground">{run.headline}</p>
      {run.blockedReason && <p className="mt-1 text-muted-foreground">{run.blockedReason}</p>}

      {run.cases.length > 0 && (
        <ul className="mt-3">
          {run.cases.map((c) => (
            <CaseRow key={c.caseKey} item={c} />
          ))}
        </ul>
      )}

      {totals.skipped > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {totals.skipped} lower-priority check{totals.skipped === 1 ? "" : "s"} were left out to
          keep the build quick.
        </p>
      )}
    </div>
  );
}
