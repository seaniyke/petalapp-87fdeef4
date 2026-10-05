// Kimble's single notice API. Replaces toasts app-wide: every notice is shown
// in an iOS-style bottom sheet (see components/NoticeSheet.tsx). The call
// shape mirrors the old toast API so callers stay unchanged.

export type NoticeKind = "default" | "success" | "error" | "warning" | "info" | "loading";

export type NoticeOptions = {
  id?: string | number;
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export type Notice = {
  id: string | number;
  kind: NoticeKind;
  title: string;
  description?: string;
  duration: number;
  action?: { label: string; onClick: () => void };
};

type Listener = (n: Notice | null) => void;
const listeners = new Set<Listener>();
let current: Notice | null = null;
let seq = 0;

function emit() {
  for (const l of listeners) l(current);
}

export function subscribeNotices(l: Listener) {
  listeners.add(l);
  l(current);
  return () => {
    listeners.delete(l);
  };
}

function show(kind: NoticeKind, title: unknown, opts: NoticeOptions = {}) {
  const id = opts.id ?? `n${++seq}`;
  current = {
    id,
    kind,
    title: typeof title === "string" ? title : String(title ?? ""),
    description: opts.description,
    duration:
      opts.duration ?? (kind === "loading" ? Infinity : kind === "error" ? 6000 : 4000),
    action: opts.action,
  };
  emit();
  return id;
}

function dismiss(id?: string | number) {
  if (!current) return;
  if (id !== undefined && current.id !== id) return;
  current = null;
  emit();
}

type NotifyFn = ((title: unknown, opts?: NoticeOptions) => string | number) & {
  success: (title: unknown, opts?: NoticeOptions) => string | number;
  error: (title: unknown, opts?: NoticeOptions) => string | number;
  warning: (title: unknown, opts?: NoticeOptions) => string | number;
  info: (title: unknown, opts?: NoticeOptions) => string | number;
  message: (title: unknown, opts?: NoticeOptions) => string | number;
  loading: (title: unknown, opts?: NoticeOptions) => string | number;
  dismiss: (id?: string | number) => void;
};

export const toast: NotifyFn = Object.assign(
  (title: unknown, opts?: NoticeOptions) => show("default", title, opts),
  {
    success: (t: unknown, o?: NoticeOptions) => show("success", t, o),
    error: (t: unknown, o?: NoticeOptions) => show("error", t, o),
    warning: (t: unknown, o?: NoticeOptions) => show("warning", t, o),
    info: (t: unknown, o?: NoticeOptions) => show("info", t, o),
    message: (t: unknown, o?: NoticeOptions) => show("default", t, o),
    loading: (t: unknown, o?: NoticeOptions) => show("loading", t, o),
    dismiss,
  },
);

export const notify = toast;
