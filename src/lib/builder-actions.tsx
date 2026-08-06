/**
 * F5 — Builder action registry.
 *
 * Phase 1 / Sprint 3 of the Builder UX roadmap ("one chrome"): every builder
 * action is defined EXACTLY ONCE here, with the surfaces it appears on. The
 * desktop toolbar, the desktop overflow menu and the mobile action sheet all
 * render from this array, which is what closes the nine duplicated
 * desktop/mobile pairs the audit found (H9) and keeps parity structural
 * rather than accidental.
 *
 * Rules:
 *  - An action's label, icon and behaviour live here, never in a surface.
 *  - A surface may choose HOW to render an action (icon button, menu row,
 *    sheet row) but never WHAT it does.
 *  - Adding an action to a new surface is a one-word change to `surfaces`.
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
  /** Top-level rows in the mobile action sheet. */
  | "mobile-primary"
  /** Rows inside the mobile sheet's collapsed "More" group. */
  | "mobile-more";

export interface BuilderAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
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
  reloadPreview: () => void;
  exportCode: () => void;
}

export function createBuilderActions(ctx: BuilderActionContext): BuilderAction[] {
  return [
    {
      id: "share",
      label: "Share",
      title: "Share preview & gather feedback",
      icon: Share2,
      run: ctx.openShare,
      surfaces: ["desktop-toolbar", "mobile-primary"],
    },
    {
      id: "publish",
      label: "Publish",
      icon: Globe,
      run: ctx.openPublish,
      // Desktop keeps its dedicated primary button in the header.
      surfaces: ["mobile-primary"],
    },
    {
      id: "settings",
      label: "Project settings",
      icon: SettingsIcon,
      run: ctx.openSettings,
      surfaces: ["desktop-menu", "mobile-primary"],
    },
    {
      // M9 — "Code" and "Files" were two rows opening the same view.
      id: "code",
      label: "Code & files",
      icon: Code2,
      run: ctx.openCode,
      surfaces: ["mobile-primary"],
    },
    {
      id: "history",
      label: "History",
      title: "Version history",
      icon: HistoryIcon,
      run: ctx.openHistory,
      surfaces: ["desktop-toolbar", "mobile-primary"],
    },
    {
      id: "reload",
      label: "Reload preview",
      icon: RotateCw,
      run: ctx.reloadPreview,
      disabled: !ctx.hasFiles,
      surfaces: ["desktop-toolbar", "mobile-more"],
    },
    {
      id: "security",
      label: "Security",
      title: "Petal Shield — security audit",
      icon: ShieldCheck,
      run: ctx.openSecurity,
      surfaces: ["desktop-toolbar", "mobile-more"],
    },
    {
      id: "comments",
      label: "Visitor feedback",
      icon: MessageSquare,
      run: ctx.openComments,
      surfaces: ["desktop-toolbar", "mobile-more"],
    },
    {
      id: "analytics",
      label: "Analytics",
      icon: BarChart3,
      run: ctx.openAnalytics,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "cloud",
      label: "Cloud",
      icon: Cloud,
      run: ctx.openCloud,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "agent-integrations",
      label: "Agent integrations",
      icon: Bot,
      run: ctx.openAgentIntegrations,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "payments",
      label: "Payments",
      icon: CreditCard,
      run: ctx.openPayments,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "connectors",
      label: "Connectors",
      icon: Plug,
      run: ctx.openConnectors,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "seo",
      label: "SEO & AI search",
      icon: SearchIcon,
      run: ctx.openSeo,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "rename",
      label: "Rename project",
      icon: Pencil,
      run: ctx.openRename,
      surfaces: ["desktop-menu", "mobile-more"],
    },
    {
      id: "palette",
      label: "Command palette",
      icon: CommandIcon,
      shortcut: "⌘K",
      run: ctx.openPalette,
      surfaces: ["desktop-menu"],
    },
    {
      id: "export",
      label: "Export code",
      icon: Download,
      run: ctx.exportCode,
      disabled: !ctx.hasFiles,
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
