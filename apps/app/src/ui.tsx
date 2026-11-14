import { Component, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
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

/** A modal dialog (the page's own <dialog>): Escape or the close button closes it; its content is made only while it's open. */
export function Dialog({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // (the dialog's own first field, rather than its close button)
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <header className="dialog-head">
            <h2 id={id}>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label={t("share.close")}>
              <X aria-hidden size={20} />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/** A button that opens a small menu over the page; choosing something (or clicking outside, or Escape) closes it. */
export function Menu({ label, icon, children, className = "" }: { label: string; icon: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button type="button" className="icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
      </button>
      {open && (
        <div role="menu" className="menu-list" onClick={(e) => (e.target as HTMLElement).closest("[role=menuitem]") && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, children, danger = false, disabled = false }: { onSelect: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className={danger ? "menu-item danger" : "menu-item"} onClick={onSelect} disabled={disabled}>
      {children}
    </button>
  );
}

/** A value kept on this device between visits (a remembered view), or the given one. */
export function useStored<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // (kept until the app closes)
    }
  };
  return [value, set];
}

/** Something that failed while showing itself shows `fallback` instead, and the rest of the app goes on. */
export class Caught extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
