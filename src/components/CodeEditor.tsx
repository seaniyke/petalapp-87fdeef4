import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
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
  const extensions = useMemo(() => extensionsFor(path), [path]);

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
      className="h-full text-[12.5px]"
    />
  );
}
