/**
 * Phase 15 — Content & code surfaces.
 *
 * Ships three on-demand-only primitives. Heavy dependencies (Shiki grammars,
 * TipTap ProseMirror, react-markdown) are NOT added to REQUIRED_DEPS — the
 * model imports the file and the import-resolver pulls the package range
 * from known-packages.ts. Cold-load only when actually rendered.
 *
 *  - @/components/content/shiki-code-block — real syntax highlighting,
 *    light/dark via CSS variables, lazy-load grammars per language.
 *  - @/components/content/markdown-view    — react-markdown + remark-gfm
 *    (tables, strikethrough, task-lists, autolinks) using ShikiCodeBlock.
 *  - @/components/content/rich-text-editor — TipTap StarterKit editor with
 *    a bubble-menu toolbar (bold, italic, headings, lists, link, code).
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// ---------------------------------------------------------------------------
// ShikiCodeBlock — real highlighting, lazy grammars, light/dark via CSS vars.
// ---------------------------------------------------------------------------
const SHIKI_CODE_BLOCK = `import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// We keep ONE highlighter per browser session and lazy-load grammars on first
// use. Shiki ships every grammar as a separate JSON file; loading them all
// would balloon the bundle to MBs. Loaders run client-side only.
type Highlighter = Awaited<ReturnType<typeof import("shiki")["createHighlighter"]>>;
let _hi: Promise<Highlighter> | null = null;
const _loaded = new Set<string>(["plaintext"]);

async function getHighlighter(lang: string) {
  if (!_hi) {
    const { createHighlighter } = await import("shiki");
    _hi = createHighlighter({
      // \`github-light\` + \`github-dark\` is the canonical Shiki dual-theme
      // pair. The component flips via CSS \`prefers-color-scheme\` / .dark.
      themes: ["github-light", "github-dark"],
      langs: ["plaintext"],
    });
  }
  const hi = await _hi;
  if (!_loaded.has(lang)) {
    try {
      await hi.loadLanguage(lang as any);
      _loaded.add(lang);
    } catch {
      /* unknown lang → falls back to plaintext */
    }
  }
  return hi;
}

export interface ShikiCodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  className?: string;
}

/**
 * Real syntax highlighting via Shiki. Drop-in upgrade for the plain
 * \`<CodeBlock />\`. Renders highlighted HTML once on mount; safe to use
 * inside MarkdownView for fenced code blocks.
 *
 *   <ShikiCodeBlock language="tsx" code={\`const x = 1;\`} />
 */
export function ShikiCodeBlock({
  code,
  language = "plaintext",
  filename,
  showLineNumbers = false,
  className,
}: ShikiCodeBlockProps) {
  const [html, setHtml] = React.useState<string>("");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const hi = await getHighlighter(language);
      if (cancelled) return;
      try {
        const out = hi.codeToHtml(code, {
          lang: _loaded.has(language) ? language : "plaintext",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false, // emit CSS vars so .dark flips themes
        });
        setHtml(out);
      } catch {
        setHtml("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-muted/40",
        // Shiki emits inline color vars on every span; force pre + code to
        // honour them and reset their default white background.
        "[&_pre]:!bg-transparent [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre]:leading-relaxed [&_code]:font-mono",
        showLineNumbers &&
          "[&_pre_code]:[counter-reset:line] [&_pre_code_.line]:before:mr-4 [&_pre_code_.line]:before:inline-block [&_pre_code_.line]:before:w-6 [&_pre_code_.line]:before:text-right [&_pre_code_.line]:before:text-muted-foreground [&_pre_code_.line]:before:[counter-increment:line] [&_pre_code_.line]:before:content-[counter(line)]",
        // dark-mode flip: use the dark color set Shiki emitted (--shiki-dark).
        "dark:[&_*]:!text-[var(--shiki-dark)] dark:[&_*]:![background-color:var(--shiki-dark-bg)]",
        className,
      )}
    >
      {(filename || language) && (
        <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{filename ?? language}</span>
          {filename && language && <span className="uppercase tracking-wide">{language}</span>}
        </div>
      )}
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
          <code className="font-mono text-foreground">{code}</code>
        </pre>
      )}
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy code"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// MarkdownView — react-markdown + remark-gfm with Shiki for fenced code.
// ---------------------------------------------------------------------------
const MARKDOWN_VIEW = `import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ShikiCodeBlock } from "./shiki-code-block";

export interface MarkdownViewProps {
  children: string;
  className?: string;
}

/**
 * Tailwind-prose-style markdown renderer. Use for blog posts, docs, AI chat
 * messages, release notes — anything where the source is a markdown string.
 *
 * Supports GFM (tables, task-lists, strikethrough, autolinks) and uses
 * <ShikiCodeBlock> for fenced code so syntax highlighting is consistent.
 */
export function MarkdownView({ children, className }: MarkdownViewProps) {
  return (
    <div
      className={cn(
        "prose-petal max-w-none",
        // Inlined prose styles so we don't require @tailwindcss/typography.
        "text-foreground leading-relaxed",
        "[&_h1]:text-step-4 [&_h1]:font-display [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-4",
        "[&_h2]:text-step-3 [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3",
        "[&_h3]:text-step-2 [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2",
        "[&_p]:my-4 [&_p]:text-step-0",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:no-underline",
        "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:my-1",
        "[&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-8 [&_hr]:border-border",
        "[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_pre_code]:!bg-transparent [&_pre_code]:!p-0",
        "[&_img]:rounded-lg [&_img]:my-6",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\\w+)/.exec(className || "");
            const text = String(children).replace(/\\n$/, "");
            if (!inline && match) {
              return <ShikiCodeBlock language={match[1]} code={text} className="my-4" />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// RichTextEditor — TipTap StarterKit + bubble menu toolbar.
// ---------------------------------------------------------------------------
const RICH_TEXT_EDITOR = `import * as React from "react";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Link as LinkIcon, Undo2, Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
}

/**
 * Drop-in WYSIWYG editor backed by TipTap (ProseMirror). Use for notes,
 * comments, blog drafts, AI message composition — anywhere a textarea is
 * too primitive but a full CMS is overkill.
 *
 *   const [html, setHtml] = useState("<p>Hello</p>");
 *   <RichTextEditor value={html} onChange={setHtml} placeholder="Write..." />
 *
 * Toolbar lives in a floating BubbleMenu — appears on selection.
 */
export function RichTextEditor({
  value = "",
  onChange,
  placeholder = "Write something…",
  className,
  editable = true,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "text-primary underline underline-offset-4" } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: cn(
          "prose-petal max-w-none focus:outline-none min-h-[160px]",
          "text-foreground leading-relaxed",
          "[&_h1]:text-step-3 [&_h1]:font-display [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3",
          "[&_h2]:text-step-2 [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2",
          "[&_h3]:text-step-1 [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2",
          "[&_p]:my-3",
          "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
          "[&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:h-0",
        ),
      },
    },
  });

  // Keep external \`value\` in sync if controlled.
  React.useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!editor) return null;

  return (
    <div className={cn("rounded-lg border border-border bg-background p-4", className)}>
      {editable && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }} className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md">
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} icon={Bold} label="Bold" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} icon={Italic} label="Italic" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} icon={Strikethrough} label="Strike" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} icon={Code} label="Code" />
          <ToolbarSep />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} icon={Heading1} label="H1" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} icon={Heading2} label="H2" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} icon={Heading3} label="H3" />
          <ToolbarSep />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} icon={List} label="List" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} icon={ListOrdered} label="Ordered" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} icon={Quote} label="Quote" />
          <ToolbarBtn editor={editor} onClick={() => {
            const url = window.prompt("URL");
            if (url === null) return;
            if (url === "") return editor.chain().focus().unsetLink().run();
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }} active={editor.isActive("link")} icon={LinkIcon} label="Link" />
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
      {editable && (
        <div className="mt-3 flex items-center gap-1 border-t border-border pt-3 text-muted-foreground">
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().undo().run()} icon={Undo2} label="Undo" />
          <ToolbarBtn editor={editor} onClick={() => editor.chain().focus().redo().run()} icon={Redo2} label="Redo" />
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({
  editor, onClick, active, icon: Icon, label,
}: {
  editor: Editor;
  onClick: () => void;
  active?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
function ToolbarSep() {
  return <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />;
}
`;

export const KIT_CONTENT_FILES: KitFile[] = [
  { path: "src/components/content/shiki-code-block.tsx", content: SHIKI_CODE_BLOCK, overwrite: true },
  { path: "src/components/content/markdown-view.tsx", content: MARKDOWN_VIEW, overwrite: true },
  { path: "src/components/content/rich-text-editor.tsx", content: RICH_TEXT_EDITOR, overwrite: true },
];
