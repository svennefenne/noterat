import { useEffect, useRef, useState } from "react";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Bold, Heading, Italic, Link2, List, ListChecks, Quote } from "lucide-react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { useI18n } from "../lib/i18n";

/**
 * Markdown, written as Markdown (decision 6): CodeMirror bound to the document's Y.Text, so what others
 * type shows as they type it (with their cursors), and undo only undoes your own. The marks stay in
 * the text but are dimmed, and headings, bold and italics look like what they are. A toolbar puts the
 * marks in for you on a phone.
 */
export function MarkdownEditor({
  text,
  awareness,
  readOnly = false,
  placeholder,
  toolbar = true,
  label,
}: {
  text: Y.Text;
  awareness: Awareness | null;
  readOnly?: boolean;
  placeholder: string;
  toolbar?: boolean;
  label: string;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    const undo = new Y.UndoManager(text);
    const extensions: Extension[] = [
      markdown(),
      syntaxHighlighting(style),
      EditorView.lineWrapping,
      placeholderText(placeholder),
      yCollab(text, awareness, { undoManager: undo }),
      keymap.of([...markdownKeymap, ...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true", autocapitalize: "sentences" }),
      theme,
    ];
    const v = new EditorView({ state: EditorState.create({ doc: text.toString(), extensions }), parent: host.current! });
    // (the editor is made here, where its element is; the toolbar needs it)
    setView(v);
    return () => {
      v.destroy();
      undo.destroy();
    };
  }, [text, awareness, readOnly, placeholder, label]);

  const tools: [string, typeof Bold, (v: EditorView) => void][] = [
    [t("md.heading"), Heading, (v) => linePrefix(v, "## ", /^#{1,6} /)],
    [t("md.bold"), Bold, (v) => wrap(v, "**")],
    [t("md.italic"), Italic, (v) => wrap(v, "_")],
    [t("md.list"), List, (v) => linePrefix(v, "- ", /^[-*+] (?!\[)/)],
    [t("md.task"), ListChecks, (v) => linePrefix(v, "- [ ] ", /^[-*+] \[[ xX]\] /)],
    [t("md.quote"), Quote, (v) => linePrefix(v, "> ", /^> /)],
    [t("md.link"), Link2, link],
  ];

  return (
    <div className="md-editor">
      {toolbar && !readOnly && (
        <div className="md-toolbar" role="toolbar" aria-label={t("md.toolbar")}>
          {tools.map(([name, Icon, run]) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              // (keeps the focus, and the selection, in the text)
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view && (run(view), view.focus())}
            >
              <Icon aria-hidden size={18} />
            </button>
          ))}
        </div>
      )}
      <div ref={host} className="md-host" />
    </div>
  );
}

/** Marks around each selection (or, with nothing selected, a pair to write between). Again: taken off. */
function wrap(view: EditorView, mark: string) {
  const n = mark.length;
  view.dispatch(
    view.state.changeByRange((r) => {
      const before = view.state.sliceDoc(r.from - n, r.from);
      const after = view.state.sliceDoc(r.to, r.to + n);
      if (before === mark && after === mark)
        return {
          changes: [
            { from: r.from - n, to: r.from },
            { from: r.to, to: r.to + n },
          ],
          range: EditorSelection.range(r.from - n, r.to - n),
        };
      return {
        changes: [
          { from: r.from, insert: mark },
          { from: r.to, insert: mark },
        ],
        range: EditorSelection.range(r.from + n, r.to + n),
      };
    }),
  );
}

/** A mark at the start of each selected line (a heading, a list), or off again if they all have it. */
function linePrefix(view: EditorView, prefix: string, has: RegExp) {
  const { state } = view;
  const lines = new Map<number, { from: number; text: string }>();
  for (const r of state.selection.ranges)
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      lines.set(line.from, { from: line.from, text: line.text });
      pos = line.to + 1;
    }
  const all = [...lines.values()];
  const off = all.every((l) => has.test(l.text));
  view.dispatch({
    changes: all.map((l) => {
      const m = has.exec(l.text);
      if (off) return { from: l.from, to: l.from + m![0].length };
      // (another kind of mark of the same sort is swapped, not added to: "# " becomes "## ")
      const other = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |> )/.exec(l.text);
      return { from: l.from, to: l.from + (other && prefix !== "> " ? other[0].length : 0), insert: prefix };
    }),
  });
}

function link(view: EditorView) {
  view.dispatch(
    view.state.changeByRange((r) => {
      const label = view.state.sliceDoc(r.from, r.to) || "text";
      const insert = `[${label}](https://)`;
      // (the address selected, to write over)
      const at = r.from + label.length + 3;
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(at, at + 8) };
    }),
  );
}

const style = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.45em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  // (#, *, -, > and friends: there, but quiet)
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--muted)" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "transparent", fontSize: "1rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6" },
  ".cm-content": { fontFamily: "inherit", lineHeight: "1.6", padding: "0.75rem 0", caretColor: "var(--text)", minHeight: "40vh" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-ySelectionInfo": { fontFamily: "inherit", fontSize: "0.75rem", padding: "1px 4px", borderRadius: "4px", opacity: "1" },
});
