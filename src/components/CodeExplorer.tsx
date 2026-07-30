/**
 * CodeExplorer — the builder's "Code" view.
 *
 * Replaces the old flat file list with a proper explorer:
 *   - searchable, collapsible folder tree (folders collapse into one row when
 *     they only contain a single child, e.g. `docs / ops`)
 *   - open-file tabs across the top, with copy / download per file
 *   - inline image preview (with pixel dimensions) for binary-ish assets
 *   - "Download codebase" as a real .zip
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Image as ImageIcon,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

export type ExplorerFile = { path: string; content: string };

type TreeNode =
  | { kind: "file"; name: string; path: string }
  | { kind: "dir"; name: string; path: string; children: TreeNode[] };

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;

function isImage(path: string) {
  return IMAGE_RE.test(path);
}

function iconFor(path: string) {
  if (isImage(path)) return ImageIcon;
  if (/\.json$/i.test(path)) return FileJson;
  if (/\.(tsx?|jsx?|css|html?|mjs|cjs)$/i.test(path)) return FileCode2;
  return FileText;
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const p of [...paths].sort()) {
    const parts = p.split("/").filter(Boolean);
    let level = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      if (i === parts.length - 1) {
        level.push({ kind: "file", name: part, path: p });
        return;
      }
      let dir = level.find(
        (n): n is Extract<TreeNode, { kind: "dir" }> => n.kind === "dir" && n.name === part,
      );
      if (!dir) {
        dir = { kind: "dir", name: part, path: acc, children: [] };
        level.push(dir);
      }
      level = dir.children;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.kind === "dir") sort(n.children);
    return nodes;
  };
  return sort(root);
}

/** Collapse `a` -> `b` chains into a single `a / b` row, like most editors. */
function collapse(node: Extract<TreeNode, { kind: "dir" }>): {
  label: string;
  dir: Extract<TreeNode, { kind: "dir" }>;
} {
  let label = node.name;
  let dir = node;
  while (dir.children.length === 1 && dir.children[0].kind === "dir") {
    dir = dir.children[0];
    label = `${label} / ${dir.name}`;
  }
  return { label, dir };
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CodeExplorer({
  files,
  activeFile,
  onSelect,
  projectName,
  children,
}: {
  files: ExplorerFile[];
  activeFile: string | null;
  onSelect: (path: string | null) => void;
  projectName?: string | null;
  /** The editor surface for the active (text) file. */
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<string[]>(activeFile ? [activeFile] : []);
  const [zipping, setZipping] = useState(false);
  const [dims, setDims] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, query]);

  const tree = useMemo(() => buildTree(filtered.map((f) => f.path)), [filtered]);

  // Keep the tab strip in sync with whatever the builder selects.
  useEffect(() => {
    if (!activeFile) return;
    setTabs((prev) => (prev.includes(activeFile) ? prev : [...prev, activeFile]));
  }, [activeFile]);

  // Auto-expand folders on the path of the active file (and everything while
  // searching, so matches are visible without clicking).
  useEffect(() => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (query.trim()) {
        for (const f of filtered) {
          const parts = f.path.split("/");
          parts.pop();
          let acc = "";
          for (const p of parts) {
            acc = acc ? `${acc}/${p}` : p;
            next.add(acc);
          }
        }
      }
      if (activeFile) {
        const parts = activeFile.split("/");
        parts.pop();
        let acc = "";
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          next.add(acc);
        }
      }
      return next;
    });
  }, [activeFile, query, filtered]);

  const active = files.find((f) => f.path === activeFile) ?? null;
  const activeIsImage = !!active && isImage(active.path);

  useEffect(() => setDims(null), [activeFile]);

  function toggleDir(path: string) {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function closeTab(path: string) {
    setTabs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (path === activeFile) onSelect(next[next.length - 1] ?? null);
      return next;
    });
  }

  async function copyActive() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.content);
      toast.success("File copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function downloadZip() {
    setZipping(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const f of files) zip.file(f.path, f.content);
      const blob = await zip.generateAsync({ type: "blob" });
      download(`${(projectName || "petal-project").replace(/[^a-z0-9-_]+/gi, "-")}.zip`, blob);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't build the zip");
    } finally {
      setZipping(false);
    }
  }

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode {
    return nodes.map((n) => {
      if (n.kind === "file") {
        const Icon = iconFor(n.path);
        const isActive = n.path === activeFile;
        return (
          <button
            key={n.path}
            onClick={() => onSelect(n.path)}
            style={{ paddingLeft: 8 + depth * 12 }}
            className={`flex w-full items-center gap-1.5 py-1.5 pr-2 text-left text-[12px] font-semibold transition ${
              isActive
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            title={n.path}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">{n.name}</span>
          </button>
        );
      }
      const { label, dir } = collapse(n);
      const open = openDirs.has(dir.path);
      return (
        <div key={dir.path}>
          <button
            onClick={() => toggleDir(dir.path)}
            style={{ paddingLeft: 4 + depth * 12 }}
            className="flex w-full items-center gap-1 py-1.5 pr-2 text-left text-[12px] font-bold text-foreground/80 transition hover:bg-muted/60 hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </button>
          {open && renderNodes(dir.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,150px)_1fr] sm:grid-cols-[minmax(0,240px)_1fr]">
      {/* Sidebar */}
      <div className="flex min-h-0 min-w-0 flex-col border-r-2 border-foreground/10 bg-sidebar">
        <div className="border-b-2 border-foreground/10 p-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code"
              className="h-8 min-w-0 flex-1 bg-transparent text-[12px] font-semibold outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {files.length === 0 ? (
            <p className="px-3 py-2 text-[12px] font-semibold text-muted-foreground">
              No files yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-[12px] font-semibold text-muted-foreground">
              No matches for “{query}”.
            </p>
          ) : (
            renderNodes(tree, 0)
          )}
        </div>
        <div className="border-t-2 border-foreground/10 p-2">
          <button
            type="button"
            onClick={downloadZip}
            disabled={zipping || files.length === 0}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 py-2 text-[11px] font-bold transition hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {zipping ? "Zipping…" : "Download codebase"}
          </button>
        </div>
      </div>

      {/* Editor pane */}
      <div className="flex min-h-0 min-w-0 flex-col bg-card">
        {tabs.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b-2 border-foreground/10 px-2 py-1.5">
            {tabs.map((t) => (
              <span
                key={t}
                className={`group inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition ${
                  t === activeFile
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <button onClick={() => onSelect(t)} className="max-w-[180px] truncate" title={t}>
                  {t}
                </button>
                <button
                  onClick={() => closeTab(t)}
                  aria-label={`Close ${t}`}
                  className="opacity-50 transition hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
              <button
                onClick={copyActive}
                disabled={!active || activeIsImage}
                aria-label="Copy file"
                title="Copy file"
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() =>
                  active &&
                  download(
                    active.path.split("/").pop() || "file.txt",
                    new Blob([active.content], { type: "text/plain" }),
                  )
                }
                disabled={!active}
                aria-label="Download file"
                title="Download file"
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {!active ? (
            <div className="grid h-full place-items-center p-6 text-center text-[12.5px] font-semibold text-muted-foreground">
              Pick a file to open it.
            </div>
          ) : activeIsImage ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 overflow-auto p-6">
              <img
                src={active.content}
                alt={active.path}
                onLoad={(e) =>
                  setDims(
                    `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}px`,
                  )
                }
                className="max-h-[70%] max-w-full rounded-lg border border-border object-contain"
              />
              <p className="text-[11.5px] font-bold text-muted-foreground">
                {dims ?? active.path.split("/").pop()}
              </p>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
