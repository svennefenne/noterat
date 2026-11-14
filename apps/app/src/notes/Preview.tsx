import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

// (links open beside the app; what a note says can't run anything)
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** A note's Markdown as it reads: GitHub's flavour, a line break where a line ends, and nothing unsafe. */
export function Preview({ markdown, empty }: { markdown: string; empty: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true, async: false })), [markdown]);
  if (!markdown.trim()) return <p className="muted">{empty}</p>;
  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
