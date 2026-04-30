import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { Fragment } from "react";
import { SecretRequestCard } from "./SecretRequestCard";
// SuggestedIntegrationCard removed — third-party integrations are scaffolded
// from prompts now, not suggested as one-click installs.

// Only register the languages we actually need — keeps the highlight.js chunk
// from ballooning past 500KB.
import xml from "highlight.js/lib/languages/xml"; // html uses xml
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";

const languages = {
  html: xml,
  xml,
  css,
  javascript,
  js: javascript,
  typescript,
  ts: typescript,
  json,
  bash,
  shell: bash,
  markdown,
  md: markdown,
};

/**
 * Renders an assistant message as Markdown with GFM (tables, lists, links,
 * task lists) and syntax-highlighted code blocks. User messages keep raw
 * whitespace formatting.
 *
 * Also extracts Petal-specific inline tags before rendering so they become
 * interactive cards instead of leaking into the markdown output:
 *   <lov-suggest-integration code="stripe" />
 *   <lov-add-secret name="OPENAI_API_KEY" instructions="…" link="…" requestId="…" />
 */
type Segment =
  | { kind: "md"; text: string }
  | { kind: "suggest"; code: string }
  | { kind: "secret"; name: string; instructions?: string; link?: string; requestId?: string };

const TAG_RE = /<lov-(suggest-integration|add-secret)\b([^>]*)\/?>(?:<\/lov-\1>)?/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) out[m[1]] = m[2];
  return out;
}

function splitSegments(content: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content))) {
    if (m.index > last) {
      segs.push({ kind: "md", text: content.slice(last, m.index) });
    }
    const attrs = parseAttrs(m[2]);
    if (m[1] === "suggest-integration" && attrs.code) {
      segs.push({ kind: "suggest", code: attrs.code });
    } else if (m[1] === "add-secret" && attrs.name) {
      segs.push({
        kind: "secret",
        name: attrs.name,
        instructions: attrs.instructions,
        link: attrs.link,
        requestId: attrs.requestid || attrs.requestId,
      });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) segs.push({ kind: "md", text: content.slice(last) });
  return segs;
}

export function MarkdownMessage({ content, projectId }: { content: string; projectId?: string | null }) {
  const segments = splitSegments(content);
  return (
    <div className="markdown prose prose-base max-w-none font-sans text-[15.5px] leading-[1.65] tracking-[-0.011em] text-foreground/95 wrap-anywhere [&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2.5 [&_ol]:my-2.5 [&_li]:my-1 [&_h1]:font-display [&_h2]:font-display [&_h3]:font-display [&_h1]:tracking-[-0.022em] [&_h2]:tracking-[-0.022em] [&_h3]:tracking-[-0.022em] [&_strong]:font-semibold [&_strong]:text-foreground">
      {segments.map((seg, i) => {
        if (seg.kind === "suggest") {
          // Marketplace removed — drop the tag silently instead of rendering a card.
          return null;
        }
        if (seg.kind === "secret") {
          return (
            <SecretRequestCard
              key={i}
              name={seg.name}
              instructions={seg.instructions}
              link={seg.link}
              requestId={seg.requestId ?? null}
              projectId={projectId ?? null}
            />
          );
        }
        return (
          <Fragment key={i}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[
                [rehypeHighlight, { detect: true, ignoreMissing: true, languages }],
              ]}
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
                      className="wrap-anywhere rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.88em] text-foreground"
                      {...rest}
                    >
                      {children}
                    </code>
                  );
                },
                pre: (props) => (
                  <pre
                    {...props}
                    className="my-3 overflow-x-auto rounded-xl bg-muted p-3.5 font-mono text-[13px] leading-[1.55]"
                  />
                ),
              }}
            >
              {seg.text}
            </ReactMarkdown>
          </Fragment>
        );
      })}
    </div>
  );
}
