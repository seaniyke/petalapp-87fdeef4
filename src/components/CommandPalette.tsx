import { useEffect, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { FileCode2, Eye, Code2, RotateCw, RefreshCcw, History } from "lucide-react";

export type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  group?: string;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
}) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Group items by `group`
  const groups = items.reduce<Record<string, PaletteItem[]>>((acc, it) => {
    const key = it.group ?? "Actions";
    (acc[key] ??= []).push(it);
    return acc;
  }, {});

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="fixed inset-0 z-50 grid place-items-start justify-center bg-foreground/30 p-4 pt-[12vh] backdrop-blur-sm data-[state=closed]:hidden"
      contentClassName="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-glow)]"
    >
      <Command.Input
        autoFocus
        value={search}
        onValueChange={setSearch}
        placeholder="Type a command or search for a file…"
        className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
          No matches.
        </Command.Empty>
        {Object.entries(groups).map(([group, list]) => (
          <Command.Group
            key={group}
            heading={group}
            className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {list.map((it) => (
              <Command.Item
                key={it.id}
                value={`${it.label} ${it.hint ?? ""}`}
                onSelect={() => {
                  onOpenChange(false);
                  it.onSelect();
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-muted"
              >
                <span className="text-muted-foreground">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {it.hint}
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}

// Re-export icons most pages will want for items they create.
export const PaletteIcons = {
  File: FileCode2,
  Preview: Eye,
  Code: Code2,
  Reload: RotateCw,
  Regenerate: RefreshCcw,
  History,
};
