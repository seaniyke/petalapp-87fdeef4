import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

/**
 * Renders an assistant message as Markdown with GFM (tables, lists, links,
 * task lists) and syntax-highlighted code blocks. User messages keep raw
 * whitespace formatting.
 */
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown prose prose-sm max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noreferrer" className="underline" />
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = (className ?? "").startsWith("language-");
            if (isBlock) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              {...props}
              className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[12px] leading-relaxed"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
