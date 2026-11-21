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

export const KIT_FLOW_FILES: KitFile[] = [
  { path: "src/components/flow/index.ts", content: INDEX, overwrite: true },
  { path: "src/components/flow/surface.tsx", content: SURFACE, overwrite: true },
  { path: "src/components/flow/choice-grid.tsx", content: CHOICE_GRID, overwrite: true },
  { path: "src/components/flow/step-flow.tsx", content: STEP_FLOW, overwrite: true },
  { path: "src/components/flow/disclosure.tsx", content: DISCLOSURE, overwrite: true },
];
