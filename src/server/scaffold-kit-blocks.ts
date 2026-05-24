/**
 * Phase-1 expansion of the Petal scaffold: atoms + section blocks.
 *
 * Why this file exists separately from scaffold-kit.ts:
 *  - scaffold-kit.ts is already ~3,800 lines of inline component source.
 *  - The `kit-manifest.server.ts` parser walks `KIT_FILES` for files under
 *    `src/components/ui/*` and (with this change) `src/components/blocks/*`,
 *    so the model auto-discovers everything we add here without any prompt
 *    edit.
 *  - Splitting keeps PR diffs reviewable. New atoms / blocks can be added
 *    here in isolation.
 *
 * EVERY file shipped from here is `overwrite: true` — these are canonical
 * Petal primitives, not user code, and we want stale forks to get refreshed.
 *
 * Constraints honored on every block:
 *  - ≤ 120 lines / 6 KB so the file-budget gate (180 lines) never reverts
 *    a generated page that imports them.
 *  - Pure presentational; no client-only globals, no framer-motion required.
 *  - Only imports kit primitives already shipped in scaffold-kit.ts +
 *    lucide-react. The integrity check at the bottom of scaffold-kit.ts
 *    will throw at module load if we forget a dependency.
 *  - Accepts `className` so vibe-driven overrides from the Design Director
 *    can land without forking the file.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// =============================================================================
// ATOMS — small, generic primitives the model historically hand-rolled badly.
// =============================================================================

const MARQUEE = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Infinite horizontal scroller. Duplicates children so the loop is seamless.
 * Use for logo clouds, testimonials rows, "as seen in" strips.
 *   <Marquee speed={30}> {logos.map(l => <img key={l} src={l} />)} </Marquee>
 */
export function Marquee({
  children,
  className,
  speed = 30,
  pauseOnHover = true,
  reverse = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** seconds for one full loop. Lower = faster. */
  speed?: number;
  pauseOnHover?: boolean;
  reverse?: boolean;
}) {
  return (
    <div className={cn("group relative flex w-full overflow-hidden", className)}>
      <div
        className={cn(
          "flex shrink-0 items-center gap-12 whitespace-nowrap will-change-transform",
          reverse ? "animate-[petal-marquee-rev_var(--marquee-d)_linear_infinite]" : "animate-[petal-marquee_var(--marquee-d)_linear_infinite]",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
        )}
        style={{ ["--marquee-d" as string]: \`\${speed}s\` }}
      >
        {children}
        {children}
      </div>
      <style>{\`@keyframes petal-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes petal-marquee-rev{from{transform:translateX(-50%)}to{transform:translateX(0)}}\`}</style>
    </div>
  );
}
`;

const KBD = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Keyboard shortcut pill: <Kbd>⌘K</Kbd> */
export function Kbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 select-none items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
`;

const CODE_BLOCK = `import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read-only code block with copy button. Not a syntax highlighter — keep it
 * dependency-free. For real highlighting, wrap with shiki/prism in user code.
 */
export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={cn("group relative overflow-hidden rounded-lg border border-border bg-muted/40", className)}>
      {language && (
        <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{language}</span>
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy code"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
`;

const EMPTY_STATE = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Standardized empty/zero state. Use whenever a list, table, or panel has
 * no data yet — far better than a bare "Nothing here yet."
 *   <EmptyState icon={Inbox} title="No messages" description="..." action={<Button>...</Button>} />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
`;

const STAT = `import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single KPI atom. Compose into a Grid for stat bands.
 *   <Stat label="MRR" value="$48,210" delta={12.4} />
 */
export function Stat({
  label,
  value,
  delta,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Percentage change. Positive = up, negative = down, 0/null = flat. */
  delta?: number | null;
  hint?: string;
  className?: string;
}) {
  const dir = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const tone =
    dir === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : dir === "down"
        ? "text-rose-600 dark:text-rose-400"
        : "text-muted-foreground";
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      {(delta != null || hint) && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {delta != null && (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", tone)}>
              <Icon className="h-3 w-3" />
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}
`;

const TIMELINE = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Vertical event list. Use for changelogs, activity feeds, onboarding steps.
 *   <Timeline items={[{ title: "Signed up", description: "...", meta: "2d ago" }]} />
 */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <ol className={cn("relative space-y-6 border-l border-border pl-6", className)}>
      {list.map((it, i) => {
        const Icon = it.icon;
        return (
          <li key={i} className="relative">
            <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
              {Icon ? <Icon className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-foreground" />}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="text-sm font-medium text-foreground">{it.title}</p>
              {it.meta && <p className="text-xs text-muted-foreground">{it.meta}</p>}
            </div>
            {it.description && <p className="mt-1 text-sm text-muted-foreground">{it.description}</p>}
          </li>
        );
      })}
    </ol>
  );
}
`;

const FEATURE_ICON = `import * as React from "react";
import * as LucideIcons from "lucide-react";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bordered/tinted icon tile. Use as the leading mark of a feature card.
 *
 * Preferred:  <FeatureIcon icon={Bolt} variant="solid" />
 * Tolerated:  <FeatureIcon name="bolt" />  // kebab/lower/Pascal lucide name
 *
 * If neither resolves to a real component, falls back to <Circle/> so the
 * page still renders instead of throwing React error #130.
 */
function resolveIcon(
  iconProp: unknown,
  nameProp: unknown,
): React.ComponentType<{ className?: string }> {
  if (typeof iconProp === "function") return iconProp as React.ComponentType<{ className?: string }>;
  const raw = typeof nameProp === "string" ? nameProp : typeof iconProp === "string" ? iconProp : "";
  if (raw) {
    const pascal = raw
      .replace(/(?:^|[-_\\s])(\\w)/g, (_m, c: string) => (c ? c.toUpperCase() : ""))
      .replace(/[^A-Za-z0-9]/g, "");
    const reg = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
    if (pascal && typeof reg[pascal] === "function") return reg[pascal];
  }
  return Circle;
}

export function FeatureIcon(props: {
  icon?: React.ComponentType<{ className?: string }> | string;
  name?: string;
  variant?: "soft" | "solid" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { variant = "soft", size = "md", className } = props;
  const Icon = resolveIcon(props.icon, props.name);
  const sz = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-11 w-11";
  const ic = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const v =
    variant === "solid"
      ? "bg-primary text-primary-foreground"
      : variant === "outline"
        ? "border border-border bg-background text-foreground"
        : "bg-primary/10 text-primary";
  return (
    <span className={cn("inline-flex items-center justify-center rounded-xl", sz, v, className)}>
      <Icon className={ic} />
    </span>
  );
}
`;

const GRADIENT_TEXT = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Inline gradient headline. Wraps a span with a from/to gradient using
 * design tokens — keeps colors on-brand instead of random tailwind blends.
 *   <GradientText>Build faster.</GradientText>
 */
export function GradientText({
  children,
  className,
  from = "from-primary",
  to = "to-accent",
}: {
  children: React.ReactNode;
  className?: string;
  from?: string;
  to?: string;
}) {
  return (
    <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", from, to, className)}>
      {children}
    </span>
  );
}
`;

const GRADIENT_BLOB = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Decorative blurred gradient blob for hero backgrounds. Position-absolute
 * by default — drop inside a relatively-positioned section with
 * \`overflow-hidden\` on the parent.
 *   <div className="relative overflow-hidden">
 *     <GradientBlob className="-top-32 -left-20" />
 *     ...content
 *   </div>
 */
export function GradientBlob({
  className,
  size = "lg",
  tone = "primary",
}: {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "primary" | "accent" | "muted";
}) {
  const sz =
    size === "sm" ? "h-48 w-48" : size === "md" ? "h-72 w-72" : size === "lg" ? "h-96 w-96" : "h-[32rem] w-[32rem]";
  const t =
    tone === "accent" ? "bg-accent/40" : tone === "muted" ? "bg-muted/60" : "bg-primary/30";
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute -z-10 rounded-full blur-3xl", sz, t, className)}
    />
  );
}
`;

const SECTION = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Standard section wrapper with eyebrow + heading + description. Use this
 * INSTEAD of hand-rolling \`<section><h2>\` blocks so spacing/alignment stay
 * consistent across a page.
 *   <Section eyebrow="Features" title="Everything you need" description="...">
 *     <Grid cols={1} md={3} gap={6}>...</Grid>
 *   </Section>
 */
export function Section({
  eyebrow,
  title,
  description,
  align = "left",
  size = "md",
  className,
  children,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  size?: "sm" | "md" | "lg";
  className?: string;
  children?: React.ReactNode;
}) {
  const pad = size === "sm" ? "py-12" : size === "lg" ? "py-28" : "py-20";
  const a = align === "center" ? "items-center text-center" : "items-start text-left";
  const titleSize = size === "lg" ? "text-4xl md:text-5xl" : size === "sm" ? "text-2xl md:text-3xl" : "text-3xl md:text-4xl";
  return (
    <section className={cn("w-full", pad, className)}>
      {(eyebrow || title || description) && (
        <header className={cn("flex flex-col gap-3", a, "mb-10 max-w-3xl", align === "center" && "mx-auto")}>
          {eyebrow && (
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</span>
          )}
          {title && (
            <h2 className={cn("font-semibold tracking-tight text-foreground", titleSize)}>{title}</h2>
          )}
          {description && <p className="text-base text-muted-foreground md:text-lg">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
`;

const DIVIDER = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Labeled or plain divider. With a label it becomes "—— or ——" style.
 */
export function Divider({
  label,
  className,
}: {
  label?: React.ReactNode;
  className?: string;
}) {
  if (!label) return <hr className={cn("border-border", className)} />;
  return (
    <div className={cn("flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground", className)}>
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
`;

const RATING = `import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read-only star rating. Half-star is rendered via overflow-clip overlay so
 * we don't need a half-star icon variant.
 *   <Rating value={4.5} />
 */
export function Rating({
  value,
  max = 5,
  size = "md",
  className,
}: {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-4 w-4";
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <span className={cn("relative inline-flex items-center", className)} aria-label={\`\${value} out of \${max}\`}>
      <span className="flex text-muted-foreground/40">
        {Array.from({ length: max }).map((_, i) => (
          <Star key={i} className={px} />
        ))}
      </span>
      <span className="absolute inset-0 flex overflow-hidden text-amber-500" style={{ width: \`\${pct}%\` }}>
        {Array.from({ length: max }).map((_, i) => (
          <Star key={i} className={cn(px, "fill-current")} />
        ))}
      </span>
    </span>
  );
}
`;

const PROSE = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Long-form typography wrapper. Apply to article bodies, MDX output,
 * blog posts. Targets nested elements without needing \`@tailwindcss/typography\`.
 *   <Prose><h1>...</h1><p>...</p></Prose>
 */
export function Prose({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-2xl text-foreground",
        "[&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight",
        "[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold",
        "[&_p]:my-4 [&_p]:leading-7 [&_p]:text-foreground/90",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
        "[&_strong]:text-foreground [&_strong]:font-semibold",
        "[&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
        "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:my-1.5 [&_li]:text-foreground/90",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
        "[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-4",
        "[&_img]:my-6 [&_img]:rounded-lg",
        "[&_hr]:my-10 [&_hr]:border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}
`;

// =============================================================================
// BLOCKS — composed sections. 3 hero variants + 3 features variants for Phase 1.
// =============================================================================

const HERO_CENTERED = `import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { GradientBlob } from "@/components/ui/gradient-blob";
import { GradientText } from "@/components/ui/gradient-text";
import { cn } from "@/lib/utils";

/**
 * Centered hero with optional eyebrow + dual CTA. Default landing-page hero —
 * works for SaaS, agency, app launches. Pair with a soft \`GradientBlob\`.
 */
export function HeroCentered({
  eyebrow,
  title,
  highlight,
  description,
  primaryCta,
  secondaryCta,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Optional fragment of the title rendered with gradient emphasis. */
  highlight?: React.ReactNode;
  description?: React.ReactNode;
  primaryCta?: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <section className={cn("relative overflow-hidden py-24 md:py-32", className)}>
      <GradientBlob className="-top-40 left-1/2 -translate-x-1/2" size="xl" />
      <Container size="lg">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          {eyebrow && (
            <span className="mb-5 inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              {eyebrow}
            </span>
          )}
          <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
            {title}
            {highlight && (
              <>
                {" "}
                <GradientText>{highlight}</GradientText>
              </>
            )}
          </h1>
          {description && (
            <p className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">{description}</p>
          )}
          {(primaryCta || secondaryCta) && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {primaryCta && (
                <Button size="lg" onClick={primaryCta.onClick} asChild={!!primaryCta.href}>
                  {primaryCta.href ? (
                    <a href={primaryCta.href}>
                      {primaryCta.label} <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  ) : (
                    <>
                      {primaryCta.label} <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              )}
              {secondaryCta && (
                <Button size="lg" variant="outline" onClick={secondaryCta.onClick} asChild={!!secondaryCta.href}>
                  {secondaryCta.href ? <a href={secondaryCta.href}>{secondaryCta.label}</a> : secondaryCta.label}
                </Button>
              )}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
`;

const HERO_SPLIT_IMAGE = `import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Two-column hero: copy on the left, hero image / screenshot on the right.
 * Best for product / SaaS pages where the artifact IS the pitch.
 */
export function HeroSplitImage({
  eyebrow,
  title,
  description,
  primaryCta,
  secondaryCta,
  imageSrc,
  imageAlt = "",
  reverse = false,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryCta?: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; href?: string; onClick?: () => void };
  imageSrc: string;
  imageAlt?: string;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("py-20 md:py-28", className)}>
      <Container size="xl">
        <div className={cn("grid items-center gap-12 lg:grid-cols-2 lg:gap-16", reverse && "lg:[&>*:first-child]:order-2")}>
          <div>
            {eyebrow && (
              <span className="mb-4 inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {eyebrow}
              </span>
            )}
            <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">{title}</h1>
            {description && (
              <p className="mt-5 max-w-lg text-base text-muted-foreground md:text-lg">{description}</p>
            )}
            {(primaryCta || secondaryCta) && (
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {primaryCta && (
                  <Button size="lg" onClick={primaryCta.onClick} asChild={!!primaryCta.href}>
                    {primaryCta.href ? (
                      <a href={primaryCta.href}>
                        {primaryCta.label} <ArrowRight className="ml-2 h-4 w-4" />
                      </a>
                    ) : (
                      <>
                        {primaryCta.label} <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
                {secondaryCta && (
                  <Button size="lg" variant="ghost" onClick={secondaryCta.onClick} asChild={!!secondaryCta.href}>
                    {secondaryCta.href ? <a href={secondaryCta.href}>{secondaryCta.label}</a> : secondaryCta.label}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-foreground/5">
              <img src={imageSrc} alt={imageAlt} className="h-auto w-full" loading="eager" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
`;

const HERO_EDITORIAL = `import * as React from "react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Editorial hero: oversized serif/display title, asymmetric layout, strong
 * negative space. Picks for: agencies, portfolios, magazines, brands with a
 * point of view. NOT for generic SaaS — use HeroCentered there.
 */
export function HeroEditorial({
  number,
  title,
  lede,
  meta,
  primaryCta,
  className,
}: {
  /** Optional issue/section marker rendered as oversized numerals. */
  number?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** Small metadata row, e.g. "Issue 04 — Spring 2026". */
  meta?: React.ReactNode;
  primaryCta?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <section className={cn("border-b border-border py-20 md:py-28", className)}>
      <Container size="xl">
        <div className="grid grid-cols-12 gap-6">
          {number != null && (
            <div className="col-span-12 md:col-span-3">
              <div className="font-serif text-7xl font-light leading-none text-foreground/80 md:text-8xl">
                {number}
              </div>
              {meta && (
                <div className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{meta}</div>
              )}
            </div>
          )}
          <div className={cn(number != null ? "col-span-12 md:col-span-9" : "col-span-12")}>
            <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-foreground md:text-7xl">
              {title}
            </h1>
            {lede && (
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">{lede}</p>
            )}
            {primaryCta && (
              <div className="mt-10">
                <Button size="lg" variant="outline" onClick={primaryCta.onClick} asChild={!!primaryCta.href}>
                  {primaryCta.href ? <a href={primaryCta.href}>{primaryCta.label}</a> : primaryCta.label}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
`;

const FEATURES_GRID_3 = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { cn } from "@/lib/utils";

export interface FeatureItem {
  icon?: React.ComponentType<{ className?: string }> | string;
  title: string;
  description: string;
}

/**
 * Classic 3-up (or 4-up) feature grid. Default safe choice for SaaS sites.
 *   <FeaturesGrid3 eyebrow="Why us" title="Built for builders"
 *     items={[{ icon: Bolt, title: "Fast", description: "..." }]} />
 */
export function FeaturesGrid3({
  eyebrow,
  title,
  description,
  items,
  cols = 3,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  items: FeatureItem[];
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const list = Array.isArray(items) ? items : [];
  const grid = cols === 4 ? "md:grid-cols-2 lg:grid-cols-4" : cols === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3";
  return (
    <Container size="lg" className={className}>
      <Section eyebrow={eyebrow} title={title} description={description} align="center">
        <div className={cn("grid grid-cols-1 gap-6", grid)}>
          {list.map((it, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-6 transition hover:border-primary/30">
              {it.icon && <FeatureIcon icon={it.icon} variant="soft" />}
              <h3 className="mt-4 text-base font-semibold text-foreground">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.description}</p>
            </div>
          ))}
        </div>
      </Section>
    </Container>
  );
}
`;

const FEATURES_BENTO = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { cn } from "@/lib/utils";

export interface BentoItem {
  icon?: React.ComponentType<{ className?: string }> | string;
  title: string;
  description: string;
  /** Mosaic span — 1, 2, or 3 columns wide on md+. Defaults to 1. */
  span?: 1 | 2 | 3;
  /** Optional visual slot rendered in the lower portion of the cell. */
  visual?: React.ReactNode;
  /** Optional accent — true = primary-tinted background. */
  accent?: boolean;
}

/**
 * Asymmetric bento grid. Use when 3-up grid feels too tidy. Best for
 * playful / maximalist / brutalist vibes. 6-col responsive layout —
 * sum of spans should be a multiple of 6 across rows for clean wrapping.
 */
export function FeaturesBento({
  eyebrow,
  title,
  description,
  items,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  items: BentoItem[];
  className?: string;
}) {
  const list = Array.isArray(items) ? items : [];
  return (
    <Container size="xl" className={className}>
      <Section eyebrow={eyebrow} title={title} description={description}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          {list.map((it, i) => {
            const span = it.span ?? 1;
            const colSpan = span === 3 ? "md:col-span-3" : span === 2 ? "md:col-span-3 lg:col-span-2" : "md:col-span-3 lg:col-span-2";
            const cellSpan = span === 3 ? "md:col-span-6 lg:col-span-3" : colSpan;
            return (
              <div
                key={i}
                className={cn(
                  "group relative flex min-h-[200px] flex-col justify-between overflow-hidden rounded-2xl border border-border p-6 transition",
                  it.accent ? "bg-primary text-primary-foreground" : "bg-card hover:border-primary/30",
                  cellSpan,
                )}
              >
                <div>
                  {it.icon && (
                    <FeatureIcon
                      icon={it.icon}
                      variant={it.accent ? "outline" : "soft"}
                      className={it.accent ? "border-primary-foreground/30 bg-transparent text-primary-foreground" : undefined}
                    />
                  )}
                  <h3 className={cn("mt-4 text-lg font-semibold", it.accent ? "text-primary-foreground" : "text-foreground")}>
                    {it.title}
                  </h3>
                  <p
                    className={cn(
                      "mt-2 text-sm leading-relaxed",
                      it.accent ? "text-primary-foreground/85" : "text-muted-foreground",
                    )}
                  >
                    {it.description}
                  </p>
                </div>
                {it.visual && <div className="pointer-events-none mt-6">{it.visual}</div>}
              </div>
            );
          })}
        </div>
      </Section>
    </Container>
  );
}
`;

const FEATURES_ALTERNATING = `import * as React from "react";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

export interface AlternatingFeature {
  eyebrow?: string;
  title: string;
  description: string;
  bullets?: string[];
  imageSrc: string;
  imageAlt?: string;
}

/**
 * Alternating left/right feature rows — a section per feature, image flips
 * each row. Best for editorial / agency vibes where each feature deserves
 * room to breathe. Heavier than a 3-up grid; use for 2-4 features max.
 */
export function FeaturesAlternatingRows({
  eyebrow,
  title,
  description,
  items,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  items: AlternatingFeature[];
  className?: string;
}) {
  const list = Array.isArray(items) ? items : [];
  return (
    <Container size="xl" className={className}>
      <Section eyebrow={eyebrow} title={title} description={description}>
        <div className="space-y-20 md:space-y-28">
          {list.map((it, i) => {
            const flip = i % 2 === 1;
            return (
              <div key={i} className={cn("grid items-center gap-10 md:grid-cols-2 md:gap-16", flip && "md:[&>*:first-child]:order-2")}>
                <div>
                  {it.eyebrow && (
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{it.eyebrow}</div>
                  )}
                  <h3 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{it.title}</h3>
                  <p className="mt-4 text-base text-muted-foreground">{it.description}</p>
                  {it.bullets && it.bullets.length > 0 && (
                    <ul className="mt-6 space-y-2.5">
                      {it.bullets.map((b, j) => (
                        <li key={j} className="flex items-start gap-2.5 text-sm text-foreground">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-muted">
                  <img src={it.imageSrc} alt={it.imageAlt ?? ""} className="h-auto w-full" loading="lazy" />
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </Container>
  );
}
`;

// =============================================================================
// REGISTRY — spread into KIT_FILES.
// =============================================================================

export const KIT_BLOCK_FILES: KitFile[] = [
  // Atoms
  { path: "src/components/ui/marquee.tsx", content: MARQUEE, overwrite: true },
  { path: "src/components/ui/kbd.tsx", content: KBD, overwrite: true },
  { path: "src/components/ui/code-block.tsx", content: CODE_BLOCK, overwrite: true },
  { path: "src/components/ui/empty-state.tsx", content: EMPTY_STATE, overwrite: true },
  { path: "src/components/ui/stat.tsx", content: STAT, overwrite: true },
  { path: "src/components/ui/timeline.tsx", content: TIMELINE, overwrite: true },
  { path: "src/components/ui/feature-icon.tsx", content: FEATURE_ICON, overwrite: true },
  { path: "src/components/ui/gradient-text.tsx", content: GRADIENT_TEXT, overwrite: true },
  { path: "src/components/ui/gradient-blob.tsx", content: GRADIENT_BLOB, overwrite: true },
  { path: "src/components/ui/section.tsx", content: SECTION, overwrite: true },
  { path: "src/components/ui/divider.tsx", content: DIVIDER, overwrite: true },
  { path: "src/components/ui/rating.tsx", content: RATING, overwrite: true },
  { path: "src/components/ui/prose.tsx", content: PROSE, overwrite: true },
  // Section blocks
  { path: "src/components/blocks/hero-centered.tsx", content: HERO_CENTERED, overwrite: true },
  { path: "src/components/blocks/hero-split-image.tsx", content: HERO_SPLIT_IMAGE, overwrite: true },
  { path: "src/components/blocks/hero-editorial.tsx", content: HERO_EDITORIAL, overwrite: true },
  { path: "src/components/blocks/features-grid-3.tsx", content: FEATURES_GRID_3, overwrite: true },
  { path: "src/components/blocks/features-bento.tsx", content: FEATURES_BENTO, overwrite: true },
  { path: "src/components/blocks/features-alternating-rows.tsx", content: FEATURES_ALTERNATING, overwrite: true },
];
