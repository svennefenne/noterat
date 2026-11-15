import { useEffect, useRef, type ReactNode } from "react";
import { House, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useCloseOnBack } from "../lib/back";
import { useI18n } from "../lib/i18n";
import { SECTION } from "../lib/things";
import { isIn, SECTIONS } from "./sections";

/**
 * The phone's menu of sections (behind the button left of the name): a panel from the left over the
 * page, with the start page and every section, the one you're in marked. Choosing one, tapping beside
 * it, Escape or the back button closes it.
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [location] = useLocation();
  const ref = useRef<HTMLDialogElement>(null);
  useCloseOnBack(open, onClose);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // (the section you're in, rather than the close button: from there it's one step either way)
      d.querySelector<HTMLElement>("[aria-current=page]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const link = (href: string, here: boolean, icon: ReactNode, label: string) => (
    <li key={href}>
      <Link href={href} className="drawer-link" aria-current={here ? "page" : undefined} onClick={onClose}>
        {icon}
        <span>{label}</span>
      </Link>
    </li>
  );

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={t("section.nav")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // (a tap on the dimmed page beside the panel lands on the dialog itself)
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="drawer-panel">
          <div className="drawer-head">
            <img src="/icon.svg" alt="" width={28} height={28} />
            <span>Noterat</span>
            <button type="button" className="icon-button" onClick={onClose} aria-label={t("nav.close")}>
              <X aria-hidden size={20} />
            </button>
          </div>
          <nav aria-label={t("section.nav")}>
            <ul className="drawer-list">
              {link("/", location === "/", <House aria-hidden size={20} />, t("nav.home"))}
              {SECTIONS.map(({ type, Icon }) => link(SECTION[type], isIn(location, type), <Icon aria-hidden size={20} />, t(`section.${type}`)))}
            </ul>
          </nav>
        </div>
      )}
    </dialog>
  );
}
