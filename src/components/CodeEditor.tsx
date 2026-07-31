/**
 * CodeEditor — CodeMirror surface with Petal's own syntax theme.
 *
 * We ship a hand-tuned light/dark palette (rather than the stock CodeMirror
 * look) so code reads like part of the product: warm paper in light mode,
 * deep ink in dark mode, generous line-height, a quiet gutter, and an
 * active-line highlight that never fights the syntax colors.
 */
import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

function extensionsFor(path: string): Extension[] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return [html()];
  if (lower.endsWith(".css")) return [css()];
  if (lower.endsWith(".json")) return [json()];
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".jsx")
  )
    return [javascript({ jsx: true })];
  if (lower.endsWith(".ts") || lower.endsWith(".tsx"))
    return [javascript({ jsx: true, typescript: true })];
  return [];
}

const LIGHT = {
  bg: "#fdfbf7",
  fg: "#2a2622",
  gutter: "#a9a196",
  gutterActive: "#6b625a",
  activeLine: "#f3ede2",
  selection: "#f6dfd0",
  cursor: "#e2683c",
  keyword: "#b3372b",
  string: "#1f7a4d",
  comment: "#a29a8f",
  number: "#9a5b12",
  fn: "#2b5fd9",
  type: "#7a4bbd",
  tag: "#b3372b",
  attr: "#9a5b12",
  punctuation: "#7d746b",
};

const DARK = {
  bg: "#15130f",
  fg: "#ece7df",
  gutter: "#5b544b",
  gutterActive: "#a89f93",
  activeLine: "#1f1c17",
  selection: "#3a2c22",
  cursor: "#ff8a5c",
  keyword: "#ff8b7a",
  string: "#7ddba0",
  comment: "#6f675d",
  number: "#f0b464",
  fn: "#8ab4ff",
  type: "#c4a2ff",
  tag: "#ff8b7a",
  attr: "#f0b464",
  punctuation: "#9c9288",
};

function makeTheme(dark: boolean): Extension[] {
  const c = dark ? DARK : LIGHT;

  const view = EditorView.theme(
    {
      "&": {
        backgroundColor: c.bg,
        color: c.fg,
        fontSize: "13px",
      },
      ".cm-scroller": {
        fontFamily:
          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, 'JetBrains Mono', Consolas, monospace",
        lineHeight: "1.75",
        padding: "8px 0 40px",
      },
      ".cm-content": { caretColor: c.cursor },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: c.cursor, borderLeftWidth: "2px" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: c.selection,
      },
      ".cm-activeLine": { backgroundColor: c.activeLine },
      ".cm-gutters": {
        backgroundColor: c.bg,
        color: c.gutter,
        border: "none",
        paddingRight: "4px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 12px",
        fontVariantNumeric: "tabular-nums",
      },
      ".cm-activeLineGutter": { backgroundColor: c.activeLine, color: c.gutterActive },
      ".cm-foldGutter .cm-gutterElement": { opacity: 0.5 },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "transparent",
        outline: `1px solid ${c.punctuation}`,
        borderRadius: "2px",
      },
      ".cm-tooltip": {
        border: "none",
        borderRadius: "10px",
        overflow: "hidden",
        backgroundColor: dark ? "#221e19" : "#ffffff",
        boxShadow: "0 12px 32px -12px rgba(0,0,0,0.35)",
      },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: "italic" },
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.moduleKeyword], color: c.keyword },
    { tag: [t.string, t.special(t.string), t.regexp], color: c.string },
    { tag: [t.number, t.bool, t.null, t.atom], color: c.number },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.fn },
    { tag: [t.typeName, t.className, t.namespace], color: c.type },
    { tag: [t.tagName, t.angleBracket], color: c.tag },
    { tag: [t.attributeName, t.propertyName], color: c.attr },
    { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: c.punctuation },
    { tag: [t.variableName, t.definition(t.variableName)], color: c.fg },
    { tag: [t.heading, t.strong], color: c.fg, fontWeight: "700" },
    { tag: t.link, color: c.fn, textDecoration: "underline" },
    { tag: t.invalid, color: dark ? "#ff6b6b" : "#c0392b" },
  ]);

  return [view, syntaxHighlighting(highlight)];
}

/** Tracks the resolved (light/dark) theme by watching the `.dark` class. */
function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function CodeEditor({
  path,
  value,
  onChange,
  onBlur,
}: {
  path: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
}) {
  const dark = useIsDark();
  const extensions = useMemo(
    () => [...makeTheme(dark), EditorView.lineWrapping, ...extensionsFor(path)],
    [path, dark],
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={extensions}
      onChange={onChange}
      onBlur={onBlur}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        tabSize: 2,
      }}
      className="h-full"
    />
  );
}
