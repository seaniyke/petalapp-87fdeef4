/**
 * Phase 12 — Missing shadcn primitives.
 *
 * Adds the shadcn/ui primitives that Petal's scaffold didn't ship. All
 * components mirror the shadcn API (same imports, same prop shapes) so the
 * model can use them with its existing shadcn vocabulary.
 *
 * Ships:
 *   Zero-dep (custom):
 *     - Breadcrumb, Collapsible, HoverCard, Toggle, ToggleGroup, AspectRatio,
 *       Spinner, ContextMenu, Menubar, NavigationMenu, Empty, Field, InputGroup
 *   Vendor-backed (auto-installed via KNOWN_PACKAGES):
 *     - Carousel (embla-carousel-react)
 *     - Command (cmdk)
 *     - Resizable (react-resizable-panels)
 *     - DataTable (@tanstack/react-table + Recharts already in pkgs)
 *   Sidebar system: shadcn-faithful full Sidebar with SidebarProvider,
 *     collapsible="icon" support, mobile sheet swap, useSidebar hook.
 *
 * All components import from "@/components/ui/<kebab-name>".
 */

import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// ===========================================================================
// BREADCRUMB
// ===========================================================================
const BREADCRUMB = `import * as React from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export const Breadcrumb = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"nav">>(
  ({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />,
);
Breadcrumb.displayName = "Breadcrumb";

export const BreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<"ol">>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground sm:gap-2.5", className)} {...props} />
  ),
);
BreadcrumbList.displayName = "BreadcrumbList";

export const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<"li">>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn("inline-flex items-center gap-1.5", className)} {...props} />,
);
BreadcrumbItem.displayName = "BreadcrumbItem";

export const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<"a">>(
  ({ className, ...props }, ref) => <a ref={ref} className={cn("transition-colors hover:text-foreground", className)} {...props} />,
);
BreadcrumbLink.displayName = "BreadcrumbLink";

export const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  ({ className, ...props }, ref) => (
    <span ref={ref} role="link" aria-disabled="true" aria-current="page" className={cn("font-normal text-foreground", className)} {...props} />
  ),
);
BreadcrumbPage.displayName = "BreadcrumbPage";

export const BreadcrumbSeparator: React.FC<React.ComponentProps<"li">> = ({ children, className, ...props }) => (
  <li role="presentation" aria-hidden className={cn("[&>svg]:size-3.5", className)} {...props}>
    {children ?? <ChevronRight />}
  </li>
);

export const BreadcrumbEllipsis: React.FC<React.ComponentProps<"span">> = ({ className, ...props }) => (
  <span role="presentation" aria-hidden className={cn("flex h-9 w-9 items-center justify-center", className)} {...props}>
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
);
`;

// ===========================================================================
// COLLAPSIBLE
// ===========================================================================
const COLLAPSIBLE = `import * as React from "react";
import { cn } from "@/lib/utils";

interface CollapsibleCtx { open: boolean; setOpen: (v: boolean) => void; }
const Ctx = React.createContext<CollapsibleCtx | null>(null);

export interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const Collapsible: React.FC<CollapsibleProps> = ({
  open, defaultOpen = false, onOpenChange, children, ...rest
}) => {
  const [internal, setInternal] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const value = isControlled ? open! : internal;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternal(v);
    onOpenChange?.(v);
  };
  return (
    <Ctx.Provider value={{ open: value, setOpen }}>
      <div data-state={value ? "open" : "closed"} {...rest}>{children}</div>
    </Ctx.Provider>
  );
};

export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, ...rest }, ref) => {
    const ctx = React.useContext(Ctx);
    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={ctx?.open ?? false}
        data-state={ctx?.open ? "open" : "closed"}
        onClick={(e) => { ctx?.setOpen(!ctx.open); onClick?.(e); }}
        {...rest}
      />
    );
  },
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export const CollapsibleContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => {
    const ctx = React.useContext(Ctx);
    if (!ctx?.open) return null;
    return <div ref={ref} data-state="open" className={cn("overflow-hidden", className)} {...rest} />;
  },
);
CollapsibleContent.displayName = "CollapsibleContent";
`;

// ===========================================================================
// HOVER CARD
// ===========================================================================
const HOVER_CARD = `import * as React from "react";
import { cn } from "@/lib/utils";

interface Ctx { open: boolean; setOpen: (v: boolean) => void; openDelay: number; closeDelay: number; }
const HoverCardCtx = React.createContext<Ctx | null>(null);

export interface HoverCardProps {
  openDelay?: number;
  closeDelay?: number;
  children: React.ReactNode;
}

export const HoverCard: React.FC<HoverCardProps> = ({ openDelay = 300, closeDelay = 200, children }) => {
  const [open, setOpen] = React.useState(false);
  return <HoverCardCtx.Provider value={{ open, setOpen, openDelay, closeDelay }}><div className="relative inline-block">{children}</div></HoverCardCtx.Provider>;
};

export const HoverCardTrigger: React.FC<React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }> = ({ children, ...rest }) => {
  const ctx = React.useContext(HoverCardCtx)!;
  const timer = React.useRef<number>();
  return (
    <span
      onMouseEnter={() => { clearTimeout(timer.current); timer.current = window.setTimeout(() => ctx.setOpen(true), ctx.openDelay); }}
      onMouseLeave={() => { clearTimeout(timer.current); timer.current = window.setTimeout(() => ctx.setOpen(false), ctx.closeDelay); }}
      {...rest}
    >{children}</span>
  );
};

export const HoverCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { side?: "top" | "bottom"; align?: "start" | "center" | "end" }>(
  ({ className, side = "bottom", align = "center", children, ...rest }, ref) => {
    const ctx = React.useContext(HoverCardCtx);
    if (!ctx?.open) return null;
    const sideCls = side === "top" ? "bottom-full mb-2" : "top-full mt-2";
    const alignCls = align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";
    return (
      <div
        ref={ref}
        role="dialog"
        className={cn("absolute z-50 w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95", sideCls, alignCls, className)}
        {...rest}
      >{children}</div>
    );
  },
);
HoverCardContent.displayName = "HoverCardContent";
`;

// ===========================================================================
// TOGGLE + TOGGLE GROUP
// ===========================================================================
const TOGGLE = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const toggleVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-9 px-2.5",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ToggleProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof toggleVariants> {
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
}

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  ({ className, variant, size, pressed, defaultPressed = false, onPressedChange, onClick, ...rest }, ref) => {
    const [internal, setInternal] = React.useState(defaultPressed);
    const value = pressed ?? internal;
    return (
      <button
        ref={ref}
        type="button"
        data-state={value ? "on" : "off"}
        aria-pressed={value}
        className={cn(toggleVariants({ variant, size }), className)}
        onClick={(e) => { if (pressed === undefined) setInternal(!value); onPressedChange?.(!value); onClick?.(e); }}
        {...rest}
      />
    );
  },
);
Toggle.displayName = "Toggle";
`;

const TOGGLE_GROUP = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Toggle, toggleVariants, type ToggleProps } from "./toggle";
import type { VariantProps } from "class-variance-authority";

type Variant = VariantProps<typeof toggleVariants>;

interface Ctx { variant?: Variant["variant"]; size?: Variant["size"]; value: string | string[]; onSelect: (v: string) => void; type: "single" | "multiple"; }
const TGCtx = React.createContext<Ctx | null>(null);

export type ToggleGroupProps =
  | ({ type: "single"; value?: string; defaultValue?: string; onValueChange?: (v: string) => void } & Omit<React.HTMLAttributes<HTMLDivElement>, "type"> & Variant)
  | ({ type: "multiple"; value?: string[]; defaultValue?: string[]; onValueChange?: (v: string[]) => void } & Omit<React.HTMLAttributes<HTMLDivElement>, "type"> & Variant);

export const ToggleGroup: React.FC<ToggleGroupProps> = (props) => {
  const { type, className, children, variant, size, ...rest } = props as any;
  const isMulti = type === "multiple";
  const [internal, setInternal] = React.useState<string | string[]>(props.defaultValue ?? (isMulti ? [] : ""));
  const value = props.value ?? internal;
  const onSelect = (v: string) => {
    if (isMulti) {
      const arr = (value as string[]).includes(v) ? (value as string[]).filter((x) => x !== v) : [...(value as string[]), v];
      if (props.value === undefined) setInternal(arr);
      (props as any).onValueChange?.(arr);
    } else {
      const next = value === v ? "" : v;
      if (props.value === undefined) setInternal(next);
      (props as any).onValueChange?.(next);
    }
  };
  return (
    <TGCtx.Provider value={{ variant, size, value, onSelect, type }}>
      <div role="group" className={cn("inline-flex items-center justify-center gap-1", className)} {...rest}>{children}</div>
    </TGCtx.Provider>
  );
};

export interface ToggleGroupItemProps extends Omit<ToggleProps, "pressed" | "onPressedChange"> { value: string; }

export const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ value, variant, size, ...rest }, ref) => {
    const ctx = React.useContext(TGCtx);
    const pressed = ctx ? (Array.isArray(ctx.value) ? ctx.value.includes(value) : ctx.value === value) : false;
    return (
      <Toggle
        ref={ref}
        variant={variant ?? ctx?.variant}
        size={size ?? ctx?.size}
        pressed={pressed}
        onPressedChange={() => ctx?.onSelect(value)}
        {...rest}
      />
    );
  },
);
ToggleGroupItem.displayName = "ToggleGroupItem";
`;

// ===========================================================================
// ASPECT RATIO
// ===========================================================================
const ASPECT_RATIO = `import * as React from "react";

export interface AspectRatioProps extends React.HTMLAttributes<HTMLDivElement> {
  ratio?: number;
}

export const AspectRatio = React.forwardRef<HTMLDivElement, AspectRatioProps>(
  ({ ratio = 1, style, children, ...rest }, ref) => (
    <div ref={ref} style={{ position: "relative", width: "100%", paddingBottom: \`\${100 / ratio}%\`, ...style }} {...rest}>
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
    </div>
  ),
);
AspectRatio.displayName = "AspectRatio";
`;

// ===========================================================================
// SPINNER
// ===========================================================================
const SPINNER = `import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  size?: "sm" | "default" | "lg";
}

const sizeMap = { sm: "h-4 w-4", default: "h-6 w-6", lg: "h-10 w-10" } as const;

export const Spinner: React.FC<SpinnerProps> = ({ size = "default", className, ...rest }) => (
  <Loader2 role="status" aria-label="Loading" className={cn("animate-spin text-muted-foreground", sizeMap[size], className)} {...rest} />
);
`;

// ===========================================================================
// CONTEXT MENU (right-click)
// ===========================================================================
const CONTEXT_MENU = `import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Ctx { open: boolean; pos: { x: number; y: number }; setOpen: (v: boolean) => void; setPos: (p: { x: number; y: number }) => void; }
const C = React.createContext<Ctx | null>(null);

export const ContextMenu: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  return <C.Provider value={{ open, setOpen, pos, setPos }}>{children}</C.Provider>;
};

export const ContextMenuTrigger: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...rest }) => {
  const ctx = React.useContext(C)!;
  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); ctx.setPos({ x: e.clientX, y: e.clientY }); ctx.setOpen(true); }}
      {...rest}
    >{children}</div>
  );
};

export const ContextMenuContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => {
  const ctx = React.useContext(C)!;
  React.useEffect(() => {
    if (!ctx.open) return;
    const close = () => ctx.setOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [ctx.open]);
  if (!ctx.open) return null;
  return (
    <div
      role="menu"
      style={{ position: "fixed", left: ctx.pos.x, top: ctx.pos.y, zIndex: 50 }}
      className={cn("min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95", className)}
      {...rest}
    >{children}</div>
  );
};

export const ContextMenuItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { inset?: boolean; disabled?: boolean }>(
  ({ className, inset, disabled, ...rest }, ref) => (
    <div
      ref={ref}
      role="menuitem"
      aria-disabled={disabled}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        inset && "pl-8",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      {...rest}
    />
  ),
);
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuLabel: React.FC<React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }> = ({ className, inset, ...rest }) => (
  <div className={cn("px-2 py-1.5 text-sm font-semibold text-foreground", inset && "pl-8", className)} {...rest} />
);

export const ContextMenuSeparator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div role="separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...rest} />
);

export const ContextMenuShortcut: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, ...rest }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...rest} />
);

export { Check as ContextMenuCheck, ChevronRight as ContextMenuArrow };
`;

// ===========================================================================
// MENUBAR (horizontal menu like a desktop app menu bar)
// ===========================================================================
const MENUBAR = `import * as React from "react";
import { cn } from "@/lib/utils";

interface Ctx { openId: string | null; setOpenId: (id: string | null) => void; }
const C = React.createContext<Ctx | null>(null);

export const Menubar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => {
  const [openId, setOpenId] = React.useState<string | null>(null);
  return (
    <C.Provider value={{ openId, setOpenId }}>
      <div role="menubar" className={cn("flex h-10 items-center gap-1 rounded-md border border-border bg-background p-1", className)} {...rest}>
        {children}
      </div>
    </C.Provider>
  );
};

export const MenubarMenu: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const id = React.useId();
  return <div data-menu-id={id} className="relative">{React.Children.map(children, (c) => React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<any>, { "data-menu-id": id }) : c)}</div>;
};

export const MenubarTrigger: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { "data-menu-id"?: string }> = ({ className, onClick, ...rest }) => {
  const ctx = React.useContext(C)!;
  const id = (rest as any)["data-menu-id"] as string;
  const open = ctx.openId === id;
  return (
    <button
      type="button"
      role="menuitem"
      data-state={open ? "open" : "closed"}
      className={cn("flex select-none items-center rounded-sm px-3 py-1.5 text-sm font-medium outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground", className)}
      onClick={(e) => { ctx.setOpenId(open ? null : id); onClick?.(e); }}
      {...rest}
    />
  );
};

export const MenubarContent: React.FC<React.HTMLAttributes<HTMLDivElement> & { "data-menu-id"?: string }> = ({ className, children, ...rest }) => {
  const ctx = React.useContext(C)!;
  const id = (rest as any)["data-menu-id"] as string;
  React.useEffect(() => {
    if (ctx.openId !== id) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest("[data-menubar-content]")) ctx.setOpenId(null); };
    setTimeout(() => window.addEventListener("click", close), 0);
    return () => window.removeEventListener("click", close);
  }, [ctx.openId, id]);
  if (ctx.openId !== id) return null;
  return (
    <div
      data-menubar-content
      role="menu"
      className={cn("absolute left-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95", className)}
      {...rest}
    >{children}</div>
  );
};

export const MenubarItem: React.FC<React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }> = ({ className, inset, ...rest }) => (
  <div
    role="menuitem"
    className={cn("relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground", inset && "pl-8", className)}
    {...rest}
  />
);

export const MenubarSeparator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div role="separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...rest} />
);

export const MenubarShortcut: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, ...rest }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...rest} />
);

export const MenubarLabel: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("px-2 py-1.5 text-sm font-semibold", className)} {...rest} />
);
`;

// ===========================================================================
// NAVIGATION MENU (mega-nav flyout)
// ===========================================================================
const NAVIGATION_MENU = `import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Ctx { openId: string | null; setOpenId: (id: string | null) => void; }
const C = React.createContext<Ctx | null>(null);

export const NavigationMenu: React.FC<React.HTMLAttributes<HTMLElement>> = ({ className, children, ...rest }) => {
  const [openId, setOpenId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!openId) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest("[data-navmenu]")) setOpenId(null); };
    setTimeout(() => window.addEventListener("click", close), 0);
    return () => window.removeEventListener("click", close);
  }, [openId]);
  return (
    <C.Provider value={{ openId, setOpenId }}>
      <nav data-navmenu className={cn("relative z-10 flex max-w-max flex-1 items-center justify-center", className)} {...rest}>{children}</nav>
    </C.Provider>
  );
};

export const NavigationMenuList: React.FC<React.HTMLAttributes<HTMLUListElement>> = ({ className, ...rest }) => (
  <ul className={cn("group flex flex-1 list-none items-center justify-center space-x-1", className)} {...rest} />
);

export const NavigationMenuItem: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const id = React.useId();
  return <li className="relative" data-nav-id={id}>{React.Children.map(children, (c) => React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<any>, { "data-nav-id": id }) : c)}</li>;
};

export const navigationMenuTriggerStyle = "group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent/50";

export const NavigationMenuTrigger: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { "data-nav-id"?: string }> = ({ className, children, ...rest }) => {
  const ctx = React.useContext(C)!;
  const id = (rest as any)["data-nav-id"] as string;
  const open = ctx.openId === id;
  return (
    <button
      type="button"
      data-state={open ? "open" : "closed"}
      className={cn(navigationMenuTriggerStyle, "group", className)}
      onClick={(e) => { e.stopPropagation(); ctx.setOpenId(open ? null : id); }}
      {...rest}
    >
      {children}{" "}
      <ChevronDown className={cn("relative top-px ml-1 h-3 w-3 transition duration-200", open && "rotate-180")} aria-hidden />
    </button>
  );
};

export const NavigationMenuContent: React.FC<React.HTMLAttributes<HTMLDivElement> & { "data-nav-id"?: string }> = ({ className, children, ...rest }) => {
  const ctx = React.useContext(C)!;
  const id = (rest as any)["data-nav-id"] as string;
  if (ctx.openId !== id) return null;
  return (
    <div
      className={cn("absolute left-0 top-full mt-1.5 w-auto min-w-[18rem] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95", className)}
      onClick={(e) => e.stopPropagation()}
      {...rest}
    >{children}</div>
  );
};

export const NavigationMenuLink = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  ({ className, ...rest }, ref) => (
    <a ref={ref} className={cn("block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground", className)} {...rest} />
  ),
);
NavigationMenuLink.displayName = "NavigationMenuLink";

export const NavigationMenuViewport: React.FC<React.HTMLAttributes<HTMLDivElement>> = () => null;
export const NavigationMenuIndicator: React.FC<React.HTMLAttributes<HTMLDivElement>> = () => null;
`;

// ===========================================================================
// EMPTY (empty-state container)
// ===========================================================================
const EMPTY = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Empty: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center", className)} {...rest} />
);

export const EmptyHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("flex flex-col items-center gap-3", className)} {...rest} />
);

export const EmptyMedia: React.FC<React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "icon" }> = ({ className, variant = "icon", ...rest }) => (
  <div className={cn(variant === "icon" ? "flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground" : "", className)} {...rest} />
);

export const EmptyTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...rest }) => (
  <h3 className={cn("text-base font-semibold text-foreground", className)} {...rest} />
);

export const EmptyDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...rest }) => (
  <p className={cn("max-w-sm text-sm text-muted-foreground", className)} {...rest} />
);

export const EmptyContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("mt-4 flex flex-col items-center gap-2", className)} {...rest} />
);
`;

// ===========================================================================
// FIELD (form-field wrapper with label / error / description)
// ===========================================================================
const FIELD = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Field = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => <div ref={ref} className={cn("flex flex-col gap-2", className)} {...rest} />,
);
Field.displayName = "Field";

export const FieldGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("flex flex-col gap-4", className)} {...rest} />
);

export const FieldLabel: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({ className, ...rest }) => (
  <label className={cn("text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)} {...rest} />
);

export const FieldDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...rest }) => (
  <p className={cn("text-xs text-muted-foreground", className)} {...rest} />
);

export const FieldError: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...rest }) => (
  <p role="alert" className={cn("text-xs font-medium text-destructive", className)} {...rest} />
);

export const FieldSet: React.FC<React.FieldsetHTMLAttributes<HTMLFieldSetElement>> = ({ className, ...rest }) => (
  <fieldset className={cn("flex flex-col gap-4 rounded-md border border-border p-4", className)} {...rest} />
);

export const FieldLegend: React.FC<React.HTMLAttributes<HTMLLegendElement>> = ({ className, ...rest }) => (
  <legend className={cn("text-sm font-semibold text-foreground", className)} {...rest} />
);
`;

// ===========================================================================
// INPUT GROUP (input + addons)
// ===========================================================================
const INPUT_GROUP = `import * as React from "react";
import { cn } from "@/lib/utils";

export const InputGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn("flex h-10 items-stretch overflow-hidden rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", className)}
      {...rest}
    />
  ),
);
InputGroup.displayName = "InputGroup";

export const InputGroupAddon: React.FC<React.HTMLAttributes<HTMLSpanElement> & { align?: "start" | "end" }> = ({ className, align = "start", ...rest }) => (
  <span
    className={cn("flex items-center bg-muted px-3 text-sm text-muted-foreground", align === "end" ? "border-l border-input" : "border-r border-input", className)}
    {...rest}
  />
);

export const InputGroupInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn("min-w-0 flex-1 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...rest}
    />
  ),
);
InputGroupInput.displayName = "InputGroupInput";

export const InputGroupButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn("flex items-center border-l border-input bg-muted px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground", className)}
      {...rest}
    />
  ),
);
InputGroupButton.displayName = "InputGroupButton";
`;

// ===========================================================================
// CAROUSEL (Embla wrapper)
// ===========================================================================
const CAROUSEL = `"use client";
import * as React from "react";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type CarouselApi = UseEmblaCarouselType[1];
type CarouselOptions = Parameters<typeof useEmblaCarousel>[0];
type CarouselPlugin = Parameters<typeof useEmblaCarousel>[1];

interface CarouselProps {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
}

interface CarouselCtxValue extends CarouselProps {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: CarouselApi;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
}

const CarouselCtx = React.createContext<CarouselCtxValue | null>(null);
export function useCarousel() {
  const ctx = React.useContext(CarouselCtx);
  if (!ctx) throw new Error("useCarousel must be used within <Carousel>");
  return ctx;
}

export const Carousel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & CarouselProps>(
  ({ orientation = "horizontal", opts, setApi, plugins, className, children, ...rest }, ref) => {
    const [carouselRef, api] = useEmblaCarousel({ ...opts, axis: orientation === "horizontal" ? "x" : "y" }, plugins);
    const [canPrev, setCanPrev] = React.useState(false);
    const [canNext, setCanNext] = React.useState(false);
    const onSelect = React.useCallback((a: CarouselApi) => { if (!a) return; setCanPrev(a.canScrollPrev()); setCanNext(a.canScrollNext()); }, []);
    React.useEffect(() => { if (!api) return; setApi?.(api); onSelect(api); api.on("reInit", onSelect); api.on("select", onSelect); }, [api, onSelect, setApi]);
    return (
      <CarouselCtx.Provider value={{ carouselRef, api, opts, orientation, scrollPrev: () => api?.scrollPrev(), scrollNext: () => api?.scrollNext(), canScrollPrev: canPrev, canScrollNext: canNext }}>
        <div ref={ref} className={cn("relative", className)} role="region" aria-roledescription="carousel" {...rest}>{children}</div>
      </CarouselCtx.Provider>
    );
  },
);
Carousel.displayName = "Carousel";

export const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => {
    const { carouselRef, orientation } = useCarousel();
    return (
      <div ref={carouselRef} className="overflow-hidden">
        <div ref={ref} className={cn("flex", orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col", className)} {...rest} />
      </div>
    );
  },
);
CarouselContent.displayName = "CarouselContent";

export const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => {
    const { orientation } = useCarousel();
    return <div ref={ref} role="group" aria-roledescription="slide" className={cn("min-w-0 shrink-0 grow-0 basis-full", orientation === "horizontal" ? "pl-4" : "pt-4", className)} {...rest} />;
  },
);
CarouselItem.displayName = "CarouselItem";

export const CarouselPrevious = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, variant = "outline", size = "icon", ...rest }, ref) => {
    const { orientation, scrollPrev, canScrollPrev } = useCarousel();
    return (
      <Button ref={ref} variant={variant} size={size} disabled={!canScrollPrev} onClick={scrollPrev}
        className={cn("absolute h-8 w-8 rounded-full", orientation === "horizontal" ? "-left-12 top-1/2 -translate-y-1/2" : "-top-12 left-1/2 -translate-x-1/2 rotate-90", className)}
        {...rest}
      ><ArrowLeft className="h-4 w-4" /><span className="sr-only">Previous slide</span></Button>
    );
  },
);
CarouselPrevious.displayName = "CarouselPrevious";

export const CarouselNext = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, variant = "outline", size = "icon", ...rest }, ref) => {
    const { orientation, scrollNext, canScrollNext } = useCarousel();
    return (
      <Button ref={ref} variant={variant} size={size} disabled={!canScrollNext} onClick={scrollNext}
        className={cn("absolute h-8 w-8 rounded-full", orientation === "horizontal" ? "-right-12 top-1/2 -translate-y-1/2" : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90", className)}
        {...rest}
      ><ArrowRight className="h-4 w-4" /><span className="sr-only">Next slide</span></Button>
    );
  },
);
CarouselNext.displayName = "CarouselNext";

export type { CarouselApi };
`;

// ===========================================================================
// COMMAND (cmdk palette)
// ===========================================================================
const COMMAND = `"use client";
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "./dialog";

export const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(
  ({ className, ...rest }, ref) => (
    <CommandPrimitive ref={ref} className={cn("flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground", className)} {...rest} />
  ),
);
Command.displayName = "Command";

export interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {}

export const CommandDialog: React.FC<CommandDialogProps> = ({ children, ...props }) => (
  <Dialog {...props}>
    <DialogContent className="overflow-hidden p-0 shadow-lg">
      <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
        {children}
      </Command>
    </DialogContent>
  </Dialog>
);

export const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(
  ({ className, ...rest }, ref) => (
    <div className="flex items-center border-b border-border px-3" cmdk-input-wrapper="">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input ref={ref} className={cn("flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50", className)} {...rest} />
    </div>
  ),
);
CommandInput.displayName = "CommandInput";

export const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(
  ({ className, ...rest }, ref) => (
    <CommandPrimitive.List ref={ref} className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)} {...rest} />
  ),
);
CommandList.displayName = "CommandList";

export const CommandEmpty = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Empty>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(
  (props, ref) => <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />,
);
CommandEmpty.displayName = "CommandEmpty";

export const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(
  ({ className, ...rest }, ref) => (
    <CommandPrimitive.Group ref={ref} className={cn("overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground", className)} {...rest} />
  ),
);
CommandGroup.displayName = "CommandGroup";

export const CommandSeparator = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>>(
  ({ className, ...rest }, ref) => <CommandPrimitive.Separator ref={ref} className={cn("-mx-1 h-px bg-border", className)} {...rest} />,
);
CommandSeparator.displayName = "CommandSeparator";

export const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(
  ({ className, ...rest }, ref) => (
    <CommandPrimitive.Item ref={ref} className={cn("relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50", className)} {...rest} />
  ),
);
CommandItem.displayName = "CommandItem";

export const CommandShortcut: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, ...rest }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...rest} />
);
`;

// ===========================================================================
// RESIZABLE (react-resizable-panels wrapper)
// ===========================================================================
const RESIZABLE = `"use client";
import * as React from "react";
import { GripVertical } from "lucide-react";
import * as RP from "react-resizable-panels";
import { cn } from "@/lib/utils";

export const ResizablePanelGroup: React.FC<React.ComponentProps<typeof RP.PanelGroup>> = ({ className, ...rest }) => (
  <RP.PanelGroup className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)} {...rest} />
);

export const ResizablePanel = RP.Panel;

export const ResizableHandle: React.FC<React.ComponentProps<typeof RP.PanelResizeHandle> & { withHandle?: boolean }> = ({ withHandle, className, ...rest }) => (
  <RP.PanelResizeHandle
    className={cn("relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90", className)}
    {...rest}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </RP.PanelResizeHandle>
);
`;

// ===========================================================================
// DATA TABLE (TanStack Table wrapper — generic ready-to-use)
// ===========================================================================
const DATA_TABLE = `"use client";
import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: keyof TData & string;
  searchPlaceholder?: string;
  pageSize?: number;
}

export function DataTable<TData, TValue>({
  columns, data, searchKey, searchPlaceholder = "Search…", pageSize = 10,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className="w-full">
      {searchKey && (
        <div className="flex items-center pb-4">
          <Input
            placeholder={searchPlaceholder}
            value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
            onChange={(e) => table.getColumn(searchKey)?.setFilterValue(e.target.value)}
            className="max-w-sm"
          />
        </div>
      )}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getCanSort() && <ArrowUpDown className="h-3 w-3 opacity-50" />}
                      </button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">No results.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-2 pt-4">
        <span className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </span>
        <Button variant="outline" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
`;

// ===========================================================================
// SIDEBAR (full shadcn-faithful system)
// ===========================================================================
const SIDEBAR = `"use client";
import * as React from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const SIDEBAR_COOKIE_NAME = "sidebar:state";
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";

type SidebarState = "expanded" | "collapsed";
interface SidebarCtx {
  state: SidebarState;
  open: boolean;
  setOpen: (v: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (v: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}
const Ctx = React.createContext<SidebarCtx | null>(null);

export function useSidebar() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useSidebar must be used within <SidebarProvider>");
  return c;
}

function useIsMobile() {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setM(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return m;
}

export interface SidebarProviderProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const SidebarProvider = React.forwardRef<HTMLDivElement, SidebarProviderProps>(
  ({ defaultOpen = true, open: openProp, onOpenChange, className, style, children, ...rest }, ref) => {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = React.useState(false);
    const [internal, setInternal] = React.useState(defaultOpen);
    const open = openProp ?? internal;
    const setOpen = React.useCallback((v: boolean) => {
      if (openProp === undefined) setInternal(v);
      onOpenChange?.(v);
      try { document.cookie = \`\${SIDEBAR_COOKIE_NAME}=\${v}; path=/; max-age=\${60 * 60 * 24 * 7}\`; } catch {}
    }, [openProp, onOpenChange]);
    const toggleSidebar = React.useCallback(() => {
      if (isMobile) setOpenMobile(!openMobile);
      else setOpen(!open);
    }, [isMobile, openMobile, open, setOpen]);
    const state: SidebarState = open ? "expanded" : "collapsed";
    return (
      <Ctx.Provider value={{ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }}>
        <div
          ref={ref}
          style={{ "--sidebar-width": SIDEBAR_WIDTH, "--sidebar-width-icon": SIDEBAR_WIDTH_ICON, ...style } as React.CSSProperties}
          className={cn("group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar", className)}
          {...rest}
        >{children}</div>
      </Ctx.Provider>
    );
  },
);
SidebarProvider.displayName = "SidebarProvider";

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}

export const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ side = "left", variant = "sidebar", collapsible = "offcanvas", className, children, ...rest }, ref) => {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
    if (collapsible === "none") {
      return (
        <div ref={ref} className={cn("flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground", className)} {...rest}>
          {children}
        </div>
      );
    }
    if (isMobile) {
      return (
        <>
          <div
            onClick={() => setOpenMobile(false)}
            aria-hidden
            className={cn("fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm transition-opacity", openMobile ? "opacity-100" : "pointer-events-none opacity-0")}
          />
          <aside
            ref={ref}
            data-mobile="true"
            data-state={openMobile ? "open" : "closed"}
            className={cn(
              "fixed inset-y-0 z-50 flex w-[--sidebar-width-mobile,18rem] flex-col bg-sidebar p-0 text-sidebar-foreground shadow-xl transition-transform duration-300",
              side === "left" ? "left-0" : "right-0",
              openMobile ? "translate-x-0" : side === "left" ? "-translate-x-full" : "translate-x-full",
              className,
            )}
            style={{ "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE } as React.CSSProperties}
            {...rest}
          >{children}</aside>
        </>
      );
    }
    return (
      <div
        ref={ref}
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
        className={cn(
          "group peer hidden md:flex flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear",
          state === "collapsed" && collapsible === "icon" ? "w-[--sidebar-width-icon]" : "w-[--sidebar-width]",
          state === "collapsed" && collapsible === "offcanvas" && "w-0 overflow-hidden",
          variant === "floating" || variant === "inset" ? "m-2 rounded-lg border border-border" : "border-r border-border",
          className,
        )}
        {...rest}
      >{children}</div>
    );
  },
);
Sidebar.displayName = "Sidebar";

export const SidebarTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, onClick, ...rest }, ref) => {
    const { toggleSidebar } = useSidebar();
    return (
      <Button ref={ref} variant="ghost" size="icon" className={cn("h-7 w-7", className)} onClick={(e) => { toggleSidebar(); onClick?.(e); }} {...rest}>
        <PanelLeft className="h-4 w-4" />
        <span className="sr-only">Toggle Sidebar</span>
      </Button>
    );
  },
);
SidebarTrigger.displayName = "SidebarTrigger";

export const SidebarInset = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <main ref={ref} className={cn("relative flex min-h-svh flex-1 flex-col bg-background", className)} {...rest} />
  ),
);
SidebarInset.displayName = "SidebarInset";

export const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => <div ref={ref} className={cn("flex flex-col gap-2 p-2", className)} {...rest} />,
);
SidebarHeader.displayName = "SidebarHeader";

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => <div ref={ref} className={cn("flex flex-col gap-2 p-2", className)} {...rest} />,
);
SidebarFooter.displayName = "SidebarFooter";

export const SidebarSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => <div ref={ref} className={cn("mx-2 h-px bg-border", className)} {...rest} />,
);
SidebarSeparator.displayName = "SidebarSeparator";

export const SidebarContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2", className)} {...rest} />
  ),
);
SidebarContent.displayName = "SidebarContent";

export interface SidebarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
}
export const SidebarGroup = React.forwardRef<HTMLDivElement, SidebarGroupProps>(
  ({ className, ...rest }, ref) => <div ref={ref} className={cn("relative flex w-full min-w-0 flex-col p-2", className)} {...rest} />,
);
SidebarGroup.displayName = "SidebarGroup";

export const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn("flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none", "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0", className)} {...rest} />
  ),
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => <div ref={ref} className={cn("w-full text-sm", className)} {...rest} />,
);
SidebarGroupContent.displayName = "SidebarGroupContent";

export const SidebarMenu = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...rest }, ref) => <ul ref={ref} className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...rest} />,
);
SidebarMenu.displayName = "SidebarMenu";

export const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...rest }, ref) => <li ref={ref} className={cn("group/menu-item relative", className)} {...rest} />,
);
SidebarMenuItem.displayName = "SidebarMenuItem";

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  isActive?: boolean;
  size?: "default" | "sm" | "lg";
}
export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, isActive, asChild, size = "default", children, ...rest }, ref) => {
    const Comp: React.ElementType = asChild ? "span" : "button";
    return (
      <Comp
        ref={ref as any}
        data-active={isActive}
        className={cn(
          "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
          "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
          size === "sm" && "h-7 text-xs",
          size === "lg" && "h-12 text-sm",
          "group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2",
          className,
        )}
        {...rest}
      >{children}</Comp>
    );
  },
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export const SidebarMenuSub = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...rest }, ref) => (
    <ul ref={ref} className={cn("mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden", className)} {...rest} />
  ),
);
SidebarMenuSub.displayName = "SidebarMenuSub";

export const SidebarMenuSubItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ ...rest }, ref) => <li ref={ref} {...rest} />,
);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

export const SidebarMenuSubButton = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { isActive?: boolean }>(
  ({ className, isActive, ...rest }, ref) => (
    <a
      ref={ref}
      data-active={isActive}
      className={cn("flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground", className)}
      {...rest}
    />
  ),
);
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";
`;

// ===========================================================================
// Sidebar tokens — must be present in styles.css for shadcn Sidebar to theme.
// We append via a small CSS file that the styles.css can @import optionally;
// since we don't mutate styles.css from here, document via a constant the
// scaffold can include if needed. The Sidebar component still works without
// these tokens (falls back to default border/foreground/background).
// ===========================================================================

// ===========================================================================
// Registration
// ===========================================================================
export const KIT_SHADCN_FILES: KitFile[] = [
  // zero-dep primitives
  { path: "src/components/ui/breadcrumb.tsx", content: BREADCRUMB, overwrite: true },
  { path: "src/components/ui/collapsible.tsx", content: COLLAPSIBLE, overwrite: true },
  { path: "src/components/ui/hover-card.tsx", content: HOVER_CARD, overwrite: true },
  { path: "src/components/ui/toggle.tsx", content: TOGGLE, overwrite: true },
  { path: "src/components/ui/toggle-group.tsx", content: TOGGLE_GROUP, overwrite: true },
  { path: "src/components/ui/aspect-ratio.tsx", content: ASPECT_RATIO, overwrite: true },
  { path: "src/components/ui/spinner.tsx", content: SPINNER, overwrite: true },
  { path: "src/components/ui/context-menu.tsx", content: CONTEXT_MENU, overwrite: true },
  { path: "src/components/ui/menubar.tsx", content: MENUBAR, overwrite: true },
  { path: "src/components/ui/navigation-menu.tsx", content: NAVIGATION_MENU, overwrite: true },
  { path: "src/components/ui/empty.tsx", content: EMPTY, overwrite: true },
  { path: "src/components/ui/field.tsx", content: FIELD, overwrite: true },
  { path: "src/components/ui/input-group.tsx", content: INPUT_GROUP, overwrite: true },

  // vendor-backed (auto-installed via KNOWN_PACKAGES on first import)
  { path: "src/components/ui/carousel.tsx", content: CAROUSEL, overwrite: true },
  { path: "src/components/ui/command.tsx", content: COMMAND, overwrite: true },
  { path: "src/components/ui/resizable.tsx", content: RESIZABLE, overwrite: true },
  { path: "src/components/ui/data-table.tsx", content: DATA_TABLE, overwrite: true },

  // sidebar system
  { path: "src/components/ui/sidebar.tsx", content: SIDEBAR, overwrite: true },
];
