import { useState, type KeyboardEvent } from "react";
import { CalendarDays, CircleDot, Clock, Hash, SquareCheck, Type, UserRound, type LucideIcon } from "lucide-react";
import type { Cell, Column, ColumnType, Person } from "@noterat/core";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";

export const TYPE_ICONS: Record<ColumnType, LucideIcon> = {
  text: Type,
  check: SquareCheck,
  number: Hash,
  person: UserRound,
  date: CalendarDays,
  time: Clock,
  choice: CircleDot,
};

export interface CellProps {
  col: Column;
  value: Cell | undefined;
  editable: boolean;
  /** a value to keep (null: empty it); called when it's settled (left, picked, or Enter: via "enter") */
  onCommit: (value: Cell | string | number | null, via?: "enter") => void;
  people: Person[];
  me: number;
  /** what a screen reader calls it ("Item, row 3") */
  label: string;
  placeholder?: string;
  /** (the table's new row, made again after Enter: the cell that was being written in) */
  autoFocus?: boolean;
}

/** A person's name as the list shows it ("Sam", "Ada (you)"). */
export function usePersonName(people: Person[], me: number) {
  const { t } = useI18n();
  return (id: number) => {
    const p = people.find((x) => x.id === id);
    if (!p) return t("person.unknown");
    return id === me ? t("person.you", { name: p.displayName }) : p.displayName;
  };
}

/** What a cell shows when it can't be changed. */
export function useCellText(people: Person[], me: number) {
  const { lang } = useI18n();
  const dates = useDates();
  const name = usePersonName(people, me);
  return (col: Column, v: Cell | undefined): string => {
    if (v === undefined || v === null) return "";
    if (col.type === "person" && typeof v === "number") return name(v);
    if (col.type === "number" && typeof v === "number") return new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 4 }).format(v);
    if (col.type === "date" && typeof v === "string") return dates.day(v, { weekday: true });
    if (col.type === "check") return v === true ? "✓" : "";
    return String(v);
  };
}

/** One cell, as its column's kind says: a field to fill in, or what's in it for someone who can't. */
export function CellInput(p: CellProps) {
  const { t } = useI18n();
  const name = usePersonName(p.people, p.me);
  const text = useCellText(p.people, p.me);
  const { col, value, editable, onCommit, label } = p;

  if (col.type === "check")
    return <input type="checkbox" className="cell-check" checked={value === true} disabled={!editable} onChange={(e) => onCommit(e.target.checked ? true : null)} aria-label={label} />;

  if (!editable) return <span className="cell-text">{text(col, value)}</span>;

  if (col.type === "person") {
    const known = typeof value === "number" && p.people.some((x) => x.id === value);
    return (
      <select className="cell-input" value={typeof value === "number" ? String(value) : ""} onChange={(e) => onCommit(e.target.value ? Number(e.target.value) : null)} aria-label={label}>
        <option value="">–</option>
        {p.people.map((x) => (
          <option key={x.id} value={x.id}>
            {name(x.id)}
          </option>
        ))}
        {typeof value === "number" && !known && <option value={value}>{t("person.unknown")}</option>}
      </select>
    );
  }

  if (col.type === "choice")
    return (
      <select className="cell-input" value={typeof value === "string" ? value : ""} onChange={(e) => onCommit(e.target.value || null)} aria-label={label}>
        <option value="">–</option>
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );

  return <TextLike {...p} type={col.type === "date" ? "date" : col.type === "time" ? "time" : "text"} />;
}

/**
 * A field that's written in: kept as it's typed and settled when left or on Enter (Escape puts back
 * what it was). What others change meanwhile shows when you're not in it. A date settles as it's picked.
 */
function TextLike({ col, value, onCommit, label, placeholder, type, autoFocus }: CellProps & { type: "text" | "date" | "time" }) {
  const [draft, setDraft] = useState<string | null>(null);
  const was = value === undefined || value === null ? "" : String(value);
  const shown = draft ?? was;
  const settle = (v: string, via?: "enter") => {
    setDraft(null);
    if (v.trim() !== was) onCommit(v.trim() === "" ? null : v.trim(), via);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") settle(e.currentTarget.value, "enter");
    if (e.key === "Escape") setDraft(null);
  };
  return (
    <input
      className="cell-input"
      type={type}
      inputMode={col.type === "number" ? "decimal" : undefined}
      value={shown}
      placeholder={placeholder}
      aria-label={label}
      autoFocus={autoFocus}
      onChange={(e) => (type === "date" ? settle(e.target.value) : setDraft(e.target.value))}
      onBlur={(e) => draft !== null && settle(e.target.value)}
      onKeyDown={keys}
    />
  );
}
