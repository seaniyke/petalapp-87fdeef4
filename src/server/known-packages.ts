/**
 * Curated registry of npm packages Petal is willing to auto-install when
 * a generated file imports them. Each entry is pinned to a known-good
 * semver range so `bun install` never resolves to a surprise major.
 *
 * Rules for adding to this list:
 *   1. The package must be Worker-runtime-safe OR client-only (no Node-only
 *      packages with native bindings, child_process, etc.).
 *   2. Pick a stable major; use a caret range so patches flow.
 *   3. Review quarterly — drop anything we no longer recommend.
 *
 * This is the SINGLE source of truth for "what is Petal willing to ship
 * without the user asking?". If a generated app imports something that
 * isn't here, the import-resolver strips it instead of guessing.
 */

export const KNOWN_PACKAGES: Record<string, string> = {
  // React + ecosystem
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "react-hook-form": "^7.53.0",
  "@hookform/resolvers": "^3.9.0",

  // Routing — only React Router DOM. TanStack Router lives in the BUILDER
  // template, not in generated apps (those are plain Vite SPAs).
  "react-router-dom": "^6.28.0",

  // Validation
  zod: "^3.23.8",

  // Styling utilities
  clsx: "^2.1.1",
  "tailwind-merge": "^2.5.4",
  "class-variance-authority": "^0.7.1",

  // shadcn / Radix primitives the kit already ships are NOT listed here —
  // they're guaranteed by the scaffold. Only put packages Petal is willing
  // to install ON DEMAND.

  // Common UI helpers the model loves to reach for
  "framer-motion": "^11.18.0",
  "lucide-react": "^0.460.0",
  sonner: "^1.7.0",
  recharts: "^2.13.0",
  "date-fns": "^4.1.0",
  dayjs: "^1.11.13",
  "react-day-picker": "^9.2.0",
  "embla-carousel-react": "^8.3.0",
  cmdk: "^1.0.0",
  vaul: "^1.1.0",
  "input-otp": "^1.4.0",
  "react-resizable-panels": "^2.1.4",

  // Data / utility
  "lodash-es": "^4.17.21",
  immer: "^10.1.1",
  zustand: "^5.0.0",
  "@tanstack/react-query": "^5.59.0",
  "@tanstack/react-table": "^8.20.5",
  nanoid: "^5.0.7",
  uuid: "^10.0.0",
  // Phase 13 — URL-synced state (tabs, filters, dialogs, search)
  nuqs: "^2.2.3",

  // Phase 15 — Content & code surfaces (on-demand only, never auto-installed).
  //   shiki              real syntax highlighting (lazy grammars, browser-safe)
  //   react-markdown     markdown → React with custom renderers
  //   remark-gfm         GitHub-flavoured markdown (tables, task-lists, etc.)
  //   @tiptap/*          ProseMirror-based rich-text editor
  shiki: "^1.22.0",
  "react-markdown": "^9.0.1",
  "remark-gfm": "^4.0.0",
  "rehype-raw": "^7.0.0",
  "@tiptap/react": "^2.10.0",
  "@tiptap/pm": "^2.10.0",
  "@tiptap/starter-kit": "^2.10.0",
  "@tiptap/extension-link": "^2.10.0",
  "@tiptap/extension-placeholder": "^2.10.0",
  "@tiptap/extension-image": "^2.10.0",
  "@tiptap/extension-task-list": "^2.10.0",
  "@tiptap/extension-task-item": "^2.10.0",

  // Phase 16 — Awwwards layer (on-demand only). Three.js + R3F + drei for
  // 3D scenes, Spline embed runtime, GSAP + ScrollTrigger for cinematic
  // scroll, Lenis for smooth scroll, canvas-confetti for delight states.
  three: "^0.169.0",
  "@types/three": "^0.169.0",
  "@react-three/fiber": "^8.17.10",
  "@react-three/drei": "^9.114.0",
  "@react-three/postprocessing": "^2.16.3",
  "@splinetool/react-spline": "^4.0.0",
  "@splinetool/runtime": "^1.9.35",
  gsap: "^3.12.5",
  lenis: "^1.1.14",
  "canvas-confetti": "^1.9.3",
  "@types/canvas-confetti": "^1.6.4",

  // Phase 14 — Fontsource variable font catalog. Self-hosted, no CDN hop,
  // no FOIT/CLS. Inter + JetBrains Mono ship by default via scaffold-kit
  // REQUIRED_DEPS; the rest are on-demand for theme overrides
  // (editorial → instrument-serif, luxury → cormorant, tech → space-grotesk,
  // brutalist → archivo, etc.). Import with `@import "@fontsource-variable/<name>";`
  // at the top of src/styles.css, then override --font-display / --font-sans.
  "@fontsource-variable/inter": "^5.1.0",
  "@fontsource-variable/jetbrains-mono": "^5.1.0",
  "@fontsource-variable/instrument-serif": "^5.1.0",
  "@fontsource-variable/cormorant": "^5.1.0",
  "@fontsource-variable/cormorant-garamond": "^5.1.0",
  "@fontsource-variable/playfair-display": "^5.1.0",
  "@fontsource-variable/dm-serif-display": "^5.1.0",
  "@fontsource-variable/lora": "^5.1.0",
  "@fontsource-variable/libre-baskerville": "^5.1.0",
  "@fontsource-variable/space-grotesk": "^5.1.0",
  "@fontsource-variable/dm-sans": "^5.1.0",
  "@fontsource-variable/manrope": "^5.1.0",
  "@fontsource-variable/sora": "^5.1.0",
  "@fontsource-variable/outfit": "^5.1.0",
  "@fontsource-variable/figtree": "^5.1.0",
  "@fontsource-variable/plus-jakarta-sans": "^5.1.0",
  "@fontsource-variable/syne": "^5.1.0",
  "@fontsource-variable/urbanist": "^5.1.0",
  "@fontsource-variable/epilogue": "^5.1.0",
  "@fontsource-variable/bricolage-grotesque": "^5.1.0",
  "@fontsource-variable/work-sans": "^5.1.0",
  "@fontsource-variable/nunito-sans": "^5.1.0",
  "@fontsource-variable/karla": "^5.1.0",
  "@fontsource-variable/ibm-plex-sans": "^5.1.0",
  "@fontsource-variable/fira-sans": "^5.1.0",
  "@fontsource-variable/hind": "^5.1.0",
  "@fontsource-variable/cabin": "^5.1.0",
  "@fontsource-variable/rubik": "^5.1.0",
  "@fontsource-variable/barlow": "^5.1.0",
  "@fontsource/bebas-neue": "^5.1.0",
  "@fontsource/archivo-black": "^5.1.0",
  "@fontsource/abril-fatface": "^5.1.0",
  "@fontsource/space-mono": "^5.1.0",

  // Phase 17 — A11y + image quality (on-demand only).
  //   thumbhash         tiny (~25B) image placeholders, blur-up reveal
  //   react-aria        keyboard/focus/ARIA primitives for hand-rolled widgets
  //   @axe-core/react   dev-only a11y auditor (no-op in production)
  thumbhash: "^0.1.1",
  "react-aria": "^3.35.0",
  "@axe-core/react": "^4.10.0",
};

/**
 * Common typos / wrong-package aliases the model emits. We rewrite the
 * import specifier in place. Keys are the bad import, values are the
 * correct one. The corrected package MUST be in KNOWN_PACKAGES above.
 */
export const PACKAGE_ALIASES: Record<string, string> = {
  // lucide-react variants
  lucide: "lucide-react",
  "@lucide/react": "lucide-react",
  // framer
  framer: "framer-motion",
  motion: "framer-motion",
  // date libs
  moment: "date-fns",
  // react-icons isn't shipped — route to lucide-react. The import-resolver
  // also has to fix the named imports (FaTwitter → Twitter), so this alias
  // alone isn't enough; see lucideRewriteForReactIcons.
  "react-icons/fa": "lucide-react",
  "react-icons/fi": "lucide-react",
  "react-icons/md": "lucide-react",
  "react-icons/ai": "lucide-react",
  "react-icons/bi": "lucide-react",
  "react-icons/io": "lucide-react",
  "react-icons/io5": "lucide-react",
};

/**
 * Curated lucide icon names. This is a deliberately small, common-use list —
 * not the full ~1500-icon set. Names not in this set fall back to typo
 * correction (Levenshtein) against this list, and finally to the SAFE_ICON
 * default below.
 *
 * Source: hand-curated from lucide.dev's most-used icons. Grow as telemetry
 * shows misses; don't try to mirror the whole package.
 */
export const COMMON_LUCIDE_ICONS = new Set<string>([
  // Navigation + arrows
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDownLeft",
  "ArrowDownRight", "ArrowUpLeft", "ArrowUpRight", "ArrowLeftRight",
  "ArrowUpDown", "ChevronDown", "ChevronLeft", "ChevronRight", "ChevronUp",
  "ChevronsDown", "ChevronsLeft", "ChevronsRight", "ChevronsUp",
  "CornerDownLeft", "CornerDownRight", "CornerUpLeft", "CornerUpRight",
  "Move", "MoveHorizontal", "MoveVertical", "ExternalLink",

  // Actions
  "Plus", "Minus", "X", "Check", "CheckCircle", "CheckCircle2", "XCircle",
  "Edit", "Edit2", "Edit3", "Pencil", "Trash", "Trash2", "Save", "Copy",
  "Clipboard", "Download", "Upload", "Share", "Share2", "Send", "Search",
  "Filter", "RefreshCw", "RefreshCcw", "RotateCw", "RotateCcw", "Undo",
  "Redo", "ZoomIn", "ZoomOut", "Maximize", "Maximize2", "Minimize",
  "Minimize2", "Settings", "Settings2", "MoreHorizontal", "MoreVertical",
  "EllipsisVertical", "Eye", "EyeOff", "Lock", "Unlock", "Key", "LogIn",
  "LogOut", "Power", "PowerOff",

  // Status / alerts
  "AlertCircle", "AlertTriangle", "AlertOctagon", "Info", "HelpCircle",
  "CircleAlert", "CircleCheck", "CircleX", "Ban", "ShieldAlert",
  "ShieldCheck", "Shield", "ShieldOff",

  // Content
  "FileText", "File", "FilePlus", "FileMinus", "FileX", "FileCheck",
  "FileCode", "FileImage", "FileVideo", "FileAudio", "FileSpreadsheet",
  "Folder", "FolderOpen", "FolderPlus", "FolderMinus", "Image", "Images",
  "Video", "Music", "Mic", "MicOff", "Paperclip", "Link", "Link2",
  "Unlink", "Bookmark", "BookmarkPlus", "Tag", "Tags", "Hash", "AtSign",

  // People / social
  "User", "Users", "UserPlus", "UserMinus", "UserCheck", "UserX",
  "UserCircle", "UserCircle2", "Heart", "HeartHandshake", "ThumbsUp",
  "ThumbsDown", "MessageCircle", "MessageSquare", "MessagesSquare", "Mail",
  "MailOpen", "Inbox", "Phone", "PhoneCall", "PhoneOff", "Video", "VideoOff",

  // Commerce / fintech
  "DollarSign", "Euro", "PoundSterling", "Bitcoin", "CreditCard", "Wallet",
  "Receipt", "ShoppingBag", "ShoppingCart", "Package", "PackageOpen",
  "Package2", "Box", "Boxes", "Truck", "Store", "Building", "Building2",
  "Briefcase", "TrendingUp", "TrendingDown", "BarChart", "BarChart2",
  "BarChart3", "LineChart", "PieChart", "Activity", "Banknote", "Coins",
  "PiggyBank", "Landmark", "ScrollText",

  // Time
  "Clock", "Clock1", "Clock2", "Clock3", "Clock4", "Calendar", "CalendarDays",
  "CalendarCheck", "CalendarPlus", "CalendarX", "Timer", "Hourglass",

  // Media controls
  "Play", "Pause", "Stop", "SkipBack", "SkipForward", "Rewind",
  "FastForward", "Volume", "Volume1", "Volume2", "VolumeX", "Repeat",
  "Shuffle",

  // Device / system
  "Smartphone", "Tablet", "Laptop", "Monitor", "Tv", "Watch", "Camera",
  "CameraOff", "Wifi", "WifiOff", "Bluetooth", "Battery", "BatteryLow",
  "BatteryFull", "Plug", "Cpu", "HardDrive", "Database", "Server", "Cloud",
  "CloudOff", "CloudUpload", "CloudDownload",

  // Layout / UI
  "Menu", "Grid", "Grid2x2", "Grid3x3", "List", "Columns", "Rows", "Layout",
  "LayoutGrid", "LayoutList", "LayoutDashboard", "LayoutTemplate",
  "PanelLeft", "PanelRight", "PanelTop", "PanelBottom", "Sidebar",
  "Square", "Circle", "Triangle", "Hexagon", "Star", "Sparkles", "Sparkle",
  "Zap", "Bolt", "Flame", "Sun", "Moon", "SunMoon",

  // Movement / location
  "Map", "MapPin", "Navigation", "Navigation2", "Compass", "Globe", "Globe2",
  "Home", "Building", "Hotel", "Car", "Bus", "Train", "Plane", "Bike",

  // Misc
  "Bell", "BellOff", "BellRing", "Gift", "Award", "Trophy", "Medal",
  "Flag", "Bookmark", "Pin", "PinOff", "Anchor", "Wrench", "Hammer",
  "Lightbulb", "Rocket", "Crown", "Gem", "Palette", "Brush", "Paintbrush",
  "Pen", "PenTool", "Code", "Code2", "Terminal", "Bug", "Cog", "Gauge",
  "Layers", "Layers2", "GitBranch", "GitCommit", "GitMerge", "GitPullRequest",
  "Github", "Twitter", "Facebook", "Instagram", "Linkedin", "Youtube",
  "Slack", "Chrome", "Figma", "Dribbble",
]);

/** When an icon name can't be matched, swap to this so the build still ships. */
export const SAFE_ICON_FALLBACK = "Square";

/**
 * react-icons → lucide-react name map for the most common offenders. The
 * import-resolver consults this whenever it sees `from "react-icons/*"`.
 */
export const REACT_ICONS_TO_LUCIDE: Record<string, string> = {
  // react-icons/fa (Font Awesome)
  FaTwitter: "Twitter",
  FaFacebook: "Facebook",
  FaInstagram: "Instagram",
  FaLinkedin: "Linkedin",
  FaYoutube: "Youtube",
  FaGithub: "Github",
  FaGoogle: "Globe",
  FaApple: "Apple",
  FaHome: "Home",
  FaUser: "User",
  FaUsers: "Users",
  FaEnvelope: "Mail",
  FaPhone: "Phone",
  FaMapMarkerAlt: "MapPin",
  FaSearch: "Search",
  FaShoppingCart: "ShoppingCart",
  FaHeart: "Heart",
  FaStar: "Star",
  FaCheck: "Check",
  FaTimes: "X",
  FaArrowRight: "ArrowRight",
  FaArrowLeft: "ArrowLeft",
  FaChevronDown: "ChevronDown",
  FaChevronUp: "ChevronUp",
  FaBars: "Menu",
  FaCog: "Settings",
  FaLock: "Lock",
  FaUnlock: "Unlock",
  FaPlay: "Play",
  FaPause: "Pause",
  FaDownload: "Download",
  FaUpload: "Upload",
  FaTrash: "Trash2",
  FaEdit: "Edit",
  FaPlus: "Plus",
  FaMinus: "Minus",
  FaCalendar: "Calendar",
  FaClock: "Clock",
  FaBell: "Bell",
  FaBookmark: "Bookmark",
  // Material (Md*)
  MdHome: "Home",
  MdSearch: "Search",
  MdMenu: "Menu",
  MdClose: "X",
  MdCheck: "Check",
  MdSettings: "Settings",
  MdNotifications: "Bell",
  MdPerson: "User",
  MdEmail: "Mail",
  MdPhone: "Phone",
  MdShoppingCart: "ShoppingCart",
  MdFavorite: "Heart",
  MdStar: "Star",
  // Feather (Fi*)
  FiHome: "Home",
  FiSearch: "Search",
  FiMenu: "Menu",
  FiX: "X",
  FiCheck: "Check",
  FiSettings: "Settings",
  FiBell: "Bell",
  FiUser: "User",
  FiMail: "Mail",
  FiPhone: "Phone",
  FiArrowRight: "ArrowRight",
  FiArrowLeft: "ArrowLeft",
};

/**
 * One-shot helper: cheap Levenshtein distance for short strings. Used to
 * recover from icon-name typos like "ArrowRightCircled" → "ArrowRightCircle".
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Find the nearest known icon name within `maxDistance` (default 2). */
export function nearestIcon(name: string, maxDistance = 2): string | null {
  if (COMMON_LUCIDE_ICONS.has(name)) return name;
  let best: { name: string; d: number } | null = null;
  for (const candidate of COMMON_LUCIDE_ICONS) {
    const d = levenshtein(name, candidate);
    if (d <= maxDistance && (!best || d < best.d)) best = { name: candidate, d };
  }
  return best?.name ?? null;
}
