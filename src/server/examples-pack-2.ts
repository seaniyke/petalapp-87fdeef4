/**
 * Examples Pack — Volume 2.
 *
 * New domain references covering the archetype verticals added in the
 * 500-system expansion (mobile shells, kanban, telehealth-demo, music
 * streaming-demo, directory/listings, job board, IoT, education, social,
 * AI productivity, civic/donation, calendar/booking, content/media).
 *
 * Same rules as examples-pack.ts:
 *  - Self-contained, ≤200 lines, default export, one screen per file
 *  - Semantic tokens only (no raw hex / Tailwind colour names)
 *  - Light + dark friendly
 *  - No data fetching, no router — presentational refs only
 *  - Demo-only domains include a visible "Demo" notice
 */
import type { ProjectFile } from "./generate.server";

/* ============================== KANBAN ============================== */
const KANBAN_BOARD_PAGE = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const COLUMNS = [
  { key: "todo", title: "To do", items: ["Draft proposal", "Sync with design", "Triage bug #214"] },
  { key: "doing", title: "In progress", items: ["Onboarding empty state", "Billing webhook retries"] },
  { key: "review", title: "In review", items: ["Mobile nav polish"] },
  { key: "done", title: "Done", items: ["Logo refresh", "Pricing v3"] },
];

export default function KanbanBoardPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Roadmap</h1>
          <p className="text-sm text-muted-foreground">12 active tasks · 4 columns</p>
        </div>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />New task</Button>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <section key={col.key} className="rounded-xl border bg-muted/30 p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-medium">{col.title}</h2>
              <Badge variant="secondary">{col.items.length}</Badge>
            </div>
            <div className="space-y-2">
              {col.items.map((t) => (
                <Card key={t} className="border-border/60">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t}</CardTitle></CardHeader>
                  <CardContent className="flex items-center justify-between pt-0 text-xs text-muted-foreground">
                    <span>PETAL-{Math.floor(Math.random() * 900) + 100}</span>
                    <Badge variant="outline">M</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
`;

/* ============================== MOBILE SHELLS ============================== */
const MOBILE_TABBAR_SHELL = `import { Home, Search, Bell, User } from "lucide-react";
import { useState } from "react";

const TABS = [
  { key: "home", icon: Home, label: "Home" },
  { key: "search", icon: Search, label: "Search" },
  { key: "alerts", icon: Bell, label: "Alerts" },
  { key: "me", icon: User, label: "You" },
];

export default function MobileTabbarShell() {
  const [active, setActive] = useState("home");
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-semibold capitalize">{active}</h1>
      </header>
      <main className="flex-1 space-y-3 overflow-auto p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">Item {i + 1}</p>
            <p className="text-xs text-muted-foreground">Sample content for {active}</p>
          </div>
        ))}
      </main>
      <nav className="sticky bottom-0 grid grid-cols-4 border-t bg-background/95 backdrop-blur">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={\`flex flex-col items-center gap-1 py-2 text-xs \${isActive ? "text-primary" : "text-muted-foreground"}\`}
            >
              <Icon className="h-5 w-5" />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
`;

const MOBILE_FEED_CARD = `import { Heart, MessageCircle, Share2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export default function MobileFeedCard() {
  return (
    <article className="mx-auto max-w-sm space-y-2 border-b bg-card p-4">
      <header className="flex items-center gap-3">
        <Avatar className="h-9 w-9"><AvatarFallback>JD</AvatarFallback></Avatar>
        <div className="flex-1">
          <p className="text-sm font-medium">Jamie Doe</p>
          <p className="text-xs text-muted-foreground">2h ago</p>
        </div>
      </header>
      <p className="text-sm">Shipping the new mobile shell today. Tabs feel native, transitions are smooth.</p>
      <div className="aspect-[4/3] w-full rounded-lg bg-gradient-to-br from-primary/20 to-muted" />
      <footer className="flex items-center gap-1 pt-1">
        <Button variant="ghost" size="sm"><Heart className="mr-1 h-4 w-4" />128</Button>
        <Button variant="ghost" size="sm"><MessageCircle className="mr-1 h-4 w-4" />24</Button>
        <Button variant="ghost" size="sm"><Share2 className="mr-1 h-4 w-4" />Share</Button>
      </footer>
    </article>
  );
}
`;

/* ============================== TELEHEALTH DEMO ============================== */
const TELEHEALTH_DEMO_CONSULT = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Video, Phone, Calendar } from "lucide-react";

/**
 * DEMO ONLY. No real video, no real PHI, no real provider lookup.
 * Replace placeholder data before production. Compliance (HIPAA, GDPR
 * for health) requires a regulated backend; do NOT ship this as-is.
 */
export default function TelehealthDemoConsult() {
  return (
    <div className="min-h-screen bg-background p-6">
      <Badge variant="destructive" className="mb-4">Demo · not for clinical use</Badge>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Upcoming consult</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="aspect-video w-full rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
              Video preview placeholder
            </div>
            <div className="flex gap-2">
              <Button><Video className="mr-2 h-4 w-4" />Join video</Button>
              <Button variant="outline"><Phone className="mr-2 h-4 w-4" />Audio only</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Dr. Asha Patel</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">General practice · 8 yrs</p>
            <p className="flex items-center gap-2"><Calendar className="h-4 w-4" />Today · 4:30 PM</p>
            <p className="text-xs text-muted-foreground pt-2">Sample data only.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
`;

/* ============================== MUSIC STREAMING DEMO ============================== */
const MUSIC_PLAYER_DEMO = `import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

/**
 * DEMO ONLY. No real audio streaming, no licensed catalog. Use as a
 * UI shell; integrate a licensed provider before shipping.
 */
export default function MusicPlayerDemo() {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState([42]);
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40 p-6">
      <Badge variant="secondary" className="mb-4">Demo · sample tracks</Badge>
      <div className="mx-auto max-w-md space-y-6">
        <div className="aspect-square rounded-2xl bg-gradient-to-br from-primary/40 to-primary/10 shadow-xl" />
        <div className="text-center">
          <p className="text-lg font-semibold">Midnight Drive</p>
          <p className="text-sm text-muted-foreground">Indie demo artist</p>
        </div>
        <Slider value={pos} onValueChange={setPos} max={100} step={1} />
        <div className="flex items-center justify-center gap-4">
          <Button variant="ghost" size="icon"><SkipBack className="h-5 w-5" /></Button>
          <Button size="icon" className="h-14 w-14 rounded-full" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </Button>
          <Button variant="ghost" size="icon"><SkipForward className="h-5 w-5" /></Button>
        </div>
      </div>
    </div>
  );
}
`;

/* ============================== DIRECTORY / LISTINGS ============================== */
const DIRECTORY_LISTING_GRID = `import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star } from "lucide-react";

const PLACES = [
  { name: "Kettle & Crumb", category: "Café", rating: 4.8, area: "Downtown" },
  { name: "North Light Studio", category: "Photography", rating: 4.9, area: "Old Town" },
  { name: "Ironwood Gym", category: "Fitness", rating: 4.6, area: "Westside" },
  { name: "Folio Bookshop", category: "Bookstore", rating: 4.7, area: "Riverbank" },
  { name: "Saffron Kitchen", category: "Restaurant", rating: 4.5, area: "Midtown" },
  { name: "Bloom Florist", category: "Florist", rating: 4.9, area: "Eastside" },
];

export default function DirectoryListingGrid() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Local directory</h1>
        <p className="text-sm text-muted-foreground">Hand-picked spots in your city</p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLACES.map((p) => (
          <Card key={p.name} className="overflow-hidden">
            <div className="aspect-[5/3] w-full bg-gradient-to-br from-muted to-muted/40" />
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium leading-tight">{p.name}</h3>
                <Badge variant="secondary">{p.category}</Badge>
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />{p.area}
              </p>
              <p className="flex items-center gap-1 text-xs"><Star className="h-3.5 w-3.5 fill-current" />{p.rating}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
`;

/* ============================== JOB BOARD ============================== */
const JOB_BOARD_LIST = `import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Briefcase, MapPin } from "lucide-react";

const JOBS = [
  { title: "Senior Product Designer", company: "Aurora Labs", loc: "Remote · EU", type: "Full-time", pay: "€80–110k" },
  { title: "Backend Engineer", company: "Folio", loc: "Berlin", type: "Full-time", pay: "€75–95k" },
  { title: "Customer Success Lead", company: "Kettle", loc: "Remote", type: "Full-time", pay: "$70–90k" },
  { title: "Content Strategist", company: "Ironwood", loc: "London", type: "Contract", pay: "£500/day" },
];

export default function JobBoardList() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Open roles</h1>
          <p className="text-sm text-muted-foreground">{JOBS.length} hiring teams</p>
        </div>
        <Button variant="outline" size="sm">Post a role</Button>
      </header>
      <div className="space-y-3">
        {JOBS.map((j) => (
          <Card key={j.title}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h3 className="font-medium">{j.title}</h3>
                <p className="text-sm text-muted-foreground">{j.company}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary"><Briefcase className="mr-1 h-3 w-3" />{j.type}</Badge>
                <Badge variant="outline"><MapPin className="mr-1 h-3 w-3" />{j.loc}</Badge>
                <Badge>{j.pay}</Badge>
              </div>
              <Button size="sm">Apply</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
`;

/* ============================== IOT DASHBOARD ============================== */
const IOT_DEVICE_DASHBOARD = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wifi, Thermometer, Droplets, Activity } from "lucide-react";

const DEVICES = [
  { name: "Living room sensor", status: "online", temp: 21.4, humidity: 47 },
  { name: "Garage gateway", status: "online", temp: 14.1, humidity: 62 },
  { name: "Greenhouse probe", status: "offline", temp: null, humidity: null },
];

export default function IoTDeviceDashboard() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Devices</h1>
        <p className="text-sm text-muted-foreground">Live telemetry · last sync 12s ago</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEVICES.map((d) => (
          <Card key={d.name}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">{d.name}</CardTitle>
              <Badge variant={d.status === "online" ? "default" : "destructive"}>
                <Wifi className="mr-1 h-3 w-3" />{d.status}
              </Badge>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-sm">
              <div className="flex flex-col items-center gap-1">
                <Thermometer className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{d.temp ?? "—"}°C</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Droplets className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{d.humidity ?? "—"}%</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{d.status === "online" ? "OK" : "—"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
`;

/* ============================== EDUCATION ============================== */
const COURSE_LESSON_PLAYER = `import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Play } from "lucide-react";

const LESSONS = [
  { title: "What is design tokens?", duration: "5:12", done: true },
  { title: "Color systems with oklch", duration: "8:40", done: true },
  { title: "Typography scales", duration: "6:21", done: false },
  { title: "Motion and easing", duration: "7:55", done: false },
];

export default function CourseLessonPlayer() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="aspect-video rounded-xl bg-muted flex items-center justify-center">
            <Button size="lg" className="rounded-full"><Play className="mr-2 h-4 w-4" />Play lesson</Button>
          </div>
          <h1 className="text-xl font-semibold">Typography scales</h1>
          <p className="text-sm text-muted-foreground">Lesson 3 of 4 · Design Foundations</p>
          <Progress value={50} />
        </div>
        <Card>
          <CardContent className="divide-y p-0">
            {LESSONS.map((l) => (
              <div key={l.title} className="flex items-center gap-3 p-3">
                {l.done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.title}</p>
                  <p className="text-xs text-muted-foreground">{l.duration}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
`;

/* ============================== AI CHAT PRODUCTIVITY ============================== */
const AI_CHAT_WORKBENCH = `import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Sparkles } from "lucide-react";

const TURNS = [
  { who: "user", text: "Summarize last week's customer interviews." },
  { who: "ai", text: "Top three themes: onboarding friction, slow first-build, and confusion about pricing tiers. Want me to draft a follow-up plan?" },
];

export default function AiChatWorkbench() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-6 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4 w-4 text-primary" />Workbench</h1>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6">
        {TURNS.map((t, i) => (
          <div key={i} className={\`flex gap-3 \${t.who === "user" ? "justify-end" : ""}\`}>
            {t.who === "ai" && <Avatar className="h-8 w-8"><AvatarFallback>AI</AvatarFallback></Avatar>}
            <Card className={\`max-w-[80%] p-3 text-sm \${t.who === "user" ? "bg-primary text-primary-foreground" : ""}\`}>
              {t.text}
            </Card>
          </div>
        ))}
      </main>
      <footer className="sticky bottom-0 border-t bg-background/90 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea placeholder="Ask anything…" className="min-h-[52px] resize-none" />
          <Button size="icon"><Send className="h-4 w-4" /></Button>
        </div>
      </footer>
    </div>
  );
}
`;

/* ============================== BOOKING / CALENDAR ============================== */
const BOOKING_TIMESLOTS = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const SLOTS = ["09:00", "09:30", "10:00", "11:00", "13:00", "14:30", "15:00", "16:30"];
const DAYS = ["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"];

export default function BookingTimeslots() {
  const [day, setDay] = useState(DAYS[0]);
  const [slot, setSlot] = useState<string | null>(null);
  return (
    <div className="min-h-screen bg-background p-6">
      <Card className="mx-auto max-w-2xl">
        <CardHeader><CardTitle>Book a session</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {DAYS.map((d) => (
              <Button key={d} variant={d === day ? "default" : "outline"} onClick={() => setDay(d)}>{d}</Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {SLOTS.map((s) => (
              <Button key={s} variant={s === slot ? "default" : "outline"} onClick={() => setSlot(s)}>{s}</Button>
            ))}
          </div>
          <Button className="w-full" disabled={!slot}>{slot ? \`Confirm \${day} at \${slot}\` : "Pick a time"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
`;

/* ============================== DONATION / CIVIC ============================== */
const DONATION_LANDING = `import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Heart } from "lucide-react";

export default function DonationLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-6">
      <Card className="mx-auto max-w-2xl overflow-hidden">
        <div className="aspect-[16/9] bg-gradient-to-br from-primary/40 to-primary/10" />
        <CardContent className="space-y-4 p-6">
          <h1 className="text-2xl font-semibold">Help rebuild the community library</h1>
          <p className="text-sm text-muted-foreground">A storm damaged our shelves and reading room. Every gift restores access for 1,200 weekly visitors.</p>
          <div className="space-y-1">
            <Progress value={64} />
            <div className="flex justify-between text-sm">
              <span className="font-medium">$32,140 raised</span>
              <span className="text-muted-foreground">of $50,000 goal</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[20, 50, 100].map((a) => <Button key={a} variant="outline">${a}</Button>)}
          </div>
          <Button className="w-full"><Heart className="mr-2 h-4 w-4" />Donate now</Button>
        </CardContent>
      </Card>
    </div>
  );
}
`;

/* ============================== REAL ESTATE / RENTAL ============================== */
const RENTAL_LISTING_DETAIL = `import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bed, Bath, Maximize, MapPin } from "lucide-react";

export default function RentalListingDetail() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-muted to-muted/40 sm:col-span-2 sm:row-span-2" />
          <div className="aspect-[4/3] rounded-lg bg-muted" />
          <div className="aspect-[4/3] rounded-lg bg-muted" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold">Bright loft near the canal</h1>
              <Badge variant="secondary">Available Aug 1</Badge>
            </div>
            <p className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-4 w-4" />Old Town · 5 min to metro</p>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1"><Bed className="h-4 w-4" />2 beds</span>
              <span className="flex items-center gap-1"><Bath className="h-4 w-4" />1 bath</span>
              <span className="flex items-center gap-1"><Maximize className="h-4 w-4" />78 m²</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">South-facing windows, restored wood floors, and a quiet courtyard. Pets welcome with deposit.</p>
          </div>
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-2xl font-semibold">$2,450<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <Button className="w-full">Request a tour</Button>
              <Button variant="outline" className="w-full">Message host</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
`;

/* ============================== LEGAL DEMO ============================== */
const LEGAL_CONTRACT_REVIEW_DEMO = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, AlertTriangle } from "lucide-react";

/**
 * DEMO ONLY. Not legal advice. Sample contract clauses and risk flags
 * are fabricated. Do not use for real contract review.
 */
export default function LegalContractReviewDemo() {
  return (
    <div className="min-h-screen bg-background p-6">
      <Badge variant="destructive" className="mb-4"><AlertTriangle className="mr-1 h-3 w-3" />Demo · not legal advice</Badge>
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <FileText className="h-4 w-4" />
            <CardTitle className="text-base">Master Services Agreement (sample)</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none text-sm leading-relaxed text-muted-foreground">
            <p><strong>1. Scope.</strong> Provider will deliver advisory services as described in each Statement of Work…</p>
            <p><strong>2. Liability.</strong> Each party's aggregate liability shall not exceed fees paid in the prior 12 months…</p>
            <p><strong>3. Termination.</strong> Either party may terminate for material breach with 30 days' notice…</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Risk flags (sample)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-md border-l-2 border-destructive bg-destructive/5 p-2">Unlimited indemnity in §4.2</div>
            <div className="rounded-md border-l-2 border-amber-500 bg-amber-500/5 p-2">Auto-renewal lacks opt-out window</div>
            <Button variant="outline" className="w-full">Export findings</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
`;

/* ============================== EVENT TICKETING ============================== */
const EVENT_TICKETING_PAGE = `import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin } from "lucide-react";

const TIERS = [
  { name: "General", price: 25, left: 142 },
  { name: "Reserved", price: 65, left: 24 },
  { name: "VIP", price: 180, left: 6 },
];

export default function EventTicketingPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="aspect-[16/9] rounded-xl bg-gradient-to-br from-primary/40 to-muted" />
        <header>
          <h1 className="text-2xl font-semibold">Northern Lights · Live in concert</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />Sat, Sep 14 · 8:00 PM</span>
            <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />The Old Hall</span>
          </p>
        </header>
        <div className="space-y-2">
          {TIERS.map((t) => (
            <Card key={t.name}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.left} left</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">${t.price}</Badge>
                  <Button size="sm">Buy</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
`;

/* ============================== POS / RESTAURANT ============================== */
const POS_ORDER_TICKET = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const ITEMS = [
  { name: "Latte", qty: 2, price: 4.5 },
  { name: "Croissant", qty: 1, price: 3.25 },
  { name: "Avocado toast", qty: 1, price: 9.0 },
];

export default function PosOrderTicket() {
  const subtotal = ITEMS.reduce((s, i) => s + i.qty * i.price, 0);
  const tax = +(subtotal * 0.08).toFixed(2);
  return (
    <div className="min-h-screen bg-background p-6">
      <Card className="mx-auto max-w-md">
        <CardHeader><CardTitle>Order #1024</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {ITEMS.map((i) => (
            <div key={i.name} className="flex items-center justify-between text-sm">
              <span>{i.qty}× {i.name}</span>
              <span className="tabular-nums">${(i.qty * i.price).toFixed(2)}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between text-sm text-muted-foreground"><span>Tax</span><span>${tax.toFixed(2)}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span>${(subtotal + tax).toFixed(2)}</span></div>
          <Button className="w-full">Charge ${(subtotal + tax).toFixed(2)}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
`;

/* ============================== CRM CONTACT ============================== */
const CRM_CONTACT_DETAIL = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, Phone, Building2 } from "lucide-react";

export default function CrmContactDetail() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Avatar className="h-20 w-20"><AvatarFallback>RM</AvatarFallback></Avatar>
            <div>
              <h2 className="font-semibold">Rosa Martínez</h2>
              <p className="text-sm text-muted-foreground">Head of Ops · Folio</p>
            </div>
            <Badge variant="secondary">Lead · Warm</Badge>
            <div className="grid w-full grid-cols-2 gap-2">
              <Button size="sm" variant="outline"><Mail className="mr-1 h-4 w-4" />Email</Button>
              <Button size="sm" variant="outline"><Phone className="mr-1 h-4 w-4" />Call</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><p className="font-medium">Demo scheduled</p><p className="text-xs text-muted-foreground">Tomorrow, 11:00 AM</p></div>
            <div><p className="font-medium">Sent pricing one-pager</p><p className="text-xs text-muted-foreground">2 days ago</p></div>
            <div className="flex items-center gap-2 pt-2 text-muted-foreground"><Building2 className="h-4 w-4" /> 42 employees · SaaS</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
`;

/* ============================== HELPDESK INBOX ============================== */
const HELPDESK_INBOX = `import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const TICKETS = [
  { subject: "Cannot reset password", who: "alex@acme.io", status: "open", age: "3m" },
  { subject: "Invoice missing PO number", who: "billing@northwind.com", status: "pending", age: "1h" },
  { subject: "Dark mode preference resets", who: "sam@folio.app", status: "open", age: "2h" },
  { subject: "Refund request", who: "kira@kettle.co", status: "resolved", age: "1d" },
];

const colors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "destructive", pending: "secondary", resolved: "outline",
};

export default function HelpdeskInbox() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">{TICKETS.length} tickets · 2 unassigned</p>
      </header>
      <Card>
        <CardContent className="divide-y p-0">
          {TICKETS.map((t) => (
            <div key={t.subject} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.subject}</p>
                <p className="truncate text-xs text-muted-foreground">{t.who}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={colors[t.status]}>{t.status}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">{t.age}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
`;

/* ============================== ANALYTICS REPORT ============================== */
const ANALYTICS_REPORT_PAGE = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

const KPIS = [
  { label: "Visitors", value: "12,409", delta: "+8.2%" },
  { label: "Signups", value: "342", delta: "+14.7%" },
  { label: "Revenue", value: "$18,240", delta: "+5.1%" },
  { label: "Bounce", value: "31%", delta: "-2.3%" },
];

export default function AnalyticsReportPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Weekly report</h1>
          <p className="text-sm text-muted-foreground">May 5 – May 11</p>
        </div>
        <Badge variant="secondary"><TrendingUp className="mr-1 h-3 w-3" />Trending up</Badge>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{k.label}</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <p className="text-2xl font-semibold tabular-nums">{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.delta} vs last week</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Sessions over time</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 w-full rounded-md bg-gradient-to-r from-primary/10 via-primary/30 to-primary/10" />
        </CardContent>
      </Card>
    </div>
  );
}
`;

/* ============================== COMMUNITY THREAD ============================== */
const COMMUNITY_THREAD_VIEW = `import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUp, MessageCircle } from "lucide-react";

const REPLIES = [
  { who: "Mei", text: "Try setting --radius to 0.625rem; it tightens cards without feeling sharp.", up: 12 },
  { who: "Tomás", text: "+1 — and bump --shadow-sm by one tier on dark mode.", up: 4 },
];

export default function CommunityThreadView() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardContent className="space-y-3 p-5">
            <Badge variant="secondary">Design</Badge>
            <h1 className="text-xl font-semibold">How do you balance card density on mobile?</h1>
            <p className="text-sm leading-relaxed">My feed feels cramped on a 6.1\\" screen. Looking for token-level tweaks rather than re-designing.</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Avatar className="h-6 w-6"><AvatarFallback>RA</AvatarFallback></Avatar>
              <span>Riya · 1h ago</span>
            </div>
          </CardContent>
        </Card>
        {REPLIES.map((r) => (
          <Card key={r.who}>
            <CardContent className="flex gap-3 p-4">
              <Avatar className="h-8 w-8"><AvatarFallback>{r.who[0]}</AvatarFallback></Avatar>
              <div className="flex-1">
                <p className="text-sm font-medium">{r.who}</p>
                <p className="text-sm text-muted-foreground">{r.text}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="ghost"><ArrowUp className="mr-1 h-3 w-3" />{r.up}</Button>
                  <Button size="sm" variant="ghost"><MessageCircle className="mr-1 h-3 w-3" />Reply</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
`;

/* ============================== PORTFOLIO SHOWCASE ============================== */
const PORTFOLIO_SHOWCASE_GRID = `import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const WORK = [
  { title: "Folio rebrand", tag: "Identity", year: "2025" },
  { title: "Northern Lights tour site", tag: "Web", year: "2025" },
  { title: "Kettle packaging", tag: "Packaging", year: "2024" },
  { title: "Aurora Labs product film", tag: "Motion", year: "2024" },
];

export default function PortfolioShowcaseGrid() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Selected work</h1>
        <p className="text-sm text-muted-foreground">A few recent things I'm proud of.</p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {WORK.map((w) => (
          <Card key={w.title} className="overflow-hidden">
            <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/40" />
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{w.title}</p>
                <p className="text-xs text-muted-foreground">{w.year}</p>
              </div>
              <Badge variant="secondary">{w.tag}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
`;

/* ============================== EXPORT ============================== */
export const EXAMPLES_PACK_2: Array<ProjectFile & { overwrite: boolean }> = [
  { path: "src/components/examples/kanban-board-page.tsx", content: KANBAN_BOARD_PAGE, overwrite: true },
  { path: "src/components/examples/mobile-tabbar-shell.tsx", content: MOBILE_TABBAR_SHELL, overwrite: true },
  { path: "src/components/examples/mobile-feed-card.tsx", content: MOBILE_FEED_CARD, overwrite: true },
  { path: "src/components/examples/telehealth-demo-consult.tsx", content: TELEHEALTH_DEMO_CONSULT, overwrite: true },
  { path: "src/components/examples/music-player-demo.tsx", content: MUSIC_PLAYER_DEMO, overwrite: true },
  { path: "src/components/examples/directory-listing-grid.tsx", content: DIRECTORY_LISTING_GRID, overwrite: true },
  { path: "src/components/examples/job-board-list.tsx", content: JOB_BOARD_LIST, overwrite: true },
  { path: "src/components/examples/iot-device-dashboard.tsx", content: IOT_DEVICE_DASHBOARD, overwrite: true },
  { path: "src/components/examples/course-lesson-player.tsx", content: COURSE_LESSON_PLAYER, overwrite: true },
  { path: "src/components/examples/ai-chat-workbench.tsx", content: AI_CHAT_WORKBENCH, overwrite: true },
  { path: "src/components/examples/booking-timeslots.tsx", content: BOOKING_TIMESLOTS, overwrite: true },
  { path: "src/components/examples/donation-landing.tsx", content: DONATION_LANDING, overwrite: true },
  { path: "src/components/examples/rental-listing-detail.tsx", content: RENTAL_LISTING_DETAIL, overwrite: true },
  { path: "src/components/examples/legal-contract-review-demo.tsx", content: LEGAL_CONTRACT_REVIEW_DEMO, overwrite: true },
  { path: "src/components/examples/event-ticketing-page.tsx", content: EVENT_TICKETING_PAGE, overwrite: true },
  { path: "src/components/examples/pos-order-ticket.tsx", content: POS_ORDER_TICKET, overwrite: true },
  { path: "src/components/examples/crm-contact-detail.tsx", content: CRM_CONTACT_DETAIL, overwrite: true },
  { path: "src/components/examples/helpdesk-inbox.tsx", content: HELPDESK_INBOX, overwrite: true },
  { path: "src/components/examples/analytics-report-page.tsx", content: ANALYTICS_REPORT_PAGE, overwrite: true },
  { path: "src/components/examples/community-thread-view.tsx", content: COMMUNITY_THREAD_VIEW, overwrite: true },
  { path: "src/components/examples/portfolio-showcase-grid.tsx", content: PORTFOLIO_SHOWCASE_GRID, overwrite: true },
];
