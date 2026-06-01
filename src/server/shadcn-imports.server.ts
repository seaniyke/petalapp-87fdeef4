/**
 * Deterministic missing-shadcn-import autofix.
 *
 * The #1 silent-crash mode in generated apps:
 *   <Avatar><AvatarImage src=... /><AvatarFallback>JD</AvatarFallback></Avatar>
 *   import { Avatar, AvatarFallback } from "@/components/ui/avatar";
 *                       // ^^^^^^^^^ AvatarImage missing → ReferenceError at render.
 *
 * TypeScript-loose JSX accepts undefined PascalCase tags (treats them as `any`),
 * so the build passes — the app then white-screens with
 * "Can't find variable: AvatarImage". The local verifier already detects this
 * via `findUndefinedComponents` (kind: "undefined"), but until now we relied
 * on a model autofix to repair it. This module repairs it deterministically:
 *
 *   1. Scan PascalCase JSX usages with no declaration/import.
 *   2. For each, look up its module in SHADCN_EXPORTS.
 *   3. If an existing `import { ... } from "@/components/ui/X"` line exists,
 *      extend it. Otherwise insert a new one after the last import.
 *
 * Pure regex, <2ms per file. Runs in both the monolithic stream-autofix pass
 * and the staged-pipeline wire-up stage.
 */

import type { ProjectFile } from "@/server/generate.server";

/**
 * Named exports of every shadcn ui module Petal ships in src/components/ui/.
 * Source of truth: the components scaffolded by scaffold-kit.ts.
 *
 * If you add a new ui/<x>.tsx component to the scaffold, add its named
 * exports here too — otherwise the model will keep producing apps that
 * crash at runtime when it uses sub-components without importing them.
 */
const SHADCN_EXPORTS: Record<string, string> = {};
function reg(module: string, exports: string[]) {
  for (const e of exports) SHADCN_EXPORTS[e] = `@/components/ui/${module}`;
}
reg("accordion", ["Accordion", "AccordionItem", "AccordionTrigger", "AccordionContent"]);
reg("alert", ["Alert", "AlertTitle", "AlertDescription"]);
reg("alert-dialog", [
  "AlertDialog", "AlertDialogPortal", "AlertDialogOverlay", "AlertDialogTrigger",
  "AlertDialogContent", "AlertDialogHeader", "AlertDialogFooter",
  "AlertDialogTitle", "AlertDialogDescription", "AlertDialogAction", "AlertDialogCancel",
]);
reg("aspect-ratio", ["AspectRatio"]);
reg("avatar", ["Avatar", "AvatarImage", "AvatarFallback"]);
reg("badge", ["Badge"]);
reg("breadcrumb", [
  "Breadcrumb", "BreadcrumbList", "BreadcrumbItem", "BreadcrumbLink",
  "BreadcrumbPage", "BreadcrumbSeparator", "BreadcrumbEllipsis",
]);
reg("button", ["Button"]);
reg("calendar", ["Calendar"]);
reg("card", ["Card", "CardHeader", "CardFooter", "CardTitle", "CardDescription", "CardContent"]);
reg("carousel", ["Carousel", "CarouselContent", "CarouselItem", "CarouselPrevious", "CarouselNext"]);
reg("checkbox", ["Checkbox"]);
reg("collapsible", ["Collapsible", "CollapsibleTrigger", "CollapsibleContent"]);
reg("command", [
  "Command", "CommandDialog", "CommandInput", "CommandList", "CommandEmpty",
  "CommandGroup", "CommandItem", "CommandShortcut", "CommandSeparator",
]);
reg("context-menu", [
  "ContextMenu", "ContextMenuTrigger", "ContextMenuContent", "ContextMenuItem",
  "ContextMenuCheckboxItem", "ContextMenuRadioItem", "ContextMenuLabel",
  "ContextMenuSeparator", "ContextMenuShortcut", "ContextMenuGroup",
  "ContextMenuPortal", "ContextMenuSub", "ContextMenuSubContent",
  "ContextMenuSubTrigger", "ContextMenuRadioGroup",
]);
reg("dialog", [
  "Dialog", "DialogPortal", "DialogOverlay", "DialogTrigger", "DialogClose",
  "DialogContent", "DialogHeader", "DialogFooter", "DialogTitle", "DialogDescription",
]);
reg("drawer", [
  "Drawer", "DrawerPortal", "DrawerOverlay", "DrawerTrigger", "DrawerClose",
  "DrawerContent", "DrawerHeader", "DrawerFooter", "DrawerTitle", "DrawerDescription",
]);
reg("dropdown-menu", [
  "DropdownMenu", "DropdownMenuTrigger", "DropdownMenuContent", "DropdownMenuItem",
  "DropdownMenuCheckboxItem", "DropdownMenuRadioItem", "DropdownMenuLabel",
  "DropdownMenuSeparator", "DropdownMenuShortcut", "DropdownMenuGroup",
  "DropdownMenuPortal", "DropdownMenuSub", "DropdownMenuSubContent",
  "DropdownMenuSubTrigger", "DropdownMenuRadioGroup",
]);
reg("form", ["Form", "FormItem", "FormLabel", "FormControl", "FormDescription", "FormMessage", "FormField"]);
reg("hover-card", ["HoverCard", "HoverCardTrigger", "HoverCardContent"]);
reg("input", ["Input"]);
reg("input-otp", ["InputOTP", "InputOTPGroup", "InputOTPSlot", "InputOTPSeparator"]);
reg("label", ["Label"]);
reg("menubar", [
  "Menubar", "MenubarMenu", "MenubarTrigger", "MenubarContent", "MenubarItem",
  "MenubarSeparator", "MenubarLabel", "MenubarCheckboxItem", "MenubarRadioGroup",
  "MenubarRadioItem", "MenubarPortal", "MenubarSubContent", "MenubarSubTrigger",
  "MenubarGroup", "MenubarSub", "MenubarShortcut",
]);
reg("navigation-menu", [
  "NavigationMenu", "NavigationMenuList", "NavigationMenuItem", "NavigationMenuContent",
  "NavigationMenuTrigger", "NavigationMenuLink", "NavigationMenuIndicator",
  "NavigationMenuViewport",
]);
reg("pagination", [
  "Pagination", "PaginationContent", "PaginationLink", "PaginationItem",
  "PaginationPrevious", "PaginationNext", "PaginationEllipsis",
]);
reg("popover", ["Popover", "PopoverTrigger", "PopoverContent"]);
reg("progress", ["Progress"]);
reg("radio-group", ["RadioGroup", "RadioGroupItem"]);
reg("resizable", ["ResizablePanelGroup", "ResizablePanel", "ResizableHandle"]);
reg("scroll-area", ["ScrollArea", "ScrollBar"]);
reg("select", [
  "Select", "SelectGroup", "SelectValue", "SelectTrigger", "SelectContent",
  "SelectLabel", "SelectItem", "SelectSeparator", "SelectScrollUpButton", "SelectScrollDownButton",
]);
reg("separator", ["Separator"]);
reg("sheet", [
  "Sheet", "SheetPortal", "SheetOverlay", "SheetTrigger", "SheetClose",
  "SheetContent", "SheetHeader", "SheetFooter", "SheetTitle", "SheetDescription",
]);
reg("sidebar", [
  "Sidebar", "SidebarContent", "SidebarFooter", "SidebarGroup", "SidebarGroupAction",
  "SidebarGroupContent", "SidebarGroupLabel", "SidebarHeader", "SidebarInput",
  "SidebarInset", "SidebarMenu", "SidebarMenuAction", "SidebarMenuBadge",
  "SidebarMenuButton", "SidebarMenuItem", "SidebarMenuSkeleton", "SidebarMenuSub",
  "SidebarMenuSubButton", "SidebarMenuSubItem", "SidebarProvider", "SidebarRail",
  "SidebarSeparator", "SidebarTrigger",
]);
reg("skeleton", ["Skeleton"]);
reg("slider", ["Slider"]);
reg("sonner", ["Toaster"]);
reg("switch", ["Switch"]);
reg("table", [
  "Table", "TableHeader", "TableBody", "TableFooter", "TableHead", "TableRow",
  "TableCell", "TableCaption",
]);
reg("tabs", ["Tabs", "TabsList", "TabsTrigger", "TabsContent"]);
reg("textarea", ["Textarea"]);
reg("toggle", ["Toggle"]);
reg("toggle-group", ["ToggleGroup", "ToggleGroupItem"]);
reg("tooltip", ["Tooltip", "TooltipTrigger", "TooltipContent", "TooltipProvider"]);

const SCANNABLE = /\.(tsx?|jsx?)$/;

/** Strip strings/comments so identifier scanning isn't poisoned. Mirrors
 *  local-verifier's stripNoise but kept local to avoid a circular import. */
function stripNoise(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/`(?:\\[\s\S]|\$\{[\s\S]*?\}|[^`\\])*`/g, " ")
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, " ")
    .replace(/'(?:\\[\s\S]|[^'\\])*'/g, " ");
}

function collectDeclared(src: string): Set<string> {
  const declared = new Set<string>(["Fragment", "StrictMode", "Suspense", "Profiler", "Children"]);
  const importRe = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:,?\s*\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    if (m[1]) declared.add(m[1]);
    if (m[3]) declared.add(m[3]);
    if (m[2]) for (const part of m[2].split(",")) {
      const name = part.trim().replace(/^type\s+/i, "").split(/\s+as\s+/i).pop()?.trim();
      if (name) declared.add(name);
    }
  }
  const declRe = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_]*)/g;
  while ((m = declRe.exec(src))) declared.add(m[1]);
  return declared;
}

function collectUsedJsxTags(clean: string): Set<string> {
  const tags = new Set<string>();
  const n = clean.length;
  for (let i = 0; i < n; i++) {
    if (clean[i] !== "<") continue;
    if (clean[i + 1] === "/") continue;
    let j = i + 1;
    const start = j;
    while (j < n && /[A-Za-z0-9_]/.test(clean[j])) j++;
    const name = clean.slice(start, j);
    if (!name || !/^[A-Z]/.test(name)) continue;
    let p = i - 1;
    while (p >= 0 && /\s/.test(clean[p])) p--;
    const prev = p >= 0 ? clean[p] : undefined;
    if (prev && /[A-Za-z0-9_$\])]/.test(prev)) continue; // generic, not JSX
    tags.add(name);
  }
  return tags;
}

/**
 * Add `name` to an import from `module`. If a matching import already exists,
 * extend its named list. Otherwise insert a fresh import after the last
 * import line (or at the top).
 */
function injectImport(src: string, module: string, name: string): string {
  // Try to extend an existing import from the same module.
  const existing = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${module.replace(/[.*+?^${}()|[\\]/g, "\\$&")}["']\\s*;?`,
  );
  const match = src.match(existing);
  if (match) {
    const names = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (names.includes(name)) return src;
    names.push(name);
    const replacement = `import { ${names.join(", ")} } from "${module}";`;
    return src.replace(existing, replacement);
  }
  // Insert after the last top-level import.
  const importRe = /^import[^\n]*\n/gm;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    lastEnd = m.index + m[0].length;
  }
  const line = `import { ${name} } from "${module}";\n`;
  if (lastEnd === 0) return line + src;
  return src.slice(0, lastEnd) + line + src.slice(lastEnd);
}

export interface ShadcnImportFix {
  path: string;
  added: string[];
}

/**
 * Add any missing shadcn imports detected from JSX usage. Returns the
 * (possibly mutated) files plus a report of every injection — callers
 * (stage-wireup, stream-autofix) surface these in telemetry.
 */
export function fixMissingShadcnImports(files: ProjectFile[]): {
  files: ProjectFile[];
  fixes: ShadcnImportFix[];
} {
  const fixes: ShadcnImportFix[] = [];
  const out = files.map((file) => {
    if (!SCANNABLE.test(file.path)) return file;
    // Don't touch the shadcn modules themselves or the integrations scaffolding.
    if (file.path.startsWith("src/components/ui/") || file.path.startsWith("src/integrations/")) {
      return file;
    }
    const src = file.content;
    if (!src.includes("<")) return file;
    const clean = stripNoise(src);
    const used = collectUsedJsxTags(clean);
    if (used.size === 0) return file;
    const declared = collectDeclared(src);
    const toAdd: { name: string; module: string }[] = [];
    for (const name of used) {
      if (declared.has(name)) continue;
      const module = SHADCN_EXPORTS[name];
      if (!module) continue;
      toAdd.push({ name, module });
    }
    if (toAdd.length === 0) return file;
    let content = src;
    const added: string[] = [];
    for (const { name, module } of toAdd) {
      const next = injectImport(content, module, name);
      if (next !== content) {
        content = next;
        added.push(name);
      }
    }
    if (added.length === 0) return file;
    fixes.push({ path: file.path, added });
    return { ...file, content };
  });
  return { files: out, fixes };
}
