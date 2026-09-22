/**
 * F5 — Builder action registry.
 *
 * Every builder action is defined EXACTLY ONCE here, with the group it
 * belongs to and the surfaces it appears on. The desktop toolbar, the desktop
 * overflow menu and the mobile action sheet all render from this array, so
 * phone and desktop can never drift apart.
 *
 * Rules:
 *  - An action's label, icon, group and behaviour live here, never in a surface.
 *  - A surface may choose HOW to render an action (icon button, menu row,
 *    sheet row) but never WHAT it does.
 *  - Labels are written for someone who has never built an app before.
 */

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Cloud,
  Code2,
  Command as CommandIcon,
  CreditCard,
  Download,
  Globe,
  History as HistoryIcon,
  MessageSquare,
  Pencil,
  Plug,
  RotateCw,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
} from "lucide-react";

/** Where an action is allowed to appear. */
export type BuilderSurface =
  /** Grouped icon cluster in the desktop header. */
  | "desktop-toolbar"
  /** Desktop header overflow ("More") dropdown. */
  | "desktop-menu"
  /** Rows in the mobile action sheet. */
  | "mobile-primary"
  /** Rows inside the mobile sheet's collapsed "More" group. */
  | "mobile-more";

/** The four buckets every action belongs to. */
export type BuilderGroup = "share" | "app" | "connect" | "grow";

export const BUILDER_GROUP_ORDER: BuilderGroup[] = ["share", "app", "connect", "grow"];

export const BUILDER_GROUP_LABEL: Record<BuilderGroup, string> = {
  share: "Share",
  app: "Your app",
  connect: "Connect",
  grow: "Grow",
};

export interface BuilderAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  group: BuilderGroup;
  surfaces: BuilderSurface[];
  disabled?: boolean;
  /** Keyboard hint rendered by menu-style surfaces. */
  shortcut?: string;
  /** Tooltip / aria-label override. Falls back to `label`. */
  title?: string;
}

export interface BuilderActionContext {
  /** Disables file-dependent actions (export, reload) before the first build. */
  hasFiles: boolean;
  openShare: () => void;
  openPublish: () => void;
  openSettings: () => void;
  openCode: () => void;
  openHistory: () => void;
  openSecurity: () => void;
  openComments: () => void;
  openSeo: () => void;
  openAnalytics: () => void;
  openCloud: () => void;
  openAgentIntegrations: () => void;
  openPayments: () => void;
  openConnectors: () => void;
  openRename: () => void;
  openPalette: () => void;
  /** Domains sub-sheet (inside project settings). */
  openDomains: () => void;
  /** Mobile builds section (inside project settings). */
  openMobile: () => void;
  /** Credits & plan. */
  openCredits: () => void;
  /** Website info — title, description, social preview. */
  openWebsiteInfo: () => void;
  reloadPreview: () => void;
  exportCode: () => void;
}

export function createBuilderActions(ctx: BuilderActionContext): BuilderAction[] {
  return [
    // ── Share ──────────────────────────────────────────────────────────────
    {
      id: "share",
      label: "Share preview",
      title: "Share a preview and gather feedback",
      icon: Share2,
      run: ctx.openShare,
      group: "share",
      surfaces: ["desktop-toolbar", "mobile-primary"],
    },
    {
      id: "publish",
      label: "Publish",
      icon: Globe,
      run: ctx.openPublish,
      group: "share",
      // Desktop keeps its dedicated primary button in the header.
      surfaces: ["mobile-primary"],
    },
    {
      id: "domains",
      label: "Custom domain",
      icon: Globe,
      run: ctx.openDomains,
      group: "share",
      surfaces: ["desktop-menu", "mobile-more"],
    },

    // ── Your app ───────────────────────────────────────────────────────────
    {
      id: "settings",
      label: "Settings",
      icon: SettingsIcon,
      run: ctx.openSettings,
      group: "app",
      surfaces: ["desktop-menu", "mobile-primary"],
    },
    {
      id: "code",
      label: "Code & files",
      icon: Code2,
      run: ctx.openCode,
      group: "app",
      surfaces: ["mobile-primary"],
    },
    {
      id: "history",
      label: "History",
      title: "Earlier versions of your app",
      icon: HistoryIcon,
      run: ctx.openHistory,
      group: "app",
      surfaces: ["desktop-toolbar", "mobile-primary"],
    },
    {
      id: "comments",
      label: "Visitor feedback",
      icon: MessageSquare,
      run: ctx.openComments,
      group: "app",
      surfaces: ["desktop-toolbar", "mobile-more"],
    },
    {
      id: "security",
      label: "Safety check",
      title: "Check your app for safety issues",
      icon: ShieldCheck,
      run: ctx.openSecurity,
      group: "app",
      surfaces: ["desktop-toolbar", "mobile-more"],
    },
    {
      id: "rename",
      label: "Rename",
      icon: Pencil,
      run: ctx.openRename,
      group: "app",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "reload",
      label: "Reload preview",
      icon: RotateCw,
      run: ctx.reloadPreview,
      disabled: !ctx.hasFiles,
      group: "app",
      surfaces: ["desktop-toolbar", "mobile-more"],
    },
    {
      id: "export",
      label: "Download code",
      icon: Download,
      run: ctx.exportCode,
      disabled: !ctx.hasFiles,
      group: "app",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "palette",
      label: "Search actions",
      icon: CommandIcon,
      shortcut: "⌘K",
      run: ctx.openPalette,
      group: "app",
      surfaces: ["desktop-menu"],
    },

    // ── Connect ────────────────────────────────────────────────────────────
    {
      id: "payments",
      label: "Payments",
      icon: CreditCard,
      run: ctx.openPayments,
      group: "connect",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "cloud",
      label: "Data & storage",
      icon: Cloud,
      run: ctx.openCloud,
      group: "connect",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "connectors",
      label: "Apps & services",
      icon: Plug,
      run: ctx.openConnectors,
      group: "connect",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "agent-integrations",
      label: "AI assistants",
      icon: Bot,
      run: ctx.openAgentIntegrations,
      group: "connect",
      surfaces: ["desktop-menu", "mobile-more"],
    },

    // ── Grow ───────────────────────────────────────────────────────────────
    {
      id: "seo",
      label: "Get found",
      title: "How your app shows up in search",
      icon: SearchIcon,
      run: ctx.openSeo,
      group: "grow",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "analytics",
      label: "Visitors",
      icon: BarChart3,
      run: ctx.openAnalytics,
      group: "grow",
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "credits",
      label: "Credits & plan",
      icon: CreditCard,
      run: ctx.openCredits,
      group: "grow",
      surfaces: ["desktop-menu", "mobile-more"],
    },
  ];
}

export function actionsForSurface(
  actions: BuilderAction[],
  surface: BuilderSurface,
): BuilderAction[] {
  return actions.filter((a) => a.surfaces.includes(surface));
}

/**
 * The same actions, bucketed into the four groups, in a fixed order.
 * Empty groups are dropped so a surface never renders a bare heading.
 */
export function groupedActions(
  actions: BuilderAction[],
  surfaces: BuilderSurface[],
): { group: BuilderGroup; label: string; actions: BuilderAction[] }[] {
  const visible = actions.filter((a) => a.surfaces.some((s) => surfaces.includes(s)));
  return BUILDER_GROUP_ORDER.map((group) => ({
    group,
    label: BUILDER_GROUP_LABEL[group],
    actions: visible.filter((a) => a.group === group),
  })).filter((g) => g.actions.length > 0);
}
