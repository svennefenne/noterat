import { lazy, Suspense, type ComponentProps } from "react";
import { useI18n } from "../lib/i18n";
import { Caught } from "../ui";

// (CodeMirror with Markdown is the app's biggest part: it's fetched apart, and early, so it's there when
// the connection goes; a website opened offline without it says so instead of failing)
const load = () => import("./Editor");
const Editor = lazy(() => load().then((m) => ({ default: m.MarkdownEditor })));

/** Fetch the editor a little after the app starts, while there's (probably) a connection. */
export function preloadEditor() {
  setTimeout(() => void load().catch(() => {}), 2000);
}

export function MarkdownEditor(props: ComponentProps<typeof Editor>) {
  const { t } = useI18n();
  return (
    <Caught
      fallback={
        <div className="md-host">
          <p className="notice">{t("editor.unavailable")}</p>
          <pre className="md-plain">{props.text.toString()}</pre>
        </div>
      }
    >
      <Suspense fallback={<div className="md-host" />}>
        <Editor {...props} />
      </Suspense>
    </Caught>
  );
}
