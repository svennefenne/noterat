import { lazy, Suspense, type ComponentProps } from "react";

// (CodeMirror with Markdown is the app's biggest part: it's fetched when a note or memo is first opened)
const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.MarkdownEditor })));

export function MarkdownEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<div className="md-host" />}>
      <Editor {...props} />
    </Suspense>
  );
}
