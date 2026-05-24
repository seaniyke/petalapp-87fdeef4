/**
 * Phase-2 expansion of the Petal scaffold: section blocks for testimonials,
 * pricing, FAQ, CTA, footer, nav, logo cloud — plus end-to-end page-assembly
 * examples that show the model how to compose a full landing page from blocks.
 *
 * Design notes (same constraints as scaffold-kit-blocks.ts):
 *  - ≤ 120 lines / 6 KB per file (file-budget gate).
 *  - Only imports kit primitives + lucide-react. The integrity check at the
 *    bottom of scaffold-kit.ts will throw at module load if anything is missing.
 *  - Every block exports a single PascalCase function so the kit-manifest
 *    parser picks it up automatically.
 *  - Every block accepts `className` so the Design Director's vibe choice
 *    can override styling without forking the source.
 *  - Page-assembly examples are read-only references under
 *    src/components/examples/* — they are NOT auto-imported by App.tsx.
 *    They show the COMPOSITION pattern (which block + which variant + in what
 *    order) so the model has a real template to copy from instead of inventing
 *    a centered-hero + 3-card layout from scratch every turn.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// =============================================================================
// TESTIMONIALS — 3 variants
// =============================================================================

const TESTIMONIALS_CARDS = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Rating } from "@/components/ui/rating";
import { cn } from "@/lib/utils";

export interface Testimonial {
  quote: string;
  name: string;
  role?: string;
  title?: string;
  avatarSrc?: string;
  image?: string;
  avatar?: string;
  rating?: number;
}

/**
 * Classic 3-up testimonial card grid. Safe default. Pair with a
 * HeroSplitImage or HeroCentered. For maximalist sites, use the marquee
 * variant instead.
 */
export function TestimonialsCards({
  eyebrow,
  title,
  description,
  items,
  testimonials,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Preferred. \`testimonials\` is accepted as an alias. */
  items?: Testimonial[];
  testimonials?: Testimonial[];
  className?: string;
}) {
  const list = Array.isArray(items) ? items : Array.isArray(testimonials) ? testimonials : [];
  return (
    <Container size="lg" className={className}>
      <Section eyebrow={eyebrow} title={title} description={description} align="center">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {list.map((t, i) => (
            <figure key={i} className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
              {t.rating != null && <Rating value={t.rating} className="mb-4" />}
              <blockquote className="flex-1 text-sm leading-relaxed text-foreground/90">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  {(t.avatarSrc || t.image || t.avatar) && <AvatarImage src={t.avatarSrc ?? t.image ?? t.avatar} alt={t.name} />}
                  <AvatarFallback>{t.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{t.name}</div>
                  {(t.role || t.title) && <div className="truncate text-xs text-muted-foreground">{t.role ?? t.title}</div>}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>
    </Container>
  );
}
`;

const TESTIMONIALS_MARQUEE = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Marquee } from "@/components/ui/marquee";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface MarqueeTestimonial {
  quote: string;
  name: string;
  role?: string;
  title?: string;
  avatarSrc?: string;
  image?: string;
  avatar?: string;
}

/**
 * Two-row infinite-scroll testimonial marquee. Reverse direction on the
 * second row creates motion. Best for playful/maximalist vibes — heavy in
 * social proof. Each row uses a different speed so they don't sync.
 */
export function TestimonialsMarquee({
  eyebrow,
  title,
  description,
  items,
  testimonials,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  items?: MarqueeTestimonial[];
  testimonials?: MarqueeTestimonial[];
  className?: string;
}) {
  const list = Array.isArray(items) ? items : Array.isArray(testimonials) ? testimonials : [];
  const half = Math.ceil(list.length / 2);
  const rowA = list.slice(0, half);
  const rowB = list.slice(half).length ? list.slice(half) : list;
  const Card = ({ t }: { t: MarqueeTestimonial }) => (
    <figure className="mx-3 w-[320px] shrink-0 rounded-2xl border border-border bg-card p-5">
      <blockquote className="text-sm leading-relaxed text-foreground/90">&ldquo;{t.quote}&rdquo;</blockquote>
      <figcaption className="mt-4 flex items-center gap-3">
        <Avatar className="h-9 w-9">
          {(t.avatarSrc || t.image || t.avatar) && <AvatarImage src={t.avatarSrc ?? t.image ?? t.avatar} alt={t.name} />}
          <AvatarFallback>{t.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{t.name}</div>
          {(t.role || t.title) && <div className="truncate text-xs text-muted-foreground">{t.role ?? t.title}</div>}
        </div>
      </figcaption>
    </figure>
  );
  return (
    <Container size="xl" className={cn("[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]", className)}>
      <Section eyebrow={eyebrow} title={title} description={description} align="center">
        <div className="space-y-4">
          <Marquee speed={45}>{rowA.map((t, i) => <Card key={i} t={t} />)}</Marquee>
          <Marquee speed={55} reverse>{rowB.map((t, i) => <Card key={i} t={t} />)}</Marquee>
        </div>
      </Section>
    </Container>
  );
}
`;

const TESTIMONIALS_QUOTE_HERO = `import * as React from "react";
import { Quote } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Single oversized pull-quote. Editorial / agency / brand storytelling.
 * Pair with HeroEditorial + FeaturesAlternatingRows for a magazine feel.
 */
export function TestimonialsQuoteHero({
  quote,
  name,
  role,
  avatarSrc,
  company,
  className,
}: {
  quote: React.ReactNode;
  name: string;
  role?: string;
  avatarSrc?: string;
  company?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-y border-border bg-muted/30 py-24 md:py-32", className)}>
      <Container size="lg">
        <figure className="mx-auto max-w-3xl text-center">
          <Quote className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <blockquote className="mt-8 text-balance text-2xl font-medium leading-snug tracking-tight text-foreground md:text-4xl">
            &ldquo;{quote}&rdquo;
          </blockquote>
          <figcaption className="mt-10 flex items-center justify-center gap-4">
            <Avatar className="h-12 w-12">
              {avatarSrc && <AvatarImage src={avatarSrc} alt={name} />}
              <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="text-left">
              <div className="text-sm font-semibold text-foreground">{name}</div>
              {(role || company) && (
                <div className="text-xs text-muted-foreground">
                  {role}
                  {role && company ? " · " : ""}
                  {company}
                </div>
              )}
            </div>
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}
`;

// =============================================================================
// PRICING — single-product variant (the 3-tier + comparison ones live in
// examples-pack as full files; this one fills a real gap: paid landing pages
// for digital downloads / lifetime deals where there's exactly one product).
// =============================================================================

const PRICING_SINGLE_PRODUCT = `import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

/**
 * Single-product pricing card. For lifetime deals, digital downloads,
 * one-off purchases, or "early access" pages where 3-tier pricing is overkill.
 *   <PricingSingleProduct title="Founders deal" price="$49" period="one-time"
 *     features={["Lifetime access", "All future updates"]} cta={...} />
 */
export function PricingSingleProduct({
  eyebrow,
  heading,
  description,
  title,
  subtitle,
  price,
  period,
  originalPrice,
  features,
  cta,
  buttonText,
  buttonLabel,
  ctaLabel,
  href,
  ctaHref,
  footnote,
  className,
}: {
  eyebrow?: React.ReactNode;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  title: string;
  subtitle?: string;
  price: string;
  period?: string;
  originalPrice?: string;
  features?: string[];
  cta?: { label: string; href?: string; onClick?: () => void };
  buttonText?: string;
  buttonLabel?: string;
  ctaLabel?: string;
  href?: string;
  ctaHref?: string;
  footnote?: React.ReactNode;
  className?: string;
}) {
  const safeFeatures = Array.isArray(features) ? features : [];
  const safeCta = cta ?? { label: buttonText ?? buttonLabel ?? ctaLabel ?? "Get started", href: ctaHref ?? href };
  return (
    <Container size="md" className={className}>
      <Section eyebrow={eyebrow} title={heading} description={description} align="center">
        <div className="mx-auto max-w-md overflow-hidden rounded-2xl border-2 border-primary bg-card shadow-xl shadow-primary/10">
          <div className="border-b border-border bg-primary/5 px-6 py-5 text-center">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="px-6 py-8">
            <div className="flex items-baseline justify-center gap-2">
              {originalPrice && (
                <span className="text-xl text-muted-foreground line-through">{originalPrice}</span>
              )}
              <span className="text-5xl font-semibold tracking-tight text-foreground">{price}</span>
              {period && <span className="text-sm text-muted-foreground">/{period}</span>}
            </div>
            <ul className="mt-8 space-y-3">
              {safeFeatures.map((f, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="text-foreground">{f}</span>
                </li>
              ))}
            </ul>
            <Button className="mt-8 w-full" size="lg" onClick={safeCta.onClick} asChild={!!safeCta.href}>
              {safeCta.href ? <a href={safeCta.href}>{safeCta.label}</a> : safeCta.label}
            </Button>
            {footnote && <p className="mt-4 text-center text-xs text-muted-foreground">{footnote}</p>}
          </div>
        </div>
      </Section>
    </Container>
  );
}
`;

// =============================================================================
// FAQ — 2 variants
// =============================================================================

const FAQ_ACCORDION = `import * as React from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

export interface FaqItem {
  q?: React.ReactNode;
  a?: React.ReactNode;
  question?: React.ReactNode;
  answer?: React.ReactNode;
}

/**
 * Centered accordion FAQ. Default safe choice. For magazine-style layouts,
 * use FaqTwoColumn instead.
 *
 * Accepts either { items } or { faqs }, and each entry may use { q, a } or
 * { question, answer }.
 */
export function FaqAccordion({
  eyebrow,
  title,
  description,
  items,
  faqs,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  items?: FaqItem[];
  faqs?: FaqItem[];
  className?: string;
}) {
  const list = Array.isArray(items) && items.length > 0 ? items : Array.isArray(faqs) ? faqs : [];
  return (
    <Container size="md" className={className}>
      <Section eyebrow={eyebrow} title={title} description={description} align="center">
        <Accordion type="single" collapsible className="w-full">
          {list.map((it, i) => {
            const q = it.q ?? it.question ?? "";
            const a = it.a ?? it.answer ?? "";
            return (
              <AccordionItem key={i} value={\`item-\${i}\`}>
                <AccordionTrigger className="text-left text-base font-medium">{q}</AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{a}</AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </Section>
    </Container>
  );
}
`;

const FAQ_TWO_COLUMN = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

export interface FaqColumnItem {
  q?: React.ReactNode;
  a?: React.ReactNode;
  question?: React.ReactNode;
  answer?: React.ReactNode;
}

/**
 * Two-column FAQ: heading + intro on the left, Q/A list on the right.
 * Editorial feel. Items are always-open (no accordion) — best when answers
 * are short. For long answers prefer FaqAccordion.
 */
export function FaqTwoColumn({
  eyebrow,
  title,
  description,
  items,
  faqs,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  items?: FaqColumnItem[];
  faqs?: FaqColumnItem[];
  className?: string;
}) {
  const list = Array.isArray(items) ? items : Array.isArray(faqs) ? faqs : [];
  return (
    <Container size="xl" className={className}>
      <section className={cn("py-20 md:py-28", className)}>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            {eyebrow && (
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</div>
            )}
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h2>
            {description && <p className="mt-4 text-base text-muted-foreground">{description}</p>}
          </div>
          <dl className="lg:col-span-7 lg:divide-y lg:divide-border">
            {list.map((it, i) => (
              <div key={i} className="border-b border-border py-6 first:border-t lg:border-b-0 lg:border-t-0 lg:first:border-t-0">
                <dt className="text-base font-semibold text-foreground">{it.q ?? it.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.a ?? it.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </Container>
  );
}
`;

// =============================================================================
// CTA — 3 variants
// =============================================================================

const CTA_CENTERED = `import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Simple centered CTA band. Use as the closing section before the footer.
 */
export function CtaCentered({
  eyebrow,
  title,
  description,
  primaryCta,
  secondaryCta,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryCta?: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <section className={cn("py-20 md:py-24", className)}>
      <Container size="md">
        <div className="rounded-3xl border border-border bg-muted/40 p-10 text-center md:p-16">
          {eyebrow && (
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</div>
          )}
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h2>
          {description && (
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">{description}</p>
          )}
          {(primaryCta || secondaryCta) && (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
      </Container>
    </section>
  );
}
`;

const CTA_SPLIT = `import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Two-column CTA: heading + description on the left, action buttons on the
 * right. More conversational than CtaCentered — feels like a sign-off.
 */
export function CtaSplit({
  title,
  description,
  primaryCta,
  secondaryCta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryCta: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <section className={cn("border-y border-border py-16 md:py-20", className)}>
      <Container size="xl">
        <div className="grid items-center gap-8 md:grid-cols-3">
          <div className="md:col-span-2">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{title}</h2>
            {description && <p className="mt-2 max-w-2xl text-base text-muted-foreground">{description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3 md:justify-end">
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
            {secondaryCta && (
              <Button size="lg" variant="outline" onClick={secondaryCta.onClick} asChild={!!secondaryCta.href}>
                {secondaryCta.href ? <a href={secondaryCta.href}>{secondaryCta.label}</a> : secondaryCta.label}
              </Button>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
`;

const CTA_GRADIENT_BAND = `import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { GradientBlob } from "@/components/ui/gradient-blob";
import { cn } from "@/lib/utils";

type CtaLike = {
  label?: React.ReactNode;
  text?: React.ReactNode;
  children?: React.ReactNode;
  href?: string;
  onClick?: () => void;
};

function normalizeCta(c: CtaLike | undefined): { label: React.ReactNode; href?: string; onClick?: () => void } | null {
  if (!c) return null;
  const label = c.label ?? c.children ?? c.text ?? "";
  if (!label && !c.href && !c.onClick) return null;
  return { label, href: c.href, onClick: c.onClick };
}

/**
 * Bold full-bleed gradient CTA band. Use sparingly — high visual weight,
 * great for the FINAL section of a marketing page.
 *
 * Accepts \`primaryCta\` / \`secondaryCta\` (preferred) OR
 * \`primaryLink\` / \`secondaryLink\` (alias). CTA objects may use
 * { label } or { children } / { text }.
 */
export function CtaGradientBand({
  title,
  description,
  primaryCta,
  secondaryCta,
  primaryLink,
  secondaryLink,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  primaryCta?: CtaLike;
  secondaryCta?: CtaLike;
  primaryLink?: CtaLike;
  secondaryLink?: CtaLike;
  className?: string;
}) {
  const primary = normalizeCta(primaryCta ?? primaryLink);
  const secondary = normalizeCta(secondaryCta ?? secondaryLink);
  return (
    <section className={cn("relative overflow-hidden bg-primary py-20 text-primary-foreground md:py-28", className)}>
      <GradientBlob className="-bottom-40 -right-20" size="xl" tone="accent" />
      <GradientBlob className="-top-32 -left-10" size="lg" tone="muted" />
      <Container size="lg">
        <div className="relative mx-auto max-w-3xl text-center">
          {title && <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">{title}</h2>}
          {description && (
            <p className="mx-auto mt-5 max-w-xl text-base text-primary-foreground/80 md:text-lg">{description}</p>
          )}
          {(primary || secondary) && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {primary && (
                <Button size="lg" variant="secondary" onClick={primary.onClick} asChild={!!primary.href}>
                  {primary.href ? (
                    <a href={primary.href}>
                      {primary.label} <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  ) : (
                    <>{primary.label} <ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              )}
              {secondary && (
                <Button
                  size="lg"
                  variant="outline"
                  className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  onClick={secondary.onClick}
                  asChild={!!secondary.href}
                >
                  {secondary.href ? <a href={secondary.href}>{secondary.label}</a> : secondary.label}
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

// =============================================================================
// FOOTER — 3 variants
// =============================================================================

const FOOTER_COLUMNS = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Github, Twitter, Instagram, Facebook, Linkedin, Youtube, Globe, Mail, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

type SocialEntry = {
  href: string;
  label?: string;
  icon?: React.ComponentType<{ className?: string }>;
  platform?: string;
};

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  github: Github,
  twitter: Twitter,
  x: Twitter,
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  youtube: Youtube,
  web: Globe,
  website: Globe,
  email: Mail,
  mail: Mail,
};

function resolveSocialIcon(s: SocialEntry): React.ComponentType<{ className?: string }> {
  if (typeof s.icon === "function") return s.icon;
  const key = (s.platform ?? s.label ?? "").toLowerCase();
  return PLATFORM_ICONS[key] ?? Circle;
}

/**
 * Multi-column footer with brand block + link columns + bottom bar.
 * Accepts \`social\` (preferred) or \`socialLinks\` (alias). Each entry may
 * provide \`{ icon }\` or \`{ platform: "twitter" }\` — unknown platforms
 * fall back to a neutral icon.
 */
export function FooterColumns({
  brand,
  tagline,
  columns,
  social,
  socialLinks,
  copyright,
  className,
}: {
  brand?: React.ReactNode;
  tagline?: React.ReactNode;
  columns?: FooterColumn[];
  social?: SocialEntry[];
  socialLinks?: SocialEntry[];
  copyright?: React.ReactNode;
  className?: string;
}) {
  const socials = Array.isArray(social) && social.length > 0 ? social : Array.isArray(socialLinks) ? socialLinks : [];
  const cols = Array.isArray(columns) ? columns : [];
  return (
    <footer className={cn("border-t border-border bg-muted/30 py-16", className)}>
      <Container size="xl">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            {brand && <div className="text-base font-semibold text-foreground">{brand}</div>}
            {tagline && <p className="mt-2 max-w-xs text-sm text-muted-foreground">{tagline}</p>}
            {socials.length > 0 && (
              <div className="mt-5 flex gap-3">
                {socials.map((s, i) => {
                  const Icon = resolveSocialIcon(s);
                  return (
                    <a
                      key={i}
                      href={s.href}
                      aria-label={s.label ?? s.platform ?? "social"}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:text-foreground"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-8 md:col-span-8 md:grid-cols-4">
            {cols.map((col, i) => (
              <div key={i}>
                <div className="text-xs font-semibold uppercase tracking-wider text-foreground">{col.title}</div>
                <ul className="mt-4 space-y-2.5">
                  {(col.links ?? []).map((l, j) => (
                    <li key={j}>
                      <a href={l.href} className="text-sm text-muted-foreground transition hover:text-foreground">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        {copyright && (
          <div className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">{copyright}</div>
        )}
      </Container>
    </footer>
  );
}
`;

const FOOTER_MINIMAL = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Single-row minimal footer: brand on the left, link list + copyright on the
 * right. Editorial / portfolio / single-product page.
 */
export function FooterMinimal({
  brand,
  links,
  copyright,
  className,
}: {
  brand: React.ReactNode;
  links?: { label: string; href: string }[];
  copyright?: React.ReactNode;
  className?: string;
}) {
  return (
    <footer className={cn("border-t border-border py-10", className)}>
      <Container size="xl">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row md:gap-4">
          <div className="text-sm font-semibold text-foreground">{brand}</div>
          {links && links.length > 0 && (
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {links.map((l, i) => (
                <li key={i}>
                  <a href={l.href} className="text-sm text-muted-foreground transition hover:text-foreground">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {copyright && <div className="text-xs text-muted-foreground">{copyright}</div>}
        </div>
      </Container>
    </footer>
  );
}
`;

const FOOTER_NEWSLETTER = `import * as React from "react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

/**
 * Footer with a newsletter capture row above the columns. Use on
 * content-heavy / blog / publishing sites where email signup is a primary
 * conversion goal. Wires onSubscribe(email) — caller controls submission.
 */
export function FooterNewsletter({
  brand,
  tagline,
  newsletterTitle = "Subscribe to our newsletter",
  newsletterDescription,
  placeholder = "you@example.com",
  ctaLabel = "Subscribe",
  onSubscribe,
  columns,
  copyright,
  className,
}: {
  brand: React.ReactNode;
  tagline?: React.ReactNode;
  newsletterTitle?: React.ReactNode;
  newsletterDescription?: React.ReactNode;
  placeholder?: string;
  ctaLabel?: string;
  onSubscribe?: (email: string) => void;
  columns?: FooterColumn[];
  copyright?: React.ReactNode;
  className?: string;
}) {
  const [email, setEmail] = React.useState("");
  return (
    <footer className={cn("border-t border-border bg-muted/30 py-16", className)}>
      <Container size="xl">
        <div className="grid gap-10 border-b border-border pb-10 md:grid-cols-2">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">{newsletterTitle}</h3>
            {newsletterDescription && (
              <p className="mt-2 max-w-md text-sm text-muted-foreground">{newsletterDescription}</p>
            )}
          </div>
          <form
            className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center md:justify-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (email) onSubscribe?.(email);
            }}
          >
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={placeholder}
              className="sm:w-72"
            />
            <Button type="submit">{ctaLabel}</Button>
          </form>
        </div>
        <div className="mt-10 grid gap-8 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="text-base font-semibold text-foreground">{brand}</div>
            {tagline && <p className="mt-2 max-w-xs text-sm text-muted-foreground">{tagline}</p>}
          </div>
          {columns && columns.length > 0 && (
            <div className="grid grid-cols-2 gap-8 md:col-span-8 md:grid-cols-3">
              {columns.map((col, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-foreground">{col.title}</div>
                  <ul className="mt-4 space-y-2.5">
                    {col.links.map((l, j) => (
                      <li key={j}>
                        <a href={l.href} className="text-sm text-muted-foreground transition hover:text-foreground">
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        {copyright && (
          <div className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">{copyright}</div>
        )}
      </Container>
    </footer>
  );
}
`;

// =============================================================================
// NAV — 3 variants
// =============================================================================

const NAV_BAR = `import * as React from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

export interface NavLink {
  label: string;
  href: string;
}

/**
 * Minimal sticky top nav with mobile sheet. No CTA — for content sites,
 * docs, blogs, portfolios. Use NavWithCta for marketing pages.
 */
export function NavBar({
  brand,
  links,
  brandHref = "/",
  className,
}: {
  brand: React.ReactNode;
  links: NavLink[];
  brandHref?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <header className={cn("sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur", className)}>
      <Container size="xl">
        <div className="flex h-14 items-center justify-between">
          <a href={brandHref} className="text-base font-semibold text-foreground">{brand}</a>
          <nav className="hidden items-center gap-6 md:flex">
            {links.map((l, i) => (
              <a key={i} href={l.href} className="text-sm text-muted-foreground transition hover:text-foreground">
                {l.label}
              </a>
            ))}
          </nav>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {open && (
          <nav className="grid gap-1 border-t border-border py-3 md:hidden">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted"
              >
                {l.label}
              </a>
            ))}
          </nav>
        )}
      </Container>
    </header>
  );
}
`;

const NAV_WITH_CTA = `import * as React from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

export interface NavLink {
  label: string;
  href: string;
}

/**
 * Marketing nav with a primary CTA on the right. Default for SaaS landing
 * pages, product launches.
 */
export function NavWithCta({
  brand,
  links,
  cta,
  secondary,
  brandHref = "/",
  className,
}: {
  brand: React.ReactNode;
  links: NavLink[];
  cta: { label: string; href?: string; onClick?: () => void };
  secondary?: { label: string; href?: string; onClick?: () => void };
  brandHref?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <header className={cn("sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur", className)}>
      <Container size="xl">
        <div className="flex h-16 items-center justify-between gap-6">
          <a href={brandHref} className="text-base font-semibold text-foreground">{brand}</a>
          <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
            {links.map((l, i) => (
              <a key={i} href={l.href} className="text-sm font-medium text-muted-foreground transition hover:text-foreground">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {secondary && (
              <Button variant="ghost" onClick={secondary.onClick} asChild={!!secondary.href}>
                {secondary.href ? <a href={secondary.href}>{secondary.label}</a> : secondary.label}
              </Button>
            )}
            <Button onClick={cta.onClick} asChild={!!cta.href}>
              {cta.href ? <a href={cta.href}>{cta.label}</a> : cta.label}
            </Button>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {open && (
          <div className="space-y-1 border-t border-border py-3 md:hidden">
            <nav className="grid gap-1">
              {links.map((l, i) => (
                <a key={i} href={l.href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted">
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              {secondary && (
                <Button variant="outline" className="w-full" onClick={secondary.onClick} asChild={!!secondary.href}>
                  {secondary.href ? <a href={secondary.href}>{secondary.label}</a> : secondary.label}
                </Button>
              )}
              <Button className="w-full" onClick={cta.onClick} asChild={!!cta.href}>
                {cta.href ? <a href={cta.href}>{cta.label}</a> : cta.label}
              </Button>
            </div>
          </div>
        )}
      </Container>
    </header>
  );
}
`;

const NAV_WITH_SEARCH = `import * as React from "react";
import { Menu, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export interface NavLink {
  label: string;
  href: string;
}

/**
 * Nav with prominent inline search. Use for docs sites, app dashboards,
 * marketplaces, e-commerce catalogs — anywhere search IS the primary action.
 */
export function NavWithSearch({
  brand,
  links,
  onSearch,
  searchPlaceholder = "Search…",
  brandHref = "/",
  cta,
  className,
}: {
  brand: React.ReactNode;
  links?: NavLink[];
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  brandHref?: string;
  cta?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  return (
    <header className={cn("sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur", className)}>
      <Container size="xl">
        <div className="flex h-16 items-center gap-4">
          <a href={brandHref} className="text-base font-semibold text-foreground">{brand}</a>
          <form
            className="relative ml-2 hidden flex-1 max-w-md md:block"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch?.(q);
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 pr-14"
            />
            <Kbd className="absolute right-3 top-1/2 -translate-y-1/2">⌘K</Kbd>
          </form>
          {links && links.length > 0 && (
            <nav className="ml-auto hidden items-center gap-6 md:flex">
              {links.map((l, i) => (
                <a key={i} href={l.href} className="text-sm text-muted-foreground transition hover:text-foreground">
                  {l.label}
                </a>
              ))}
            </nav>
          )}
          {cta && (
            <Button className="hidden md:inline-flex" onClick={cta.onClick} asChild={!!cta.href}>
              {cta.href ? <a href={cta.href}>{cta.label}</a> : cta.label}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="ml-auto md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {open && (
          <div className="space-y-3 border-t border-border py-3 md:hidden">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                onSearch?.(q);
                setOpen(false);
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pl-9" />
            </form>
            {links && links.length > 0 && (
              <nav className="grid gap-1">
                {links.map((l, i) => (
                  <a key={i} href={l.href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted">
                    {l.label}
                  </a>
                ))}
              </nav>
            )}
          </div>
        )}
      </Container>
    </header>
  );
}
`;

// =============================================================================
// LOGO CLOUDS — 2 variants
// =============================================================================

const LOGOS_GRID = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/**
 * Static centered logo grid. Pair with a short eyebrow ("Trusted by teams at").
 * For long lists or motion, use LogosMarquee.
 */
export function LogosGrid({
  eyebrow,
  logos,
  className,
}: {
  eyebrow?: React.ReactNode;
  logos: { name: string; src?: string }[];
  className?: string;
}) {
  const list = Array.isArray(logos) ? logos.map((l, i) => typeof l === "string" ? { name: \`logo-\${i + 1}\`, src: l } : l) : [];
  return (
    <section className={cn("py-12 md:py-16", className)}>
      <Container size="xl">
        {eyebrow && (
          <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p>
        )}
        <div className="mt-8 grid grid-cols-2 items-center gap-x-10 gap-y-8 sm:grid-cols-3 md:grid-cols-6">
          {list.map((l, i) =>
            l.src ? (
              <img
                key={i}
                src={l.src}
                alt={l.name}
                className="mx-auto h-7 w-auto opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0"
                loading="lazy"
              />
            ) : (
              <div
                key={i}
                className="mx-auto text-center text-base font-semibold tracking-tight text-muted-foreground/70"
              >
                {l.name}
              </div>
            ),
          )}
        </div>
      </Container>
    </section>
  );
}
`;

const LOGOS_MARQUEE = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Marquee } from "@/components/ui/marquee";
import { cn } from "@/lib/utils";

type LogoEntry = string | { name?: string; src?: string; url?: string };

function normalizeLogo(l: LogoEntry, i: number): { name: string; src?: string } {
  if (typeof l === "string") return { name: \`logo-\${i + 1}\`, src: l };
  return { name: l.name ?? \`logo-\${i + 1}\`, src: l.src ?? l.url };
}

/**
 * Infinite-scroll logo strip. Accepts either an array of \`{ name, src }\`
 * objects or a plain string[] of image URLs.
 */
export function LogosMarquee({
  eyebrow,
  logos,
  speed = 40,
  className,
}: {
  eyebrow?: React.ReactNode;
  logos: LogoEntry[];
  speed?: number;
  className?: string;
}) {
  const list = Array.isArray(logos) ? logos.map(normalizeLogo) : [];
  return (
    <section className={cn("py-12 md:py-16", className)}>
      <Container size="xl">
        {eyebrow && (
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <div className="[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <Marquee speed={speed}>
            {list.map((l, i) =>
              l.src ? (
                <img
                  key={i}
                  src={l.src}
                  alt={l.name}
                  className="mx-8 h-7 w-auto opacity-60 grayscale"
                  loading="lazy"
                />
              ) : (
                <span key={i} className="mx-8 text-base font-semibold tracking-tight text-muted-foreground/70">
                  {l.name}
                </span>
              ),
            )}
          </Marquee>
        </div>
      </Container>
    </section>
  );
}
`;

// =============================================================================
// STATS — 3 variants
// =============================================================================

const STATS_BAND = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

export interface StatItem {
  value: React.ReactNode;
  label: React.ReactNode;
  hint?: React.ReactNode;
}

/**
 * Full-bleed stats band — bold numbers, vertical dividers between them.
 * Use under a hero or above a footer for instant social proof.
 */
export function StatsBand({
  items,
  tone = "muted",
  className,
}: {
  items: StatItem[];
  tone?: "muted" | "primary";
  className?: string;
}) {
  const list = Array.isArray(items) ? items : [];
  const bg = tone === "primary" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground";
  const labelTone = tone === "primary" ? "text-primary-foreground/80" : "text-muted-foreground";
  const dividers = tone === "primary" ? "divide-primary-foreground/20" : "divide-border";
  return (
    <section className={cn("border-y border-border", bg, className)}>
      <Container size="xl">
        <dl className={cn("grid grid-cols-2 divide-y md:grid-cols-4 md:divide-x md:divide-y-0", dividers)}>
          {list.map((s, i) => (
            <div key={i} className="px-6 py-10 text-center md:py-12">
              <dt className={cn("text-xs font-semibold uppercase tracking-wider", labelTone)}>{s.label}</dt>
              <dd className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{s.value}</dd>
              {s.hint && <p className={cn("mt-1 text-xs", labelTone)}>{s.hint}</p>}
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
`;

const STATS_GRID = `import * as React from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/utils";

export interface StatGridItem {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  hint?: string;
}

/**
 * Grid of <Stat> cards. Use for KPI dashboards or as a section on a
 * marketing page. Cards include trend indicators (delta).
 */
export function StatsGrid({
  eyebrow,
  title,
  description,
  items,
  cols = 4,
  className,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  items: StatGridItem[];
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const list = Array.isArray(items) ? items : [];
  const grid = cols === 4 ? "md:grid-cols-2 lg:grid-cols-4" : cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return (
    <Container size="lg" className={className}>
      <Section eyebrow={eyebrow} title={title} description={description}>
        <div className={cn("grid grid-cols-1 gap-4", grid)}>
          {list.map((s, i) => (
            <Stat key={i} label={s.label} value={s.value} delta={s.delta} hint={s.hint} />
          ))}
        </div>
      </Section>
    </Container>
  );
}
`;

const STATS_WITH_CHART = `import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart } from "@/components/ui/chart";
import { Container } from "@/components/ui/container";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/utils";

export interface StatsChartKpi {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
}

/**
 * Hero-style stats panel: 3 KPIs alongside a trend chart. For dashboards or
 * "see your numbers" landing-page sections.
 */
export function StatsWithChart({
  title,
  description,
  kpis,
  data,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  kpis: StatsChartKpi[];
  data: { x: string; y: number }[];
  className?: string;
}) {
  return (
    <Container size="xl" className={className}>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-4">
          {kpis.map((k, i) => (
            <Stat key={i} label={k.label} value={k.value} delta={k.delta} />
          ))}
        </div>
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <AreaChart data={data} color={1} />
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
`;

// =============================================================================
// PAGE-ASSEMBLY EXAMPLES — read-only references the model copies from.
// These show COMPOSITION. They live under src/components/examples/* and are
// NOT auto-imported by App.tsx — the model picks the closest fit and adapts.
// =============================================================================

const EXAMPLE_LANDING_SAAS = `/**
 * REFERENCE — SaaS product landing page.
 *
 * Shape: NavWithCta → HeroSplitImage → LogosMarquee → FeaturesBento →
 *        StatsBand → TestimonialsCards → PricingSingleProduct → FaqAccordion →
 *        CtaCentered → FooterColumns
 *
 * Copy this structure for: SaaS, dev tools, B2B products. Mix variants —
 * don't use HeroCentered everywhere.
 */
import { Bolt, BookOpen, GitBranch, Globe, ShieldCheck, Sparkles, Twitter, Github } from "lucide-react";
import { NavWithCta } from "@/components/blocks/nav-with-cta";
import { HeroSplitImage } from "@/components/blocks/hero-split-image";
import { LogosMarquee } from "@/components/blocks/logos-marquee";
import { FeaturesBento } from "@/components/blocks/features-bento";
import { StatsBand } from "@/components/blocks/stats-band";
import { TestimonialsCards } from "@/components/blocks/testimonials-cards";
import { PricingSingleProduct } from "@/components/blocks/pricing-single-product";
import { FaqAccordion } from "@/components/blocks/faq-accordion";
import { CtaCentered } from "@/components/blocks/cta-centered";
import { FooterColumns } from "@/components/blocks/footer-columns";

export default function LandingSaasReference() {
  return (
    <div className="min-h-screen bg-background">
      <NavWithCta
        brand="Acme"
        links={[{label:"Features",href:"#"},{label:"Pricing",href:"#"},{label:"Docs",href:"#"}]}
        secondary={{label:"Log in",href:"#"}}
        cta={{label:"Start free",href:"#"}}
      />
      <HeroSplitImage
        eyebrow="New · v3.0"
        title="Ship faster. Argue less."
        description="The opinionated workflow tool your whole team can agree on. Less ceremony, more shipping."
        primaryCta={{label:"Start free",href:"#"}}
        secondaryCta={{label:"Watch demo",href:"#"}}
        imageSrc="petal-image://saas-product-screenshot-clean-dark-mode"
      />
      <LogosMarquee eyebrow="Used at" logos={[{name:"Acme"},{name:"Globex"},{name:"Initech"},{name:"Hooli"},{name:"Stark"},{name:"Wonka"}]} />
      <FeaturesBento
        eyebrow="Why teams switch"
        title="Built for the work, not the demo."
        items={[
          {icon:Bolt,title:"Fast by default",description:"Sub-50ms interactions across the app.",span:2,accent:true},
          {icon:GitBranch,title:"Branch-aware",description:"Every change is a draft until you ship.",span:1},
          {icon:ShieldCheck,title:"SOC 2 from day one",description:"Audited annually.",span:1},
          {icon:Globe,title:"Works everywhere",description:"Web, desktop, CLI.",span:2},
        ]}
      />
      <StatsBand items={[{label:"Active teams",value:"12k"},{label:"Avg time saved",value:"6h/wk"},{label:"Uptime",value:"99.99%"},{label:"Countries",value:"82"}]} />
      <TestimonialsCards
        eyebrow="Testimonials"
        title="Loved by makers"
        items={[
          {quote:"Cut our planning meetings in half.",name:"Ana K.",role:"Eng lead, Acme",rating:5},
          {quote:"Finally a tool the whole team uses.",name:"Tom B.",role:"PM, Hooli",rating:5},
          {quote:"It just gets out of the way.",name:"Sam J.",role:"Founder, Stark",rating:5},
        ]}
      />
      <PricingSingleProduct
        eyebrow="Pricing"
        heading="One price. Everything included."
        title="Team plan"
        subtitle="Unlimited seats"
        price="$29"
        period="month"
        features={["Unlimited projects","SSO and audit log","Priority support","All future updates"]}
        cta={{label:"Start 14-day trial",href:"#"}}
        footnote="No credit card required."
      />
      <FaqAccordion
        eyebrow="FAQ"
        title="Common questions"
        items={[
          {q:"Can I cancel anytime?",a:"Yes — cancel from your dashboard, no questions asked."},
          {q:"Do you offer discounts?",a:"Yes for non-profits and education — write us."},
          {q:"Is my data safe?",a:"All data is encrypted at rest and in transit; we are SOC 2 Type II."},
        ]}
      />
      <CtaCentered eyebrow="Ready?" title="Start shipping today." description="Free for 14 days. No card." primaryCta={{label:"Get started",href:"#"}} />
      <FooterColumns
        brand="Acme"
        tagline="Workflow software for teams that ship."
        columns={[
          {title:"Product",links:[{label:"Features",href:"#"},{label:"Pricing",href:"#"}]},
          {title:"Company",links:[{label:"About",href:"#"},{label:"Careers",href:"#"}]},
          {title:"Resources",links:[{label:"Docs",href:"#"},{label:"Blog",href:"#"}]},
          {title:"Legal",links:[{label:"Privacy",href:"#"},{label:"Terms",href:"#"}]},
        ]}
        social={[{icon:Twitter,href:"#",label:"Twitter"},{icon:Github,href:"#",label:"GitHub"}]}
        copyright={\`© \${new Date().getFullYear()} Acme. All rights reserved.\`}
      />
    </div>
  );
}
`;

const EXAMPLE_LANDING_EDITORIAL = `/**
 * REFERENCE — Editorial portfolio / agency homepage.
 *
 * Shape: NavBar → HeroEditorial → FeaturesAlternatingRows →
 *        TestimonialsQuoteHero → CtaSplit → FooterMinimal
 *
 * Copy for: agencies, design studios, photographers, writers — anywhere
 * voice and craft matter more than feature lists.
 */
import { NavBar } from "@/components/blocks/nav-bar";
import { HeroEditorial } from "@/components/blocks/hero-editorial";
import { FeaturesAlternatingRows } from "@/components/blocks/features-alternating-rows";
import { TestimonialsQuoteHero } from "@/components/blocks/testimonials-quote-hero";
import { CtaSplit } from "@/components/blocks/cta-split";
import { FooterMinimal } from "@/components/blocks/footer-minimal";

export default function LandingEditorialReference() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar brand="Studio Noor" links={[{label:"Work",href:"#"},{label:"About",href:"#"},{label:"Journal",href:"#"},{label:"Contact",href:"#"}]} />
      <HeroEditorial
        number="04"
        meta="Issue 04 — Spring 2026"
        title="Quiet brands for loud markets."
        lede="We design identity systems for the next generation of consumer companies. Twelve clients a year. No exceptions."
        primaryCta={{label:"See the work",href:"#"}}
      />
      <FeaturesAlternatingRows
        eyebrow="Practice"
        title="Three things we do well."
        items={[
          {eyebrow:"01 — Identity",title:"Marks that age well.",description:"Wordmarks, monograms, type systems. We start every engagement with naming and end it with a usage guide.",bullets:["Naming and verbal identity","Logo and mark","Type and color systems"],imageSrc:"petal-image://editorial-brand-identity-mockup-warm-cream"},
          {eyebrow:"02 — Packaging",title:"Shelf presence by design.",description:"From dieline to print supervision. We've shipped 80+ packaging programs across food, beauty, and apparel.",bullets:["Structural and dieline","Photography art direction","On-press supervision"],imageSrc:"petal-image://packaging-design-flatlay-warm-tones"},
          {eyebrow:"03 — Digital",title:"Sites that feel made, not assembled.",description:"Editorial-quality websites with motion and typography our clients can update themselves.",bullets:["Brand websites","E-commerce","CMS authoring"],imageSrc:"petal-image://editorial-website-mockup-laptop-warm"},
        ]}
      />
      <TestimonialsQuoteHero
        quote="Studio Noor doesn't make logos. They make decisions easier for the next ten years of your company."
        name="Imani Okafor"
        role="Founder"
        company="Maven Goods"
      />
      <CtaSplit
        title="Twelve clients a year. Two slots left."
        description="If you're rebranding in the next 6–9 months, let's talk."
        primaryCta={{label:"Start a project",href:"mailto:hi@studio.example"}}
        secondaryCta={{label:"Read the journal",href:"#"}}
      />
      <FooterMinimal
        brand="Studio Noor"
        links={[{label:"Work",href:"#"},{label:"About",href:"#"},{label:"Instagram",href:"#"},{label:"Contact",href:"#"}]}
        copyright={\`© \${new Date().getFullYear()} Studio Noor\`}
      />
    </div>
  );
}
`;

const EXAMPLE_LANDING_ECOMMERCE = `/**
 * REFERENCE — Single-product e-commerce landing page.
 *
 * Shape: NavWithCta → HeroSplitImage (product shot) → StatsBand (social proof) →
 *        FeaturesAlternatingRows → TestimonialsMarquee → PricingSingleProduct →
 *        FaqTwoColumn → CtaGradientBand → FooterNewsletter
 *
 * Copy for: D2C product launches, lifetime deals, single SKU stores.
 */
import { Box, Leaf, Truck, Twitter, Instagram } from "lucide-react";
import { NavWithCta } from "@/components/blocks/nav-with-cta";
import { HeroSplitImage } from "@/components/blocks/hero-split-image";
import { StatsBand } from "@/components/blocks/stats-band";
import { FeaturesAlternatingRows } from "@/components/blocks/features-alternating-rows";
import { TestimonialsMarquee } from "@/components/blocks/testimonials-marquee";
import { PricingSingleProduct } from "@/components/blocks/pricing-single-product";
import { FaqTwoColumn } from "@/components/blocks/faq-two-column";
import { CtaGradientBand } from "@/components/blocks/cta-gradient-band";
import { FooterNewsletter } from "@/components/blocks/footer-newsletter";

export default function LandingEcommerceReference() {
  return (
    <div className="min-h-screen bg-background">
      <NavWithCta brand="Cup Co." links={[{label:"Story",href:"#"},{label:"Reviews",href:"#"},{label:"FAQ",href:"#"}]} cta={{label:"Buy now",href:"#buy"}} />
      <HeroSplitImage
        eyebrow="Limited drop · 2,000 units"
        title="The last cup you'll ever buy."
        description="A double-walled, double-life ceramic cup. Designed in Lisbon. Built to outlive trends."
        primaryCta={{label:"Order — $49",href:"#buy"}}
        secondaryCta={{label:"See the story",href:"#"}}
        imageSrc="petal-image://ceramic-cup-product-shot-warm-cream-background"
        reverse
      />
      <StatsBand tone="primary" items={[{label:"Cups shipped",value:"24,800"},{label:"Avg rating",value:"4.9 ★"},{label:"Countries",value:"38"},{label:"Re-orders",value:"61%"}]} />
      <FeaturesAlternatingRows
        eyebrow="Made well"
        title="Three things we obsessed over."
        items={[
          {eyebrow:"Material",title:"Stoneware that warms, not burns.",description:"Hand-glazed in Portugal. Fires at 1,260°C — no leaching, no chips, no fade.",bullets:["Lead-free glaze","Microwave & dishwasher safe","12 oz — the right amount"],imageSrc:"petal-image://ceramic-cup-detail-glaze-cream"},
          {eyebrow:"Form",title:"Sized for hands, not Instagram.",description:"We tested 14 prototypes. The handle sits flush, the rim is rolled, and the base never wobbles.",imageSrc:"petal-image://ceramic-cup-side-profile-cream"},
          {eyebrow:"Shipped",title:"Carbon-neutral, every cup.",description:"Compostable packaging. Offset shipping. We plant a tree for every order.",imageSrc:"petal-image://ceramic-cup-packaging-craft-paper"},
        ]}
      />
      <TestimonialsMarquee
        eyebrow="From real cupboards"
        title="Quiet cult favorite."
        items={Array.from({length:8}).map((_,i)=>({quote:"Use it every single morning. Wouldn't swap it.",name:\`Customer \${i+1}\`,role:"Verified buyer"}))}
      />
      <PricingSingleProduct
        title="The Cup"
        subtitle="One size. One color. One price."
        price="$49"
        originalPrice="$68"
        period="cup"
        features={["Free worldwide shipping","30-day no-questions returns","Replacement cup if it ever breaks","Tree planted with every order"]}
        cta={{label:"Add to cart",href:"#buy"}}
        footnote="Limited to 2,000 units. 612 left."
      />
      <FaqTwoColumn
        eyebrow="Questions"
        title="Yes, you can put it in the dishwasher."
        items={[
          {q:"Is it microwave safe?",a:"Yes. The glaze stays cool while the contents heat up evenly."},
          {q:"How long does shipping take?",a:"3–5 business days within the EU and US. 7–10 elsewhere."},
          {q:"What if it breaks?",a:"We'll send a free replacement. Just send a photo to support."},
          {q:"Can I order more than one?",a:"Up to 4 per order while supplies last."},
        ]}
      />
      <CtaGradientBand
        title="The last cup, while it lasts."
        description="612 of 2,000 left. Once they're gone, that's it."
        primaryCta={{label:"Order yours — $49",href:"#buy"}}
      />
      <FooterNewsletter
        brand="Cup Co."
        tagline="One cup. Made well. From Lisbon."
        newsletterTitle="Hear about the next drop first."
        newsletterDescription="No spam. Two emails a year."
        columns={[
          {title:"Shop",links:[{label:"The Cup",href:"#"},{label:"Story",href:"#"}]},
          {title:"Help",links:[{label:"Shipping",href:"#"},{label:"Returns",href:"#"}]},
          {title:"Follow",links:[{label:"Instagram",href:"#"},{label:"Twitter",href:"#"}]},
        ]}
        copyright={\`© \${new Date().getFullYear()} Cup Co. — Made in Lisbon.\`}
      />
    </div>
  );
}
`;

const EXAMPLE_LANDING_AGENCY = `/**
 * REFERENCE — Agency / services landing page.
 *
 * Shape: NavBar → HeroEditorial → LogosGrid → FeaturesGrid3 →
 *        TestimonialsQuoteHero → FaqTwoColumn → CtaSplit → FooterColumns
 */
import { Compass, Layers, PenTool, Twitter, Linkedin } from "lucide-react";
import { NavBar } from "@/components/blocks/nav-bar";
import { HeroEditorial } from "@/components/blocks/hero-editorial";
import { LogosGrid } from "@/components/blocks/logos-grid";
import { FeaturesGrid3 } from "@/components/blocks/features-grid-3";
import { TestimonialsQuoteHero } from "@/components/blocks/testimonials-quote-hero";
import { FaqTwoColumn } from "@/components/blocks/faq-two-column";
import { CtaSplit } from "@/components/blocks/cta-split";
import { FooterColumns } from "@/components/blocks/footer-columns";

export default function LandingAgencyReference() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar brand="North Field" links={[{label:"Services",href:"#"},{label:"Work",href:"#"},{label:"About",href:"#"},{label:"Contact",href:"#"}]} />
      <HeroEditorial
        title="Strategy, identity, and product for ambitious teams."
        lede="A small studio working with founders and product leaders on the things that matter most."
        meta="Est. 2019 · Berlin / NYC"
        primaryCta={{label:"See selected work",href:"#"}}
      />
      <LogosGrid eyebrow="Selected clients" logos={[{name:"Maven"},{name:"Loom"},{name:"Plow"},{name:"Drift"},{name:"Solace"},{name:"Atlas"}]} />
      <FeaturesGrid3
        eyebrow="Services"
        title="What we do, end to end."
        items={[
          {icon:Compass,title:"Strategy",description:"Positioning, naming, narrative — the spine of the brand."},
          {icon:PenTool,title:"Identity",description:"Wordmarks, type systems, color, and applied design."},
          {icon:Layers,title:"Product",description:"Marketing sites, dashboards, and onboarding flows."},
        ]}
      />
      <TestimonialsQuoteHero
        quote="They moved faster than any agency we've worked with — and the work was better."
        name="Devon Wright"
        role="CEO"
        company="Plow"
      />
      <FaqTwoColumn
        eyebrow="Working together"
        title="What it's like."
        items={[
          {q:"What's your engagement size?",a:"Most projects run 6–12 weeks at $40–120k."},
          {q:"Do you take retainers?",a:"Selectively, after a first engagement."},
          {q:"What's your team?",a:"Two founders, plus a small bench of senior collaborators."},
        ]}
      />
      <CtaSplit title="Two project slots open in Q2." description="If you're planning a launch, get in touch." primaryCta={{label:"Email us",href:"mailto:hi@northfield.example"}} />
      <FooterColumns
        brand="North Field"
        tagline="A small strategy and design studio."
        columns={[
          {title:"Studio",links:[{label:"Work",href:"#"},{label:"About",href:"#"}]},
          {title:"Connect",links:[{label:"Email",href:"#"},{label:"Newsletter",href:"#"}]},
          {title:"Legal",links:[{label:"Privacy",href:"#"},{label:"Imprint",href:"#"}]},
        ]}
        social={[{icon:Twitter,href:"#",label:"Twitter"},{icon:Linkedin,href:"#",label:"LinkedIn"}]}
        copyright={\`© \${new Date().getFullYear()} North Field\`}
      />
    </div>
  );
}
`;

const EXAMPLE_APP_SHELL = `/**
 * REFERENCE — Authenticated app shell with sidebar + topbar.
 *
 * For dashboards / SaaS app interiors (NOT marketing pages). Use
 * NavWithSearch as the topbar and DASHBOARD_SIDEBAR_LAYOUT (in examples-pack)
 * for the sidebar. This file shows the COMPOSITION.
 */
import { Bell, Inbox } from "lucide-react";
import { NavWithSearch } from "@/components/blocks/nav-with-search";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";

export default function AppShellReference() {
  return (
    <div className="min-h-screen bg-muted/20">
      <NavWithSearch
        brand="Workspace"
        links={[{label:"Inbox",href:"#"},{label:"Reports",href:"#"},{label:"Settings",href:"#"}]}
        cta={{label:"New",href:"#"}}
      />
      <Container size="xl" className="py-10">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat label="Open" value="12" delta={-4.2} />
          <Stat label="Resolved today" value="38" delta={12.5} />
          <Stat label="Avg. response" value="2h 14m" delta={-8.1} hint="vs last week" />
        </div>
        <div className="mt-8">
          <EmptyState
            icon={Inbox}
            title="Inbox zero"
            description="Nothing waiting. New work will appear here as it comes in."
            action={<Button variant="outline">View archive</Button>}
          />
        </div>
      </Container>
    </div>
  );
}
`;

const EXAMPLE_BLOG_INDEX = `/**
 * REFERENCE — Blog index page.
 *
 * Shape: NavBar → Section header → article grid → FooterMinimal.
 * Use <Prose> on the actual post detail page (see blog-post-detail.tsx).
 */
import { Calendar } from "lucide-react";
import { NavBar } from "@/components/blocks/nav-bar";
import { FooterMinimal } from "@/components/blocks/footer-minimal";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

const POSTS = [
  { slug: "ship-more-meet-less", title: "Ship more, meet less", excerpt: "How small teams keep a daily ship cadence.", date: "Apr 12, 2026", cover: "petal-image://blog-cover-minimal-ship" },
  { slug: "the-quiet-rewrite", title: "The quiet rewrite", excerpt: "Refactoring without anyone noticing.", date: "Mar 28, 2026", cover: "petal-image://blog-cover-minimal-rewrite" },
  { slug: "design-after-figma", title: "Design after Figma", excerpt: "What comes after the canvas.", date: "Mar 02, 2026", cover: "petal-image://blog-cover-minimal-design" },
];

export default function BlogIndexReference() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar brand="Field Notes" links={[{label:"Writing",href:"#"},{label:"About",href:"#"}]} />
      <Container size="lg">
        <Section eyebrow="Journal" title="Field notes on building, slowly." description="One essay a fortnight. No newsletter, no pop-ups, no tracking.">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
            {POSTS.map((p) => (
              <a key={p.slug} href={\`/posts/\${p.slug}\`} className="group">
                <div className="overflow-hidden rounded-2xl border border-border bg-muted">
                  <img src={p.cover} alt="" className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
                </div>
                <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <time>{p.date}</time>
                </div>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground transition group-hover:text-primary">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.excerpt}</p>
              </a>
            ))}
          </div>
        </Section>
      </Container>
      <FooterMinimal brand="Field Notes" links={[{label:"RSS",href:"/rss.xml"},{label:"Email",href:"#"}]} copyright={\`© \${new Date().getFullYear()} Field Notes\`} />
    </div>
  );
}
`;

const EXAMPLE_BLOG_DETAIL = `/**
 * REFERENCE — Blog post detail page.
 *
 * Shape: NavBar → article header → <Prose> body → CtaCentered → FooterMinimal.
 * <Prose> applies typography to nested h1/h2/p/ul/blockquote/code/pre — no
 * @tailwindcss/typography plugin required.
 */
import { NavBar } from "@/components/blocks/nav-bar";
import { CtaCentered } from "@/components/blocks/cta-centered";
import { FooterMinimal } from "@/components/blocks/footer-minimal";
import { Container } from "@/components/ui/container";
import { Prose } from "@/components/ui/prose";

export default function BlogPostDetailReference() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar brand="Field Notes" links={[{label:"Writing",href:"#"},{label:"About",href:"#"}]} />
      <Container size="md" className="py-16">
        <header className="mb-10">
          <div className="text-xs uppercase tracking-[0.2em] text-primary">Essay</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-foreground md:text-5xl">Ship more, meet less</h1>
          <p className="mt-3 text-sm text-muted-foreground">Apr 12, 2026 · 6 min read</p>
        </header>
        <Prose>
          <p>The simplest way to ship more is to meet less. The simplest way to meet less is to write more. The simplest way to write more is to make writing the default verb of the team.</p>
          <h2>Why writing wins</h2>
          <p>Writing is asynchronous. Writing is reviewable. Writing is durable. A meeting decision that isn't written down didn't happen.</p>
          <blockquote>If a meeting could have been a memo, it should have been a memo.</blockquote>
          <h3>What we do instead</h3>
          <ul>
            <li>One weekly sync, 30 minutes, agenda required.</li>
            <li>Every decision lives in a numbered RFC.</li>
            <li>Standups are async — three bullets in a thread.</li>
          </ul>
          <p>The team ships more. The team meets less. There is no third trick.</p>
        </Prose>
      </Container>
      <CtaCentered title="Get the next essay." description="One every fortnight. Unsubscribe with one click." primaryCta={{label:"Subscribe",href:"#"}} />
      <FooterMinimal brand="Field Notes" copyright={\`© \${new Date().getFullYear()} Field Notes\`} />
    </div>
  );
}
`;

// =============================================================================
// REGISTRY
// =============================================================================

export const KIT_BLOCK_FILES_2: KitFile[] = [
  // Testimonials
  { path: "src/components/blocks/testimonials-cards.tsx", content: TESTIMONIALS_CARDS, overwrite: true },
  { path: "src/components/blocks/testimonials-marquee.tsx", content: TESTIMONIALS_MARQUEE, overwrite: true },
  { path: "src/components/blocks/testimonials-quote-hero.tsx", content: TESTIMONIALS_QUOTE_HERO, overwrite: true },
  // Pricing
  { path: "src/components/blocks/pricing-single-product.tsx", content: PRICING_SINGLE_PRODUCT, overwrite: true },
  // FAQ
  { path: "src/components/blocks/faq-accordion.tsx", content: FAQ_ACCORDION, overwrite: true },
  { path: "src/components/blocks/faq-two-column.tsx", content: FAQ_TWO_COLUMN, overwrite: true },
  // CTA
  { path: "src/components/blocks/cta-centered.tsx", content: CTA_CENTERED, overwrite: true },
  { path: "src/components/blocks/cta-split.tsx", content: CTA_SPLIT, overwrite: true },
  { path: "src/components/blocks/cta-gradient-band.tsx", content: CTA_GRADIENT_BAND, overwrite: true },
  // Footer
  { path: "src/components/blocks/footer-columns.tsx", content: FOOTER_COLUMNS, overwrite: true },
  { path: "src/components/blocks/footer-minimal.tsx", content: FOOTER_MINIMAL, overwrite: true },
  { path: "src/components/blocks/footer-newsletter.tsx", content: FOOTER_NEWSLETTER, overwrite: true },
  // Nav
  { path: "src/components/blocks/nav-bar.tsx", content: NAV_BAR, overwrite: true },
  { path: "src/components/blocks/nav-with-cta.tsx", content: NAV_WITH_CTA, overwrite: true },
  { path: "src/components/blocks/nav-with-search.tsx", content: NAV_WITH_SEARCH, overwrite: true },
  // Logo cloud
  { path: "src/components/blocks/logos-grid.tsx", content: LOGOS_GRID, overwrite: true },
  { path: "src/components/blocks/logos-marquee.tsx", content: LOGOS_MARQUEE, overwrite: true },
  // Stats
  { path: "src/components/blocks/stats-band.tsx", content: STATS_BAND, overwrite: true },
  { path: "src/components/blocks/stats-grid.tsx", content: STATS_GRID, overwrite: true },
  { path: "src/components/blocks/stats-with-chart.tsx", content: STATS_WITH_CHART, overwrite: true },
  // Page-assembly examples (read-only references)
  { path: "src/components/examples/landing-saas-product.tsx", content: EXAMPLE_LANDING_SAAS, overwrite: true },
  { path: "src/components/examples/landing-editorial-portfolio.tsx", content: EXAMPLE_LANDING_EDITORIAL, overwrite: true },
  { path: "src/components/examples/landing-ecommerce-single-product.tsx", content: EXAMPLE_LANDING_ECOMMERCE, overwrite: true },
  { path: "src/components/examples/landing-agency-services.tsx", content: EXAMPLE_LANDING_AGENCY, overwrite: true },
  { path: "src/components/examples/app-shell-with-sidebar.tsx", content: EXAMPLE_APP_SHELL, overwrite: true },
  { path: "src/components/examples/blog-index.tsx", content: EXAMPLE_BLOG_INDEX, overwrite: true },
  { path: "src/components/examples/blog-post-detail.tsx", content: EXAMPLE_BLOG_DETAIL, overwrite: true },
];
