/**
 * Stream-time autofixer (Tier 2).
 *
 * Runs over each generated/patched file's content AFTER the AI emits it and
 * BEFORE we hand it to the build. Pure regex — no model call, <10ms per file.
 *
 * Fixes known footguns we keep seeing in generated apps:
 *   1. Direct imports from "react-router-dom"        → "@/components/ui/router"
 *   2. Direct imports from "@supabase/supabase-js"   → "@/integrations/backend/client"
 *      (only the createClient surface; we keep type-only imports alone)
 *   3. <input type="date">                           → noted (cannot rewrite JSX safely; logged)
 *   4. lucide-react icons that don't exist           → swapped for nearest valid icon
 *   5. Petal-image:// placeholders > 6 unique        → first 6 kept, rest stripped to picsum
 *
 * Each fix logs to the returned report so we can surface a "auto-corrected N
 * issues" status in the chat.
 */

import type { ProjectFile } from "@/server/generate.server";

export interface AutofixReport {
  fixedCount: number;
  notes: string[];
}

/** Subset of valid lucide-react icon names (PascalCase). Source: lucide-react v0.5x. */
const VALID_LUCIDE_ICONS = new Set([
  // common navigation
  "Home", "Menu", "X", "ChevronDown", "ChevronUp", "ChevronLeft", "ChevronRight",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "ExternalLink", "MoreHorizontal", "MoreVertical",
  // common actions
  "Plus", "Minus", "Edit", "Edit2", "Edit3", "Trash", "Trash2", "Save", "Copy", "Check", "CheckCircle", "CheckCircle2",
  "Search", "Settings", "Settings2", "Filter", "RefreshCw", "RotateCw", "Download", "Upload", "Share", "Share2", "Send",
  // user/account
  "User", "Users", "UserPlus", "UserCheck", "UserX", "LogIn", "LogOut", "Lock", "Unlock", "Key", "Shield", "ShieldCheck",
  // content
  "FileText", "File", "Folder", "FolderOpen", "Image", "ImageIcon", "Video", "Camera", "Mic", "Music", "Headphones",
  // commerce
  "ShoppingCart", "ShoppingBag", "CreditCard", "DollarSign", "Tag", "Gift", "Package", "Truck", "Receipt",
  // social/comms
  "Mail", "MessageCircle", "MessageSquare", "Phone", "Bell", "BellRing", "Heart", "Star", "ThumbsUp", "ThumbsDown",
  // status
  "AlertCircle", "AlertTriangle", "Info", "HelpCircle", "Loader", "Loader2", "Zap", "Sparkles", "Eye", "EyeOff",
  // layout
  "LayoutGrid", "LayoutList", "LayoutDashboard", "Sidebar", "Columns", "Rows", "Maximize", "Minimize",
  // time/calendar
  "Calendar", "CalendarDays", "Clock", "Timer", "Hourglass",
  // arrows/charts
  "TrendingUp", "TrendingDown", "BarChart", "BarChart2", "BarChart3", "LineChart", "PieChart", "Activity",
  // theme
  "Sun", "Moon", "SunMoon", "Monitor", "Smartphone", "Laptop",
  // other common
  "Globe", "Map", "MapPin", "Navigation", "Wifi", "Battery", "Bluetooth", "Code", "Terminal", "Database",
  "Cloud", "CloudUpload", "CloudDownload", "Cpu", "HardDrive", "Server", "Layers", "Box", "Boxes", "Briefcase",
  "Bookmark", "BookOpen", "Book", "Coffee", "Pizza", "Utensils", "Award", "Trophy", "Flag", "Flame", "Leaf",
  "Github", "Twitter", "Facebook", "Linkedin", "Instagram", "Youtube", "Slack", "Chrome", "Apple",
  "Play", "Pause", "SkipBack", "SkipForward", "Volume2", "VolumeX", "Repeat", "Shuffle", "Rewind", "FastForward",
]);

/** Common typo → canonical mapping for icons we frequently see broken. */
const ICON_REPAIR_MAP: Record<string, string> = {
  Trashcan: "Trash2",
  Pencil: "Edit3",
  Cog: "Settings",
  Gear: "Settings",
  Cross: "X",
  Tick: "Check",
  Magnifier: "Search",
  Magnify: "Search",
  Bin: "Trash2",
  Cart: "ShoppingCart",
  Bag: "ShoppingBag",
  Picture: "Image",
  Photo: "Camera",
  Cogs: "Settings2",
  Hamburger: "Menu",
  Burger: "Menu",
  Close: "X",
  Dismiss: "X",
  Send2: "Send",
  Envelope: "Mail",
  Email: "Mail",
  Trashbin: "Trash2",
  Refresh: "RefreshCw",
  Reload: "RotateCw",
  Notification: "Bell",
  Notify: "Bell",
  Person: "User",
  People: "Users",
  Chat: "MessageCircle",
  Speech: "MessageSquare",
  Cogwheel: "Settings",
  House: "Home",
  Buildings: "LayoutGrid",
  Graph: "LineChart",
  Chart: "BarChart3",
};

function fixLucideIcons(content: string, report: AutofixReport): string {
  // Match: import { A, B as C, D } from "lucide-react";
  return content.replace(
    /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g,
    (whole, names: string) => {
      const parts = names.split(",").map((s) => s.trim()).filter(Boolean);
      let changed = false;
      const fixedParts = parts.map((p) => {
        // Handle "Foo as Bar" → keep alias, fix only Foo
        const aliasMatch = p.match(/^(\w+)(\s+as\s+\w+)$/);
        const original = aliasMatch ? aliasMatch[1] : p;
        const aliasSuffix = aliasMatch ? aliasMatch[2] : "";
        if (VALID_LUCIDE_ICONS.has(original)) return p;
        const repair = ICON_REPAIR_MAP[original];
        if (repair) {
          changed = true;
          report.fixedCount++;
          report.notes.push(`lucide icon ${original} → ${repair}`);
          return `${repair}${aliasSuffix}`;
        }
        // Unknown but not in our repair map — leave it (may exist in newer
        // lucide; better to let the build catch a true miss than silently swap).
        return p;
      });
      if (!changed) return whole;
      return `import { ${fixedParts.join(", ")} } from "lucide-react"`;
    },
  );
}

function fixBadImports(content: string, report: AutofixReport): string {
  let out = content;

  // 1. react-router-dom → kit re-export
  const rrd = /from\s+["']react-router-dom["']/g;
  if (rrd.test(out)) {
    out = out.replace(rrd, 'from "@/components/ui/router"');
    report.fixedCount++;
    report.notes.push('react-router-dom → @/components/ui/router');
  }

  // 2. Direct supabase-js client → backend kit. Only catch named/default
  //    imports that include createClient or the default — type imports stay.
  const sbCreate = /import\s+\{[^}]*createClient[^}]*\}\s+from\s+["']@supabase\/supabase-js["']/g;
  if (sbCreate.test(out)) {
    out = out.replace(
      sbCreate,
      'import { supabase } from "@/integrations/backend/client"',
    );
    report.fixedCount++;
    report.notes.push('@supabase/supabase-js createClient → @/integrations/backend/client');
  }

  return out;
}

/** Cap petal-image:// placeholders to 6 unique slugs per file. Beyond that we
 *  swap to picsum so the AI never blows the image budget on one file. */
function capPetalImages(content: string, report: AutofixReport): string {
  const re = /petal-image:\/\/([a-zA-Z0-9_\-%]+)/g;
  const seen = new Set<string>();
  let stripped = 0;
  const out = content.replace(re, (whole, slug: string) => {
    if (seen.has(slug)) return whole; // dedupe — stays as same petal-image
    if (seen.size < 6) {
      seen.add(slug);
      return whole;
    }
    stripped++;
    // Use a deterministic picsum seed derived from slug length so swaps are
    // stable across re-renders.
    return `https://picsum.photos/seed/${slug.slice(0, 16)}/800/600`;
  });
  if (stripped > 0) {
    report.fixedCount += stripped;
    report.notes.push(`petal-image:// budget exceeded — swapped ${stripped} extras to picsum`);
  }
  return out;
}

/** Apply autofixers to a single file. Returns the (possibly modified) file. */
export function autofixFile(file: ProjectFile, report: AutofixReport): ProjectFile {
  // Only run on text files we'd ship to the build. Skip binaries, lockfiles.
  if (!/\.(tsx?|jsx?|css|html|md)$/.test(file.path)) return file;
  if (file.path.startsWith("src/components/ui/") ||
      file.path.startsWith("src/components/examples/") ||
      file.path.startsWith("src/integrations/backend/")) {
    return file; // protected — never modify scaffold
  }
  let content = file.content;
  content = fixBadImports(content, report);
  content = fixLucideIcons(content, report);
  content = capPetalImages(content, report);
  return content === file.content ? file : { ...file, content };
}

/** Apply autofixers across the whole file set. Returns new files + report. */
export function autofixFiles(files: ProjectFile[]): { files: ProjectFile[]; report: AutofixReport } {
  const report: AutofixReport = { fixedCount: 0, notes: [] };
  const out = files.map((f) => autofixFile(f, report));
  return { files: out, report };
}
