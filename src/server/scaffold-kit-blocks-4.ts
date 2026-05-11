/**
 * Phase-4 expansion (workstream B continuation).
 *
 * Domain section blocks for the templates added in Step 2 of the 500-system
 * plan: commerce/booking/content/community/AI/fintech-demo/mobile/education.
 *
 * Each block:
 *  - ≤ 120 lines
 *  - imports only kit primitives + lucide-react
 *  - pure theme tokens (no hardcoded colors)
 *  - safe defaults so it renders with zero props
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// ============================================================================
// DEMO BANNER — universal banner for demo-only fintech/health/legal templates.
// ============================================================================
const DEMO_BANNER = `import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sticky banner declaring this build is a non-functional demo. */
export function DemoBanner({
  label = "Demo only",
  message = "This is a UI demo — no real money, accounts, or transactions are involved.",
  className,
}: { label?: string; message?: string; className?: string }) {
  return (
    <div role="alert" className={cn("w-full border-b bg-muted/60 backdrop-blur supports-[backdrop-filter]:bg-muted/40", className)}>
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-foreground" aria-hidden />
        <div><span className="font-medium text-foreground">{label}.</span> <span className="text-muted-foreground">{message}</span></div>
      </div>
    </div>
  );
}
`;

// ============================================================================
// SERVICE CARD — used by salon-spa, booking-appointments, agency-studio.
// ============================================================================
const SERVICE_CARD = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ServiceCardProps {
  name: string;
  description?: string;
  durationMinutes?: number;
  price?: string;
  badge?: string;
  ctaLabel?: string;
  onSelect?: () => void;
  className?: string;
}

export function ServiceCard({ name, description, durationMinutes, price, badge, ctaLabel = "Book", onSelect, className }: ServiceCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="mt-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {durationMinutes != null && (<span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{durationMinutes} min</span>)}
          {price && <span className="font-medium text-foreground">{price}</span>}
        </div>
        <Button size="sm" onClick={onSelect}>{ctaLabel}</Button>
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// MENU SECTION — restaurant template.
// ============================================================================
const MENU_SECTION = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface MenuItem { name: string; description?: string; price: string; tags?: string[] }
export interface MenuSectionProps { title: string; subtitle?: string; items: MenuItem[]; className?: string }

export function MenuSection({ title, subtitle, items, className }: MenuSectionProps) {
  return (
    <section className={cn("py-12", className)}>
      <div className="mx-auto max-w-3xl px-4">
        <header className="mb-8 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
        </header>
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.name} className="grid grid-cols-[1fr_auto] gap-4 py-4">
              <div>
                <div className="font-medium text-foreground">{it.name}</div>
                {it.description && <div className="mt-0.5 text-sm text-muted-foreground">{it.description}</div>}
                {it.tags && it.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {it.tags.map((t) => (<span key={t}>· {t}</span>))}
                  </div>
                )}
              </div>
              <div className="font-medium text-foreground">{it.price}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
`;

// ============================================================================
// GALLERY GRID — masonry-ish image grid.
// ============================================================================
const GALLERY_GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface GalleryImage { src: string; alt: string; href?: string }
export interface GalleryGridProps { images: GalleryImage[]; columns?: 2|3|4; className?: string }

export function GalleryGrid({ images, columns = 3, className }: GalleryGridProps) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={cn("grid grid-cols-1 gap-3", cols, className)}>
      {images.map((img, i) => {
        const Inner = (
          <img src={img.src} alt={img.alt} loading="lazy" className="aspect-square w-full rounded-md object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        );
        return (
          <figure key={i} className="group overflow-hidden rounded-md bg-muted">
            {img.href ? <a href={img.href} aria-label={img.alt}>{Inner}</a> : Inner}
          </figure>
        );
      })}
    </div>
  );
}
`;

// ============================================================================
// CATEGORY GRID — knowledge-base, community-forum, recipe.
// ============================================================================
const CATEGORY_GRID = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface Category { id: string; label: string; description?: string; count?: number; href?: string; Icon?: LucideIcon }
export interface CategoryGridProps { categories: Category[]; columns?: 2|3|4; className?: string; onSelect?: (id: string) => void }

export function CategoryGrid({ categories, columns = 3, className, onSelect }: CategoryGridProps) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={cn("grid grid-cols-1 gap-3", cols, className)}>
      {categories.map((c) => {
        const inner = (
          <Card className="h-full transition-colors hover:border-foreground/40">
            <CardContent className="flex h-full items-start gap-3 p-4">
              {c.Icon && <c.Icon className="mt-0.5 h-5 w-5 text-foreground" aria-hidden />}
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground">{c.label}</div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </div>
                {c.description && <p className="mt-0.5 text-sm text-muted-foreground">{c.description}</p>}
                {typeof c.count === "number" && <p className="mt-2 text-xs text-muted-foreground">{c.count} entries</p>}
              </div>
            </CardContent>
          </Card>
        );
        if (c.href) return <a key={c.id} href={c.href} className="block">{inner}</a>;
        return <button key={c.id} type="button" onClick={() => onSelect?.(c.id)} className="block w-full text-left">{inner}</button>;
      })}
    </div>
  );
}
`;

// ============================================================================
// ARTICLE CARD — blog, knowledge-base, newsletter.
// ============================================================================
const ARTICLE_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ArticleCardProps {
  title: string;
  excerpt?: string;
  cover?: string;
  author?: string;
  date?: string;
  readingMinutes?: number;
  tag?: string;
  href?: string;
  className?: string;
}

export function ArticleCard({ title, excerpt, cover, author, date, readingMinutes, tag, href = "#", className }: ArticleCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {cover && <a href={href}><img src={cover} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" /></a>}
      <CardContent className="space-y-2 p-4">
        {tag && <Badge variant="secondary">{tag}</Badge>}
        <a href={href} className="block"><h3 className="line-clamp-2 text-lg font-semibold text-foreground hover:underline">{title}</h3></a>
        {excerpt && <p className="line-clamp-3 text-sm text-muted-foreground">{excerpt}</p>}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {author && <span>{author}</span>}
          {(author && date) && <span>·</span>}
          {date && <time>{date}</time>}
          {readingMinutes != null && <span>· {readingMinutes} min read</span>}
        </div>
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// AUTHOR CARD — blog/podcast/newsletter.
// ============================================================================
const AUTHOR_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface AuthorCardProps { name: string; role?: string; bio?: string; avatarUrl?: string; href?: string; className?: string }

export function AuthorCard({ name, role, bio, avatarUrl, href, className }: AuthorCardProps) {
  const inner = (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex items-start gap-4 p-4">
        <Avatar className="h-12 w-12">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
          <AvatarFallback>{name.slice(0,2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{name}</div>
          {role && <div className="text-sm text-muted-foreground">{role}</div>}
          {bio && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{bio}</p>}
        </div>
      </CardContent>
    </Card>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}
`;

// ============================================================================
// EPISODE CARD — podcast.
// ============================================================================
const EPISODE_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EpisodeCardProps {
  number?: number;
  title: string;
  description?: string;
  durationLabel?: string;
  date?: string;
  cover?: string;
  href?: string;
  onPlay?: () => void;
  className?: string;
}

export function EpisodeCard({ number, title, description, durationLabel, date, cover, href, onPlay, className }: EpisodeCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="flex gap-4 p-4">
        {cover && <img src={cover} alt="" loading="lazy" className="hidden h-24 w-24 rounded object-cover sm:block" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {number != null && <>Episode {number}</>}{number != null && date && " · "}{date}
          </div>
          <a href={href ?? "#"} className="block"><h3 className="mt-1 line-clamp-2 font-semibold text-foreground hover:underline">{title}</h3></a>
          {description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={onPlay}><Play className="mr-1.5 h-4 w-4" aria-hidden />Play</Button>
            {durationLabel && <span className="text-xs text-muted-foreground">{durationLabel}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// AUDIO PLAYER — minimal HTML5 <audio> wrapper, no external deps.
// ============================================================================
const AUDIO_PLAYER = `import * as React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AudioPlayerProps { src: string; title?: string; subtitle?: string; className?: string }

export function AudioPlayer({ src, title, subtitle, className }: AudioPlayerProps) {
  const ref = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  React.useEffect(() => {
    const a = ref.current; if (!a) return;
    const onTime = () => setProgress(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => { a.removeEventListener("timeupdate", onTime); a.removeEventListener("loadedmetadata", onMeta); a.removeEventListener("ended", onEnd); };
  }, []);

  function toggle() { const a = ref.current; if (!a) return; if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); } }
  function fmt(s: number) { if (!isFinite(s)) return "0:00"; const m = Math.floor(s/60); const r = Math.floor(s%60); return m + ":" + String(r).padStart(2, "0"); }

  return (
    <div className={cn("flex items-center gap-3 rounded-md border bg-card p-3", className)}>
      <audio ref={ref} src={src} preload="metadata" />
      <Button size="icon" variant="secondary" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <div className="min-w-0 flex-1">
        {(title || subtitle) && (
          <div className="mb-1 truncate text-sm">
            {title && <span className="font-medium text-foreground">{title}</span>}
            {subtitle && <span className="ml-2 text-muted-foreground">{subtitle}</span>}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Slider value={[progress]} max={duration || 1} step={0.1} onValueChange={(v) => { const a = ref.current; if (a) a.currentTime = v[0]; }} className="flex-1" />
          <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{fmt(progress)} / {fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}
`;

// ============================================================================
// BOOKING FORM — booking-appointments, salon-spa, telehealth-demo.
// ============================================================================
const BOOKING_FORM = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BookingFormValues { name: string; email: string; date: string; time: string; notes: string }
export interface BookingFormProps {
  title?: string;
  serviceLabel?: string;
  availableTimes?: string[];
  onSubmit?: (values: BookingFormValues) => void | Promise<void>;
  submitLabel?: string;
  className?: string;
}

export function BookingForm({ title = "Book an appointment", serviceLabel, availableTimes = ["09:00","10:30","13:00","15:30"], onSubmit, submitLabel = "Confirm booking", className }: BookingFormProps) {
  const [v, setV] = React.useState<BookingFormValues>({ name: "", email: "", date: "", time: availableTimes[0] ?? "", notes: "" });
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await onSubmit?.(v); } finally { setBusy(false); }
  }

  return (
    <Card className={cn("w-full max-w-lg", className)}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {serviceLabel && <p className="text-sm text-muted-foreground">{serviceLabel}</p>}
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="bf-name">Name</Label><Input id="bf-name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="grid gap-2"><Label htmlFor="bf-email">Email</Label><Input id="bf-email" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label htmlFor="bf-date">Date</Label><Input id="bf-date" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
            <div className="grid gap-2">
              <Label htmlFor="bf-time">Time</Label>
              <select id="bf-time" required className="h-10 rounded-md border bg-background px-3 text-sm" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })}>
                {availableTimes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-2"><Label htmlFor="bf-notes">Notes (optional)</Label><Textarea id="bf-notes" rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// KANBAN BOARD — read-only column display, no DnD lib (kept zero-dep).
// ============================================================================
const KANBAN_BOARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface KanbanCard { id: string; title: string; subtitle?: string; tag?: string }
export interface KanbanColumn { id: string; title: string; cards: KanbanCard[] }
export interface KanbanBoardProps { columns: KanbanColumn[]; onCardClick?: (cardId: string, columnId: string) => void; className?: string }

export function KanbanBoard({ columns, onCardClick, className }: KanbanBoardProps) {
  return (
    <div className={cn("grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2", className)}>
      {columns.map((col) => (
        <section key={col.id} className="flex h-full min-w-[260px] flex-col rounded-md bg-muted/40 p-3">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{col.title}</h3>
            <span className="text-xs text-muted-foreground">{col.cards.length}</span>
          </header>
          <div className="flex flex-col gap-2">
            {col.cards.map((c) => (
              <button key={c.id} type="button" onClick={() => onCardClick?.(c.id, col.id)} className="text-left">
                <Card className="transition-shadow hover:shadow-sm">
                  <CardContent className="space-y-1 p-3">
                    <div className="text-sm font-medium text-foreground">{c.title}</div>
                    {c.subtitle && <div className="text-xs text-muted-foreground">{c.subtitle}</div>}
                    {c.tag && <Badge variant="secondary" className="mt-1">{c.tag}</Badge>}
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
`;

// ============================================================================
// CONTACT CARD — CRM contacts, alumni, vendor portal.
// ============================================================================
const CONTACT_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Mail, Phone } from "lucide-react";

export interface ContactCardProps {
  name: string;
  role?: string;
  company?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  tags?: string[];
  href?: string;
  className?: string;
}

export function ContactCard({ name, role, company, email, phone, avatarUrl, tags, href, className }: ContactCardProps) {
  const body = (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex items-start gap-3 p-4">
        <Avatar className="h-10 w-10"><AvatarImage src={avatarUrl} alt={name} /><AvatarFallback>{name.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{name}</div>
          {(role || company) && <div className="truncate text-sm text-muted-foreground">{role}{role && company && " · "}{company}</div>}
          <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {email && <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" aria-hidden />{email}</span>}
            {phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" aria-hidden />{phone}</span>}
          </div>
          {tags && tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">{tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return href ? <a href={href} className="block">{body}</a> : body;
}
`;

// ============================================================================
// THREAD CARD + REPLY LIST — community-forum.
// ============================================================================
const THREAD_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageSquare, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ThreadCardProps {
  title: string;
  excerpt?: string;
  author: string;
  authorAvatar?: string;
  category?: string;
  replies?: number;
  upvotes?: number;
  lastActivity?: string;
  href?: string;
  className?: string;
}

export function ThreadCard({ title, excerpt, author, authorAvatar, category, replies = 0, upvotes = 0, lastActivity, href = "#", className }: ThreadCardProps) {
  return (
    <Card className={cn("transition-colors hover:border-foreground/40", className)}>
      <CardContent className="flex gap-4 p-4">
        <Avatar className="h-10 w-10"><AvatarImage src={authorAvatar} alt={author} /><AvatarFallback>{author.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <a href={href} className="block"><h3 className="line-clamp-1 font-medium text-foreground hover:underline">{title}</h3></a>
          {excerpt && <p className="line-clamp-2 text-sm text-muted-foreground">{excerpt}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{author}</span>
            {category && <span>· in {category}</span>}
            {lastActivity && <span>· {lastActivity}</span>}
            <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" aria-hidden />{replies}</span>
            <span className="inline-flex items-center gap-1"><ArrowUp className="h-3.5 w-3.5" aria-hidden />{upvotes}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
`;

const REPLY_LIST = `import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface Reply { id: string; author: string; authorAvatar?: string; body: string; date?: string }
export interface ReplyListProps { replies: Reply[]; className?: string }

export function ReplyList({ replies, className }: ReplyListProps) {
  return (
    <ul className={cn("space-y-4", className)}>
      {replies.map((r, i) => (
        <li key={r.id}>
          <article className="flex gap-3">
            <Avatar className="h-9 w-9"><AvatarImage src={r.authorAvatar} alt={r.author} /><AvatarFallback>{r.author.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-medium text-foreground">{r.author}</span>
                {r.date && <time className="text-xs text-muted-foreground">{r.date}</time>}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{r.body}</div>
            </div>
          </article>
          {i < replies.length - 1 && <Separator className="mt-4" />}
        </li>
      ))}
    </ul>
  );
}
`;

// ============================================================================
// COMPOSE SHEET — community-forum, mobile-social.
// ============================================================================
const COMPOSE_SHEET = `import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

export interface ComposePayload { title: string; body: string }
export interface ComposeSheetProps {
  triggerLabel?: string;
  title?: string;
  bodyLabel?: string;
  onSubmit?: (payload: ComposePayload) => void | Promise<void>;
}

export function ComposeSheet({ triggerLabel = "New post", title = "Compose", bodyLabel = "What's on your mind?", onSubmit }: ComposeSheetProps) {
  const [open, setOpen] = React.useState(false);
  const [t, setT] = React.useState("");
  const [b, setB] = React.useState("");
  async function submit(e: React.FormEvent) { e.preventDefault(); await onSubmit?.({ title: t, body: b }); setT(""); setB(""); setOpen(false); }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button><Plus className="mr-1.5 h-4 w-4" aria-hidden />{triggerLabel}</Button></SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <div className="grid gap-2"><Label htmlFor="cs-title">Title</Label><Input id="cs-title" required value={t} onChange={(e) => setT(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="cs-body">{bodyLabel}</Label><Textarea id="cs-body" rows={6} required value={b} onChange={(e) => setB(e.target.value)} /></div>
          <Button type="submit">Publish</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
`;

// ============================================================================
// MOBILE NAV — bottom-tab nav for mobile-social, link-in-bio, fitness.
// ============================================================================
const MOBILE_NAV = `import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface MobileNavTab { id: string; label: string; Icon: LucideIcon; href?: string; badge?: number }
export interface MobileNavProps { tabs: MobileNavTab[]; activeId?: string; onSelect?: (id: string) => void; className?: string }

export function MobileNav({ tabs, activeId, onSelect, className }: MobileNavProps) {
  return (
    <nav className={cn("fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80", className)} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto grid max-w-md grid-flow-col">
        {tabs.map((t) => {
          const active = t.id === activeId;
          const inner = (
            <span className={cn("relative flex flex-col items-center gap-0.5 py-2 text-xs", active ? "text-foreground" : "text-muted-foreground")}>
              <t.Icon className="h-5 w-5" aria-hidden />
              <span>{t.label}</span>
              {t.badge != null && t.badge > 0 && (
                <span className="absolute right-4 top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background">{t.badge}</span>
              )}
            </span>
          );
          return (
            <li key={t.id} className="contents">
              {t.href
                ? <a href={t.href} aria-current={active ? "page" : undefined}>{inner}</a>
                : <button type="button" onClick={() => onSelect?.(t.id)} aria-current={active ? "page" : undefined}>{inner}</button>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
`;

// ============================================================================
// FEED CARD — social feed item.
// ============================================================================
const FEED_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FeedCardProps {
  author: string;
  authorAvatar?: string;
  handle?: string;
  date?: string;
  body: string;
  image?: string;
  likes?: number;
  comments?: number;
  liked?: boolean;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  className?: string;
}

export function FeedCard({ author, authorAvatar, handle, date, body, image, likes = 0, comments = 0, liked, onLike, onComment, onShare, className }: FeedCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="space-y-3 p-4">
        <header className="flex items-center gap-3">
          <Avatar className="h-9 w-9"><AvatarImage src={authorAvatar} alt={author} /><AvatarFallback>{author.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{author} {handle && <span className="font-normal text-muted-foreground">{handle}</span>}</div>
            {date && <div className="text-xs text-muted-foreground">{date}</div>}
          </div>
        </header>
        <p className="whitespace-pre-wrap text-sm text-foreground/90">{body}</p>
        {image && <img src={image} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-md object-cover" />}
        <footer className="flex items-center gap-4 pt-1 text-sm text-muted-foreground">
          <button type="button" onClick={onLike} className={cn("inline-flex items-center gap-1.5 hover:text-foreground", liked && "text-foreground")} aria-pressed={!!liked}>
            <Heart className={cn("h-4 w-4", liked && "fill-current")} aria-hidden /><span className="tabular-nums">{likes}</span>
          </button>
          <button type="button" onClick={onComment} className="inline-flex items-center gap-1.5 hover:text-foreground"><MessageCircle className="h-4 w-4" aria-hidden /><span className="tabular-nums">{comments}</span></button>
          <button type="button" onClick={onShare} className="inline-flex items-center gap-1.5 hover:text-foreground"><Share2 className="h-4 w-4" aria-hidden />Share</button>
        </footer>
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// PROFILE HEADER — mobile-social, alumni, link-in-bio.
// ============================================================================
const PROFILE_HEADER = `import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ProfileHeaderProps {
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string;
  coverUrl?: string;
  stats?: { label: string; value: string | number }[];
  primaryAction?: { label: string; onClick?: () => void };
  className?: string;
}

export function ProfileHeader({ name, handle, bio, avatarUrl, coverUrl, stats, primaryAction, className }: ProfileHeaderProps) {
  return (
    <header className={cn("overflow-hidden rounded-md border bg-card", className)}>
      <div className="aspect-[5/1] w-full bg-muted" style={coverUrl ? { backgroundImage: \`url(\${coverUrl})\`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} aria-hidden />
      <div className="-mt-10 flex flex-col items-center gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-5 sm:pb-5">
        <Avatar className="h-20 w-20 border-4 border-background"><AvatarImage src={avatarUrl} alt={name} /><AvatarFallback className="text-lg">{name.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
        <div className="flex-1 text-center sm:text-left">
          <h1 className="text-xl font-semibold text-foreground">{name}</h1>
          {handle && <div className="text-sm text-muted-foreground">{handle}</div>}
          {bio && <p className="mt-1 max-w-prose text-sm text-foreground/90">{bio}</p>}
        </div>
        {primaryAction && <Button onClick={primaryAction.onClick}>{primaryAction.label}</Button>}
      </div>
      {stats && stats.length > 0 && (
        <dl className="grid grid-cols-3 border-t text-center sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="border-r p-3 last:border-r-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</dt>
              <dd className="text-lg font-semibold text-foreground">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
`;

// ============================================================================
// LINK BUTTON + SOCIAL ROW — link-in-bio.
// ============================================================================
const LINK_BUTTON = `import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

export interface LinkButtonProps {
  href: string;
  label: string;
  Icon?: LucideIcon;
  description?: string;
  external?: boolean;
  className?: string;
}

export function LinkButton({ href, label, Icon, description, external, className }: LinkButtonProps) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
      className={cn("group flex w-full items-center justify-between rounded-xl border bg-card px-4 py-4 text-left transition-colors hover:border-foreground/40 hover:bg-accent/50", className)}
    >
      <span className="flex min-w-0 items-center gap-3">
        {Icon && <Icon className="h-5 w-5 text-foreground" aria-hidden />}
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground">{label}</span>
          {description && <span className="block truncate text-sm text-muted-foreground">{description}</span>}
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
    </a>
  );
}
`;

const SOCIAL_ROW = `import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface SocialLink { platform: string; href: string; Icon: LucideIcon }
export interface SocialRowProps { links: SocialLink[]; className?: string }

export function SocialRow({ links, className }: SocialRowProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {links.map((l) => (
        <a key={l.platform} href={l.href} target="_blank" rel="noreferrer noopener" aria-label={l.platform} className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-card text-foreground transition-colors hover:bg-accent">
          <l.Icon className="h-4 w-4" aria-hidden />
        </a>
      ))}
    </div>
  );
}
`;

// ============================================================================
// COURSE CARD + LESSON PLAYER — learning-platform / video-learning.
// ============================================================================
const COURSE_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface CourseCardProps {
  title: string;
  instructor?: string;
  cover?: string;
  level?: "Beginner" | "Intermediate" | "Advanced";
  lessons?: number;
  durationLabel?: string;
  progressPercent?: number;
  href?: string;
  className?: string;
}

export function CourseCard({ title, instructor, cover, level, lessons, durationLabel, progressPercent, href = "#", className }: CourseCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {cover && <a href={href}><img src={cover} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" /></a>}
      <CardContent className="space-y-2 p-4">
        {level && <Badge variant="secondary">{level}</Badge>}
        <a href={href} className="block"><h3 className="line-clamp-2 font-semibold text-foreground hover:underline">{title}</h3></a>
        {instructor && <div className="text-sm text-muted-foreground">{instructor}</div>}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {lessons != null && <span>{lessons} lessons</span>}
          {durationLabel && <span>· {durationLabel}</span>}
        </div>
        {progressPercent != null && (
          <div className="space-y-1 pt-1">
            <Progress value={progressPercent} />
            <div className="text-xs text-muted-foreground">{progressPercent}% complete</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
`;

const LESSON_PLAYER = `import * as React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Lesson { id: string; title: string; durationLabel?: string }
export interface LessonPlayerProps {
  videoSrc?: string;
  poster?: string;
  currentLessonId: string;
  lessons: Lesson[];
  onSelect?: (id: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

export function LessonPlayer({ videoSrc, poster, currentLessonId, lessons, onSelect, onPrev, onNext, className }: LessonPlayerProps) {
  const current = lessons.find((l) => l.id === currentLessonId);
  return (
    <div className={cn("grid gap-4 lg:grid-cols-[1fr_320px]", className)}>
      <div className="space-y-3">
        <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
          {videoSrc ? <video src={videoSrc} poster={poster} controls className="h-full w-full" /> : <div className="grid h-full place-items-center text-sm text-muted-foreground">No video</div>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={onPrev}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden />Prev</Button>
          <h2 className="line-clamp-1 text-base font-semibold text-foreground">{current?.title}</h2>
          <Button variant="outline" size="sm" onClick={onNext}>Next<ChevronRight className="ml-1 h-4 w-4" aria-hidden /></Button>
        </div>
      </div>
      <aside className="rounded-md border">
        <header className="border-b p-3 text-sm font-medium text-foreground">Curriculum</header>
        <ol className="divide-y">
          {lessons.map((l, i) => {
            const active = l.id === currentLessonId;
            return (
              <li key={l.id}>
                <button type="button" onClick={() => onSelect?.(l.id)} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent", active && "bg-accent text-foreground")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs">{i + 1}</span>
                    <span className="truncate">{l.title}</span>
                  </span>
                  {l.durationLabel && <span className="text-xs text-muted-foreground">{l.durationLabel}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
`;

// ============================================================================
// CHAT STREAM + MESSAGE BUBBLE + PROMPT CARD — ai-chat-app.
// ============================================================================
const MESSAGE_BUBBLE = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface MessageBubbleProps { role: "user" | "assistant" | "system"; children: React.ReactNode; className?: string }

export function MessageBubble({ role, children, className }: MessageBubbleProps) {
  const isUser = role === "user";
  const isSystem = role === "system";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start", className)}>
      <div className={cn(
        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
        isUser ? "bg-primary text-primary-foreground" : isSystem ? "bg-muted/60 text-muted-foreground italic" : "bg-muted text-foreground",
      )}>
        {children}
      </div>
    </div>
  );
}
`;

const CHAT_STREAM = `import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "./message-bubble";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage { id: string; role: "user" | "assistant" | "system"; content: string }
export interface ChatStreamProps {
  messages: ChatMessage[];
  onSend?: (text: string) => void | Promise<void>;
  busy?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatStream({ messages, onSend, busy, placeholder = "Send a message…", className }: ChatStreamProps) {
  const [text, setText] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  async function submit(e: React.FormEvent) { e.preventDefault(); if (!text.trim()) return; const v = text; setText(""); await onSend?.(v); }
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => <MessageBubble key={m.id} role={m.role}>{m.content}</MessageBubble>)}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={1} className="min-h-[40px] resize-none" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }} />
          <Button type="submit" disabled={busy || !text.trim()} size="icon" aria-label="Send"><Send className="h-4 w-4" /></Button>
        </div>
      </form>
    </div>
  );
}
`;

const PROMPT_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

export interface PromptCardProps { title: string; prompt: string; onUse?: (prompt: string) => void; className?: string }

export function PromptCard({ title, prompt, onUse, className }: PromptCardProps) {
  return (
    <button type="button" onClick={() => onUse?.(prompt)} className={cn("text-left", className)}>
      <Card className="h-full transition-colors hover:border-foreground/40">
        <CardContent className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Sparkles className="h-3.5 w-3.5" aria-hidden />Prompt</div>
          <div className="font-medium text-foreground">{title}</div>
          <p className="line-clamp-3 text-sm text-muted-foreground">{prompt}</p>
        </CardContent>
      </Card>
    </button>
  );
}
`;

// ============================================================================
// EVENT CARD — event-booking, ticketing, alumni events.
// ============================================================================
const EVENT_CARD = `import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EventCardProps {
  title: string;
  date: string;
  venue?: string;
  city?: string;
  cover?: string;
  priceLabel?: string;
  status?: "On sale" | "Sold out" | "Few left";
  href?: string;
  className?: string;
}

export function EventCard({ title, date, venue, city, cover, priceLabel, status, href = "#", className }: EventCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {cover && <a href={href}><img src={cover} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" /></a>}
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <a href={href} className="block min-w-0"><h3 className="line-clamp-2 font-semibold text-foreground hover:underline">{title}</h3></a>
          {status && <Badge variant={status === "Sold out" ? "outline" : "secondary"}>{status}</Badge>}
        </div>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4" aria-hidden />{date}</span>
          {(venue || city) && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />{[venue, city].filter(Boolean).join(", ")}</span>}
        </div>
        {priceLabel && <div className="pt-1 text-sm font-medium text-foreground">{priceLabel}</div>}
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// TEAM GRID — agency, salon, political.
// ============================================================================
const TEAM_GRID = `import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface TeamMember { name: string; role?: string; avatarUrl?: string; bio?: string }
export interface TeamGridProps { title?: string; members: TeamMember[]; columns?: 2|3|4; className?: string }

export function TeamGrid({ title, members, columns = 3, className }: TeamGridProps) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <section className={cn("py-12", className)}>
      <div className="mx-auto max-w-6xl px-4">
        {title && <h2 className="mb-8 text-3xl font-semibold tracking-tight text-foreground">{title}</h2>}
        <ul className={cn("grid grid-cols-1 gap-6", cols)}>
          {members.map((m) => (
            <li key={m.name} className="flex flex-col items-center text-center">
              <Avatar className="h-20 w-20"><AvatarImage src={m.avatarUrl} alt={m.name} /><AvatarFallback className="text-lg">{m.name.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
              <div className="mt-3 font-medium text-foreground">{m.name}</div>
              {m.role && <div className="text-sm text-muted-foreground">{m.role}</div>}
              {m.bio && <p className="mt-2 text-sm text-muted-foreground">{m.bio}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
`;

// ============================================================================
// WORK GRID + CASE STUDY — portfolio, agency.
// ============================================================================
const WORK_GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface WorkItem { title: string; client?: string; tag?: string; cover: string; href?: string }
export interface WorkGridProps { items: WorkItem[]; columns?: 2|3; className?: string }

export function WorkGrid({ items, columns = 2, className }: WorkGridProps) {
  const cols = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return (
    <ul className={cn("grid grid-cols-1 gap-4", cols, className)}>
      {items.map((it) => (
        <li key={it.title}>
          <a href={it.href ?? "#"} className="group block overflow-hidden rounded-md bg-muted">
            <div className="relative">
              <img src={it.cover} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 text-white">
                {it.tag && <div className="text-xs uppercase tracking-wide opacity-80">{it.tag}</div>}
                <div className="text-lg font-semibold">{it.title}</div>
                {it.client && <div className="text-sm opacity-90">{it.client}</div>}
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
`;

const CASE_STUDY = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface CaseStudySection { heading: string; body: string }
export interface CaseStudyProps {
  title: string;
  client?: string;
  year?: string;
  hero?: string;
  summary?: string;
  meta?: { label: string; value: string }[];
  sections: CaseStudySection[];
  gallery?: string[];
  className?: string;
}

export function CaseStudy({ title, client, year, hero, summary, meta, sections, gallery, className }: CaseStudyProps) {
  return (
    <article className={cn("mx-auto max-w-3xl px-4 py-12", className)}>
      <header className="mb-8">
        {client && <div className="text-sm uppercase tracking-wide text-muted-foreground">{client}{year && \` · \${year}\`}</div>}
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-foreground">{title}</h1>
        {summary && <p className="mt-4 text-lg text-muted-foreground">{summary}</p>}
      </header>
      {hero && <img src={hero} alt="" className="mb-8 aspect-[16/9] w-full rounded-md object-cover" />}
      {meta && meta.length > 0 && (
        <dl className="mb-10 grid grid-cols-2 gap-6 border-y py-6 sm:grid-cols-4">
          {meta.map((m) => (
            <div key={m.label}><dt className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</dt><dd className="mt-1 font-medium text-foreground">{m.value}</dd></div>
          ))}
        </dl>
      )}
      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-xl font-semibold text-foreground">{s.heading}</h2>
            <p className="mt-2 whitespace-pre-wrap text-foreground/90">{s.body}</p>
          </section>
        ))}
      </div>
      {gallery && gallery.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {gallery.map((src, i) => <img key={i} src={src} alt="" loading="lazy" className="aspect-[4/3] w-full rounded object-cover" />)}
        </div>
      )}
    </article>
  );
}
`;

// ============================================================================
// DONATE FORM — nonprofit, fundraising, civic-petition, political.
// ============================================================================
const DONATE_FORM = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DonateFormValues { amount: number; frequency: "one-time" | "monthly"; name: string; email: string }
export interface DonateFormProps {
  presetAmounts?: number[];
  currencyLabel?: string;
  onSubmit?: (v: DonateFormValues) => void | Promise<void>;
  className?: string;
}

export function DonateForm({ presetAmounts = [10, 25, 50, 100], currencyLabel = "$", onSubmit, className }: DonateFormProps) {
  const [amount, setAmount] = React.useState<number>(presetAmounts[1] ?? 25);
  const [frequency, setFrequency] = React.useState<"one-time" | "monthly">("one-time");
  const [name, setName] = React.useState(""); const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); try { await onSubmit?.({ amount, frequency, name, email }); } finally { setBusy(false); } }
  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader><CardTitle>Make a donation</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="inline-flex w-full overflow-hidden rounded-md border">
            <button type="button" onClick={() => setFrequency("one-time")} className={cn("flex-1 px-3 py-2 text-sm", frequency === "one-time" ? "bg-foreground text-background" : "bg-background text-foreground")}>One-time</button>
            <button type="button" onClick={() => setFrequency("monthly")} className={cn("flex-1 px-3 py-2 text-sm", frequency === "monthly" ? "bg-foreground text-background" : "bg-background text-foreground")}>Monthly</button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {presetAmounts.map((p) => (
              <button key={p} type="button" onClick={() => setAmount(p)} className={cn("rounded-md border py-2 text-sm font-medium", amount === p ? "border-foreground bg-foreground text-background" : "bg-background text-foreground")}>{currencyLabel}{p}</button>
            ))}
          </div>
          <div className="grid gap-2"><Label htmlFor="df-amt">Custom amount</Label><Input id="df-amt" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></div>
          <div className="grid gap-2"><Label htmlFor="df-name">Name</Label><Input id="df-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="df-email">Email</Label><Input id="df-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button type="submit" disabled={busy}>{busy ? "Processing…" : \`Donate \${currencyLabel}\${amount} \${frequency === "monthly" ? "/ month" : ""}\`}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// ORDER CONFIRMATION — ecommerce, event-booking, booking-appointments.
// ============================================================================
const ORDER_CONFIRMATION = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface OrderLine { label: string; value: string }
export interface OrderConfirmationProps {
  title?: string;
  message?: string;
  orderId?: string;
  email?: string;
  lines?: OrderLine[];
  total?: { label: string; value: string };
  className?: string;
}

export function OrderConfirmation({ title = "Order confirmed", message = "Thanks — a receipt is on its way.", orderId, email, lines, total, className }: OrderConfirmationProps) {
  return (
    <Card className={cn("mx-auto w-full max-w-lg", className)}>
      <CardHeader className="items-center text-center">
        <CheckCircle2 className="mb-2 h-10 w-10 text-foreground" aria-hidden />
        <CardTitle className="text-2xl">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {(orderId || email) && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {orderId && (<><dt className="text-muted-foreground">Order ID</dt><dd className="text-right font-medium text-foreground">{orderId}</dd></>)}
            {email && (<><dt className="text-muted-foreground">Email</dt><dd className="text-right text-foreground">{email}</dd></>)}
          </dl>
        )}
        {lines && lines.length > 0 && (
          <>
            <Separator />
            <dl className="space-y-2 text-sm">
              {lines.map((l) => (
                <div key={l.label} className="flex justify-between"><dt className="text-muted-foreground">{l.label}</dt><dd className="text-foreground">{l.value}</dd></div>
              ))}
            </dl>
          </>
        )}
        {total && (<><Separator /><div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">{total.label}</span><span className="text-xl font-semibold text-foreground">{total.value}</span></div></>)}
      </CardContent>
    </Card>
  );
}
`;

// ============================================================================
// MAP / SEAT-MAP PLACEHOLDERS — real-estate, fleet, ticketing.
// ============================================================================
const MAP_PLACEHOLDER = `import * as React from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MapPlaceholderProps { label?: string; aspect?: "video" | "square" | "wide"; className?: string }

export function MapPlaceholder({ label = "Map preview", aspect = "video", className }: MapPlaceholderProps) {
  const ar = aspect === "square" ? "aspect-square" : aspect === "wide" ? "aspect-[21/9]" : "aspect-video";
  return (
    <div className={cn("relative w-full overflow-hidden rounded-md border bg-muted/40", ar, className)} role="img" aria-label={label}>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <MapPin className="h-6 w-6" aria-hidden />
          <span className="text-sm">{label}</span>
        </div>
      </div>
      <svg className="absolute inset-0 h-full w-full opacity-30" aria-hidden>
        <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.5" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>
  );
}
`;

const SEAT_MAP_PLACEHOLDER = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface SeatMapPlaceholderProps { rows?: number; cols?: number; takenIds?: string[]; selectedIds?: string[]; onToggle?: (id: string) => void; className?: string }

export function SeatMapPlaceholder({ rows = 8, cols = 12, takenIds = [], selectedIds = [], onToggle, className }: SeatMapPlaceholderProps) {
  const taken = new Set(takenIds); const sel = new Set(selectedIds);
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="h-1 w-3/4 rounded-full bg-foreground/60" aria-hidden />
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Stage</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: \`repeat(\${cols}, minmax(0, 1fr))\` }}>
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const id = \`\${String.fromCharCode(65 + r)}\${c + 1}\`;
            const isTaken = taken.has(id); const isSel = sel.has(id);
            return (
              <button key={id} type="button" disabled={isTaken} onClick={() => onToggle?.(id)} aria-label={\`Seat \${id}\${isTaken ? " (taken)" : ""}\`}
                className={cn("h-5 w-5 rounded-sm border text-[8px] font-medium transition-colors",
                  isTaken ? "cursor-not-allowed border-transparent bg-muted text-muted-foreground"
                  : isSel ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background hover:bg-accent")}>
              </button>
            );
          })
        )}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border bg-background" /> Available</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-foreground" /> Selected</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-muted" /> Taken</span>
      </div>
    </div>
  );
}
`;

// ============================================================================
// HABIT HEATMAP — habit-tracker.
// ============================================================================
const HEATMAP_CALENDAR = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface HeatmapCell { date: string; level: 0 | 1 | 2 | 3 | 4 }
export interface HeatmapCalendarProps { cells: HeatmapCell[]; weeks?: number; label?: string; className?: string }

export function HeatmapCalendar({ cells, weeks = 26, label = "Activity", className }: HeatmapCalendarProps) {
  const map = new Map(cells.map((c) => [c.date, c.level]));
  const today = new Date();
  const grid: { date: string; level: 0|1|2|3|4 }[][] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const col: { date: string; level: 0|1|2|3|4 }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - (w * 7 + (6 - d)));
      const key = date.toISOString().slice(0, 10);
      col.push({ date: key, level: (map.get(key) ?? 0) as 0|1|2|3|4 });
    }
    grid.push(col);
  }
  const tone = ["bg-muted", "bg-foreground/20", "bg-foreground/40", "bg-foreground/65", "bg-foreground"];
  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex gap-1 overflow-x-auto" role="img" aria-label={\`\${label} heatmap\`}>
        {grid.map((col, i) => (
          <div key={i} className="flex flex-col gap-1">
            {col.map((c) => <div key={c.date} className={cn("h-3 w-3 rounded-[2px]", tone[c.level])} title={\`\${c.date} · level \${c.level}\`} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
`;

// ============================================================================
// PRICE TICKER — trading-dashboard-demo, crypto-wallet-demo.
// ============================================================================
const PRICE_TICKER = `import * as React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PriceTickerItem { symbol: string; price: string; changePercent: number }
export interface PriceTickerProps { items: PriceTickerItem[]; className?: string }

export function PriceTicker({ items, className }: PriceTickerProps) {
  return (
    <div className={cn("w-full overflow-hidden border-y bg-muted/40", className)} role="marquee">
      <div className="flex animate-[marquee_30s_linear_infinite] gap-8 whitespace-nowrap py-2 text-sm">
        {[...items, ...items].map((it, i) => {
          const up = it.changePercent >= 0;
          return (
            <span key={i} className="inline-flex items-center gap-2">
              <span className="font-medium text-foreground">{it.symbol}</span>
              <span className="tabular-nums text-foreground">{it.price}</span>
              <span className={cn("inline-flex items-center gap-0.5 tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {up ? "+" : ""}{it.changePercent.toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
      <style>{\`@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }\`}</style>
    </div>
  );
}
`;

// ============================================================================
// REGISTRY
// ============================================================================
export const KIT_BLOCK_FILES_4: KitFile[] = [
  { path: "src/components/blocks/demo-banner.tsx", content: DEMO_BANNER, overwrite: true },
  { path: "src/components/blocks/service-card.tsx", content: SERVICE_CARD, overwrite: true },
  { path: "src/components/blocks/menu-section.tsx", content: MENU_SECTION, overwrite: true },
  { path: "src/components/blocks/gallery-grid.tsx", content: GALLERY_GRID, overwrite: true },
  { path: "src/components/blocks/category-grid.tsx", content: CATEGORY_GRID, overwrite: true },
  { path: "src/components/blocks/article-card.tsx", content: ARTICLE_CARD, overwrite: true },
  { path: "src/components/blocks/author-card.tsx", content: AUTHOR_CARD, overwrite: true },
  { path: "src/components/blocks/episode-card.tsx", content: EPISODE_CARD, overwrite: true },
  { path: "src/components/blocks/audio-player.tsx", content: AUDIO_PLAYER, overwrite: true },
  { path: "src/components/blocks/booking-form.tsx", content: BOOKING_FORM, overwrite: true },
  { path: "src/components/blocks/kanban-board.tsx", content: KANBAN_BOARD, overwrite: true },
  { path: "src/components/blocks/contact-card.tsx", content: CONTACT_CARD, overwrite: true },
  { path: "src/components/blocks/thread-card.tsx", content: THREAD_CARD, overwrite: true },
  { path: "src/components/blocks/reply-list.tsx", content: REPLY_LIST, overwrite: true },
  { path: "src/components/blocks/compose-sheet.tsx", content: COMPOSE_SHEET, overwrite: true },
  { path: "src/components/blocks/mobile-nav.tsx", content: MOBILE_NAV, overwrite: true },
  { path: "src/components/blocks/feed-card.tsx", content: FEED_CARD, overwrite: true },
  { path: "src/components/blocks/profile-header.tsx", content: PROFILE_HEADER, overwrite: true },
  { path: "src/components/blocks/link-button.tsx", content: LINK_BUTTON, overwrite: true },
  { path: "src/components/blocks/social-row.tsx", content: SOCIAL_ROW, overwrite: true },
  { path: "src/components/blocks/course-card.tsx", content: COURSE_CARD, overwrite: true },
  { path: "src/components/blocks/lesson-player.tsx", content: LESSON_PLAYER, overwrite: true },
  { path: "src/components/blocks/message-bubble.tsx", content: MESSAGE_BUBBLE, overwrite: true },
  { path: "src/components/blocks/chat-stream.tsx", content: CHAT_STREAM, overwrite: true },
  { path: "src/components/blocks/prompt-card.tsx", content: PROMPT_CARD, overwrite: true },
  { path: "src/components/blocks/event-card.tsx", content: EVENT_CARD, overwrite: true },
  { path: "src/components/blocks/team-grid.tsx", content: TEAM_GRID, overwrite: true },
  { path: "src/components/blocks/work-grid.tsx", content: WORK_GRID, overwrite: true },
  { path: "src/components/blocks/case-study.tsx", content: CASE_STUDY, overwrite: true },
  { path: "src/components/blocks/donate-form.tsx", content: DONATE_FORM, overwrite: true },
  { path: "src/components/blocks/order-confirmation.tsx", content: ORDER_CONFIRMATION, overwrite: true },
  { path: "src/components/blocks/map-placeholder.tsx", content: MAP_PLACEHOLDER, overwrite: true },
  { path: "src/components/blocks/seat-map-placeholder.tsx", content: SEAT_MAP_PLACEHOLDER, overwrite: true },
  { path: "src/components/blocks/heatmap-calendar.tsx", content: HEATMAP_CALENDAR, overwrite: true },
  { path: "src/components/blocks/price-ticker.tsx", content: PRICE_TICKER, overwrite: true },
];
