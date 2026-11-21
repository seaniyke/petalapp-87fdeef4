/**
 * Fluid experience primitives shipped to every generated app.
 *
 * Agency-grade interfaces are built from tactile choices, short step flows,
 * calm disclosures and layered surfaces — not bordered boxes and long forms.
 * Shipping them means the model composes with them instead of hand-rolling
 * rigid HTML. Import from "@/components/flow". Tokens only, reduced-motion safe.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

const INDEX = `// Fluid experience primitives. Import from "@/components/flow".
export { Surface } from "./surface";
export { ChoiceGrid } from "./choice-grid";
export type { Choice } from "./choice-grid";
export { StepFlow } from "./step-flow";
export type { FlowStep } from "./step-flow";
export { Disclosure } from "./disclosure";
export type { DisclosureItem } from "./disclosure";
export { SegmentedControl } from "./segmented-control";
export type { Segment } from "./segmented-control";
export { FieldGroup, FieldRow } from "./field-group";
export { HeroVideo } from "./hero-video";
`;

const SURFACE = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Layered panel: soft radius, gentle depth. tone="glass" floats over imagery. */
export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "solid" | "glass" | "muted";
}
export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ tone = "solid", className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-3xl p-6 md:p-10 transition-shadow duration-500",
        tone === "solid" && "bg-card text-card-foreground shadow-[0_24px_60px_-30px_color-mix(in_oklch,var(--foreground)_30%,transparent)]",
        tone === "glass" && "glass",
        tone === "muted" && "bg-muted",
        className,
      )}
      {...rest}
    />
  ),
);
Surface.displayName = "Surface";
`;

const CHOICE_GRID = `import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface Choice { value: string; label: string; hint?: string; meta?: string; image?: string }
export interface ChoiceGridProps {
  choices: Choice[];
  value?: string | string[];
  onChange?: (value: any) => void;
  multiple?: boolean;
  columns?: 1 | 2 | 3;
  className?: string;
}

/** Tactile selectable cards (services, sizes, times, plans). Replaces radios/selects. */
export function ChoiceGrid({ choices, value, onChange, multiple, columns = 2, className }: ChoiceGridProps) {
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const toggle = (v: string) => {
    if (!onChange) return;
    if (!multiple) return onChange(v);
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange([...next]);
  };
  return (
    <div role={multiple ? "group" : "radiogroup"} className={cn("grid gap-3", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3", className)}>
      {choices.map((c) => {
        const on = selected.has(c.value);
        return (
          <motion.button
            key={c.value}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={on}
            onClick={() => toggle(c.value)}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "group relative flex w-full items-start gap-4 overflow-hidden rounded-2xl p-5 text-left transition-colors duration-300",
              "bg-card ring-1 ring-border hover:ring-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on && "ring-2 ring-primary bg-accent text-accent-foreground",
            )}
          >
            {c.image ? <img src={c.image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : null}
            <span className="flex-1">
              <span className="block font-medium">{c.label}</span>
              {c.hint ? <span className="mt-1 block text-sm text-muted-foreground">{c.hint}</span> : null}
            </span>
            {c.meta ? <span className="text-sm font-medium tabular-nums">{c.meta}</span> : null}
          </motion.button>
        );
      })}
    </div>
  );
}
`;

const STEP_FLOW = `import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface FlowStep { title: string; content: React.ReactNode; canContinue?: boolean }
export interface StepFlowProps {
  steps: FlowStep[];
  onComplete?: () => void;
  finishLabel?: string;
  className?: string;
}

/** Short, one-question-per-step flow with progress and spring transitions (booking, onboarding, checkout). */
export function StepFlow({ steps, onComplete, finishLabel = "Confirm", className }: StepFlowProps) {
  const [i, setI] = React.useState(0);
  const step = steps[i];
  if (!step) return null;
  const last = i === steps.length - 1;
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-8 flex gap-1.5" aria-hidden>
        {steps.map((_, n) => (
          <span key={n} className={cn("h-1 flex-1 rounded-full transition-colors duration-500", n <= i ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Step {i + 1} of {steps.length}</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
        >
          <h3 className="mt-2 mb-6 text-2xl md:text-3xl font-medium tracking-tight">{step.title}</h3>
          {step.content}
        </motion.div>
      </AnimatePresence>
      <div className="mt-10 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="h-12 rounded-full px-5 text-sm text-muted-foreground transition-opacity disabled:opacity-0">
          Back
        </button>
        <button
          type="button"
          disabled={step.canContinue === false}
          onClick={() => (last ? onComplete?.() : setI((n) => n + 1))}
          className="h-12 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          {last ? finishLabel : "Continue"}
        </button>
      </div>
    </div>
  );
}
`;

const DISCLOSURE = `import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface DisclosureItem { title: string; body: React.ReactNode }

/** Calm fold-out for policies, prep notes, FAQs and fine print. Never a warning banner. */
export function Disclosure({ items, className }: { items: DisclosureItem[]; className?: string }) {
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className={cn("divide-y divide-border/60", className)}>
      {items.map((it, n) => {
        const on = open === n;
        return (
          <div key={n}>
            <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : n)} className="flex w-full items-center justify-between gap-6 py-5 text-left">
              <span className="font-medium">{it.title}</span>
              <span className={cn("text-xl leading-none text-muted-foreground transition-transform duration-300", on && "rotate-45")} aria-hidden>+</span>
            </button>
            <AnimatePresence initial={false}>
              {on ? (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                  <div className="pb-6 max-w-prose text-muted-foreground leading-relaxed">{it.body}</div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
`;

const SEGMENTED = `import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface Segment { value: string; label: React.ReactNode }

/** Apple-style segmented control with a sliding thumb. Use for 2–5 short choices. */
export function SegmentedControl({ segments, value, onChange, className, ariaLabel }: { segments: Segment[]; value: string; onChange: (v: string) => void; className?: string; ariaLabel?: string }) {
  const id = React.useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex w-full rounded-xl bg-muted/60 p-1", className)}>
      {segments.map((s) => {
        const on = s.value === value;
        return (
          <button key={s.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(s.value)}
            className={cn("relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {on ? <motion.span layoutId={id} className="absolute inset-0 rounded-lg bg-background shadow-sm ring-1 ring-border/60" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <span className="relative">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
`;

const FIELD_GROUP = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Grouped inset list (iOS Settings / Apple checkout): related fields in one soft panel with hairlines. */
export function FieldGroup({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {title ? <p className="mb-2 px-1 text-sm font-medium text-muted-foreground">{title}</p> : null}
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur">{children}</div>
    </div>
  );
}

/** One row inside a FieldGroup: label on the left (or top on phones), borderless control on the right. */
export function FieldRow({ label, htmlFor, children, className }: { label: React.ReactNode; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium sm:w-40 sm:shrink-0">{label}</label>
      <div className="flex-1 [&_input]:h-9 [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0 [&_input]:shadow-none [&_input]:ring-0">{children}</div>
    </div>
  );
}
`;

const HERO_VIDEO = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Full-bleed looping video hero background. Muted + inline so it autoplays on
 * phones; shows the poster still when the visitor prefers reduced motion.
 * Put the headline in children — it sits over a scrim so it always reads.
 */
export function HeroVideo({ src, poster, children, className, scrim = "from-black/70 via-black/30 to-black/10" }: { src: string; poster?: string; children?: React.ReactNode; className?: string; scrim?: string }) {
  const [still, setStill] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(mq.matches);
  }, []);
  return (
    <section className={cn("relative isolate flex min-h-[88svh] w-full items-end overflow-hidden", className)}>
      {still && poster ? (
        <img src={poster} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
      ) : (
        <video className="absolute inset-0 -z-10 h-full w-full object-cover" src={src} poster={poster} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
      )}
      <div className={cn("absolute inset-0 -z-10 bg-gradient-to-t", scrim)} aria-hidden="true" />
      <div className="w-full text-white">{children}</div>
    </section>
  );
}
`;

export const KIT_FLOW_FILES: KitFile[] = [
  { path: "src/components/flow/index.ts", content: INDEX, overwrite: true },
  { path: "src/components/flow/surface.tsx", content: SURFACE, overwrite: true },
  { path: "src/components/flow/choice-grid.tsx", content: CHOICE_GRID, overwrite: true },
  { path: "src/components/flow/step-flow.tsx", content: STEP_FLOW, overwrite: true },
  { path: "src/components/flow/disclosure.tsx", content: DISCLOSURE, overwrite: true },
  { path: "src/components/flow/segmented-control.tsx", content: SEGMENTED, overwrite: true },
  { path: "src/components/flow/field-group.tsx", content: FIELD_GROUP, overwrite: true },
  { path: "src/components/flow/hero-video.tsx", content: HERO_VIDEO, overwrite: true },
];
