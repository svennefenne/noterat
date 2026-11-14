import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "./lib/i18n";

/** A screen before the app proper (connect, first account, log in): the name, a card, and the language switch. */
export function Page({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  return (
    <main className="page">
      <header className="brand">
        <img src="/icon.svg" alt="" width={40} height={40} />
        <div>
          <p className="brand-name">Noterat</p>
          <p className="brand-tagline">{t("app.tagline")}</p>
        </div>
      </header>
      <section className="card" aria-labelledby="page-title">
        <h1 id="page-title">{title}</h1>
        {intro && <p className="intro">{intro}</p>}
        {children}
      </section>
      <footer className="page-footer">
        {footer}
        <button type="button" className="link" onClick={() => setLang(lang === "sv" ? "en" : "sv")} lang={lang === "sv" ? "en" : "sv"}>
          {t("lang.other")}
        </button>
      </footer>
    </main>
  );
}

/** A labelled text field, with a hint under it. */
export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** What went wrong, read out as it appears. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="problem" role="alert">
      {children}
    </p>
  );
}

export function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
      {children}
    </button>
  );
}
