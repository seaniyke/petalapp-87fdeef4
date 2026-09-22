/**
 * Icon vocabulary.
 *
 * Icons used to be described in instructions but never chosen from a
 * known list, so a build could reach for a name that does not exist in
 * lucide-react and fail at import time. This module is the allow-list:
 * a semantic meaning -> icon name map, plus a verifier the build can run
 * over generated files.
 *
 * Every name below is a real lucide-react export.
 */

import { type ResourceMeta, retrieve } from "./registry-types";

export interface IconRecord extends ResourceMeta {
  kind: "icon";
  /** Exact lucide-react export name. */
  icon: string;
}

function icon(meaning: string, name: string, tags: string[]): IconRecord {
  return {
    id: meaning,
    kind: "icon",
    label: meaning,
    icon: name,
    description: `${meaning} → ${name}`,
    tags: [meaning, ...tags],
  };
}

export const ICONS: readonly IconRecord[] = [
  icon("security", "Shield", ["trust", "privacy", "fintech", "compliance"]),
  icon("privacy", "Lock", ["security", "trust", "compliance"]),
  icon("payments", "CreditCard", ["fintech", "commerce", "billing"]),
  icon("money", "Wallet", ["fintech", "billing", "payout"]),
  icon("analytics", "BarChart3", ["data", "dashboard", "reporting"]),
  icon("trend", "TrendingUp", ["data", "growth", "reporting"]),
  icon("activity", "Activity", ["data", "monitoring", "health"]),
  icon("users", "Users", ["team", "community", "audience"]),
  icon("person", "User", ["account", "profile"]),
  icon("speed", "Zap", ["performance", "automation", "ai"]),
  icon("automation", "Workflow", ["ai", "process", "integration"]),
  icon("ai", "Brain", ["ai", "intelligence"]),
  icon("search", "Search", ["discovery", "directory", "marketplace"]),
  icon("filter", "SlidersHorizontal", ["directory", "marketplace", "table"]),
  icon("calendar", "Calendar", ["booking", "events", "scheduling"]),
  icon("time", "Clock", ["scheduling", "tracking", "delivery"]),
  icon("location", "MapPin", ["local", "restaurant", "real-estate", "travel"]),
  icon("delivery", "Truck", ["commerce", "logistics", "food"]),
  icon("cart", "ShoppingCart", ["commerce", "checkout"]),
  icon("product", "Package", ["commerce", "inventory", "logistics"]),
  icon("store", "Store", ["commerce", "marketplace", "local"]),
  icon("message", "MessageSquare", ["chat", "support", "community"]),
  icon("email", "Mail", ["contact", "newsletter", "support"]),
  icon("phone", "Phone", ["contact", "support", "local"]),
  icon("support", "LifeBuoy", ["support", "helpdesk"]),
  icon("document", "FileText", ["content", "legal", "reporting"]),
  icon("upload", "Upload", ["files", "media"]),
  icon("download", "Download", ["files", "export"]),
  icon("cloud", "Cloud", ["infrastructure", "storage", "saas"]),
  icon("database", "Database", ["data", "infrastructure", "developer"]),
  icon("code", "Code2", ["developer", "api", "technical"]),
  icon("terminal", "Terminal", ["developer", "infrastructure"]),
  icon("integration", "Plug", ["integration", "api", "saas"]),
  icon("settings", "Settings", ["configuration", "admin"]),
  icon("verified", "BadgeCheck", ["trust", "compliance", "quality"]),
  icon("success", "CheckCircle2", ["confirmation", "status", "pricing"]),
  icon("warning", "AlertTriangle", ["status", "risk"]),
  icon("info", "Info", ["status", "help"]),
  icon("star", "Star", ["rating", "reviews", "quality"]),
  icon("favorite", "Heart", ["wellness", "community", "saving"]),
  icon("health", "HeartPulse", ["medical", "fitness", "wellness"]),
  icon("fitness", "Dumbbell", ["fitness", "sports"]),
  icon("food", "UtensilsCrossed", ["restaurant", "food"]),
  icon("coffee", "Coffee", ["cafe", "food", "hospitality"]),
  icon("home", "Home", ["real-estate", "rental", "navigation"]),
  icon("building", "Building2", ["corporate", "real-estate", "b2b"]),
  icon("education", "GraduationCap", ["education", "learning"]),
  icon("book", "BookOpen", ["education", "docs", "publication"]),
  icon("media", "Play", ["video", "podcast", "streaming"]),
  icon("audio", "Mic", ["podcast", "audio", "voice"]),
  icon("music", "Music", ["music", "streaming"]),
  icon("camera", "Camera", ["photography", "media"]),
  icon("image", "Image", ["gallery", "media"]),
  icon("design", "Palette", ["creative", "design", "agency"]),
  icon("travel", "Plane", ["travel", "tourism"]),
  icon("car", "Car", ["mobility", "rental", "logistics"]),
  icon("energy", "Leaf", ["sustainability", "nature", "wellness"]),
  icon("global", "Globe", ["international", "web", "network"]),
  icon("link", "Link2", ["sharing", "integration", "web"]),
  icon("share", "Share2", ["sharing", "social"]),
  icon("notification", "Bell", ["alerts", "engagement"]),
  icon("target", "Target", ["goals", "marketing", "okr"]),
  icon("award", "Trophy", ["achievement", "gamification", "sports"]),
  icon("gift", "Gift", ["rewards", "referral", "commerce"]),
  icon("ticket", "Ticket", ["events", "booking", "support"]),
  icon("key", "KeyRound", ["auth", "security", "access"]),
  icon("refresh", "RefreshCw", ["sync", "status", "recovery"]),
  icon("layers", "Layers", ["platform", "architecture", "stack"]),
  icon("grid", "LayoutGrid", ["dashboard", "catalogue"]),
  icon("list", "ListChecks", ["tasks", "process", "checklist"]),
  icon("sparkle", "Sparkles", ["ai", "highlight"]),
];

/** Every allowed icon export name. */
export const ICON_ALLOWLIST: ReadonlySet<string> = new Set(ICONS.map((i) => i.icon));

/** Best icons for a brief — a short menu, not the whole list. */
export function pickIcons(briefTags: string[], briefText = "", limit = 18): IconRecord[] {
  return retrieve(ICONS, briefTags, limit, briefText);
}

/**
 * Prompt block: the semantic map, with the one hard rule attached.
 */
export function renderIconBlock(briefTags: string[], briefText = ""): string {
  const picks = pickIcons(briefTags, briefText, 18);
  if (!picks.length) return "";
  const pairs = picks.map((p) => `${p.label}=${p.icon}`).join(", ");
  return [
    ``,
    `[Icons — use these lucide-react names]`,
    pairs,
    `Rules: import icons from "lucide-react" only. Pick by meaning, never invent an export name. One stroke style and one size scale across the whole project. Decorative icons get aria-hidden; an icon that is the only content of a control gets an accessible label. Do not hand-write SVG icon sets.`,
  ].join("\n");
}

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g;

/**
 * Verify that every icon imported from lucide-react is on the allow-list.
 *
 * Returns the offending names (deduped). An empty array means clean.
 * This is advisory input for the repair loop — never throws.
 */
export function findUnknownIcons(files: Array<{ path: string; content: string }>): Array<{ path: string; name: string }> {
  const out: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (!/\.(tsx|jsx|ts)$/.test(file.path)) continue;
    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(file.content))) {
      for (const raw of String(match[1] ?? "").split(",")) {
        const name = raw.split(" as ")[0]?.trim() ?? "";
        if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) continue;
        if (ICON_ALLOWLIST.has(name)) continue;
        const key = `${file.path}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path: file.path, name });
      }
    }
  }
  return out;
}
