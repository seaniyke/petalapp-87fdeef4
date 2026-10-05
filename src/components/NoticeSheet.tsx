import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, Bell } from "lucide-react";
import { subscribeNotices, toast, type Notice } from "@/lib/notify";

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
  default: Bell,
} as const;

const TONE = {
  success: "text-emerald-500",
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-primary",
  loading: "text-muted-foreground",
  default: "text-foreground",
} as const;

/** iOS-style bottom sheet that replaces toasts app-wide. */
export function NoticeSheet() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(
    () =>
      subscribeNotices((n) => {
        if (n) {
          setNotice(n);
          setDragY(0);
          requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
        } else {
          setOpen(false);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!open || !notice || !Number.isFinite(notice.duration) || dragging) return;
    const t = setTimeout(() => toast.dismiss(notice.id), notice.duration);
    return () => clearTimeout(t);
  }, [open, notice, dragging]);

  if (!notice) return null;
  const Icon = ICONS[notice.kind];

  const onDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    const d = e.clientY - startY.current;
    setDragY(d > 0 ? d : d / 6);
  };
  const onUp = () => {
    startY.current = null;
    setDragging(false);
    if (dragY > 60) toast.dismiss(notice.id);
    else setDragY(0);
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center px-3"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      onTransitionEnd={() => {
        if (!open) setNotice(null);
      }}
    >
      <div
        role="status"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="pointer-events-auto w-full max-w-md touch-none select-none rounded-[22px] border border-border/60 bg-background/80 shadow-[0_20px_60px_-20px_hsl(0_0%_0%/0.45)] backdrop-blur-2xl backdrop-saturate-150"
        style={{
          transform: open ? `translate3d(0, ${dragY}px, 0)` : "translate3d(0, calc(100% + 24px), 0)",
          opacity: open ? 1 : 0.6,
          transition: dragging
            ? "none"
            : "transform 420ms cubic-bezier(0.32, 0.72, 0, 1), opacity 300ms ease",
          willChange: "transform",
        }}
      >
        <div className="flex justify-center pt-2">
          <span className="h-[5px] w-9 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-start gap-3 px-5 pb-4 pt-3">
          <Icon
            className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[notice.kind]} ${notice.kind === "loading" ? "animate-spin" : ""}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-snug text-foreground">{notice.title}</p>
            {notice.description && (
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                {notice.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          {notice.action && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                notice.action?.onClick();
                toast.dismiss(notice.id);
              }}
              className="h-10 flex-1 rounded-md bg-foreground text-[14px] font-medium text-background"
            >
              {notice.action.label}
            </button>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toast.dismiss(notice.id)}
            className="h-10 flex-1 rounded-md bg-muted text-[14px] font-medium text-foreground"
          >
            {notice.kind === "loading" ? "Hide" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
