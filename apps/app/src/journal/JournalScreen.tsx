import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Image, Mic, PenLine, Rows3, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { dayOf, entryBody, entryPreview, entryTitle, initEntry, readEntry, type EntryView } from "@noterat/core";
import { useDates, type Dates } from "../lib/dates";
import { useLinkedAction } from "../lib/deepLinks";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { useFileUrl } from "../things/useFileUrl";
import { useStored } from "../ui";

const readCard = (doc: Y.Doc) => ({ entry: readEntry(doc), body: entryBody(doc).toString() });

interface Card {
  id: string;
  shared: boolean;
  entry: EntryView;
  body: string;
}

/** A day as the journal shows it: "fredag 14 november" (with the year when it isn't this one), or as the household writes days. */
export function dayName(day: string, dates: Dates, o: { year?: boolean; weekday?: boolean } = {}) {
  return dates.day(day, { weekday: o.weekday !== false, long: true, year: o.year || undefined });
}

/**
 * The journal: this person's entries (and ones shared with them), newest day first, as a timeline by
 * month or a calendar to pick a day from. A new entry is about today, or the day picked.
 */
export function JournalScreen() {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const { homeLoaded } = useSyncState();
  const [, navigate] = useLocation();
  const items = useHomeItems().filter(([, item]) => item.type === "journal");
  const docs = sync.docsOf("journal", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const [view, setView] = useStored<"timeline" | "calendar">("noterat.journal.view", "timeline");
  const entries: Card[] = items
    .map(([id, item], i) => ({ id, shared: item.role !== "owner", ...cards[i]! }))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.createdAt - a.entry.createdAt);

  function write(date = dayOf()) {
    const id = sync.create("journal", (doc) => initEntry(doc, { date, by: user.id }));
    navigate(`/journal/${id}`);
  }

  // "Journal" from the plus button (?new=1): an entry about today, as the New button writes one (once
  // the journal is unlocked: this page isn't shown before)
  useLinkedAction("new", () => write());

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("journal.title")}</h1>
        <div className="list-actions">
          <div className="segmented" role="group" aria-label={t("journal.view")}>
            <button type="button" aria-pressed={view === "timeline"} onClick={() => setView("timeline")} title={t("journal.timeline")}>
              <Rows3 aria-hidden size={16} />
              <span>{t("journal.timeline")}</span>
            </button>
            <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")} title={t("journal.calendar")}>
              <CalendarDays aria-hidden size={16} />
              <span>{t("journal.calendar")}</span>
            </button>
          </div>
          <button type="button" className="primary small" onClick={() => write()}>
            <PenLine aria-hidden size={18} /> {t("journal.write")}
          </button>
        </div>
      </div>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : view === "calendar" ? (
        <Calendar entries={entries} onWrite={write} />
      ) : entries.length === 0 ? (
        <div className="empty">
          <p>{t("journal.empty")}</p>
          <button type="button" className="primary" onClick={() => write()}>
            <PenLine aria-hidden size={18} /> {t("journal.write")}
          </button>
        </div>
      ) : (
        <Timeline entries={entries} />
      )}
    </div>
  );
}

function Timeline({ entries }: { entries: Card[] }) {
  const dates = useDates();
  const months = new Map<string, Card[]>();
  for (const e of entries) {
    const key = e.entry.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), e]);
  }
  return (
    <div className="timeline">
      {[...months].map(([month, list]) => (
        <section key={month}>
          <h2 className="month">{dates.month(month)}</h2>
          <ul className="entries">
            {list.map((e) => (
              <EntryCard key={e.id} card={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EntryCard({ card }: { card: Card }) {
  const { t } = useI18n();
  const dates = useDates();
  const { entry, body } = card;
  const d = new Date(`${entry.date}T12:00:00`);
  const title = entryTitle(entry, body);
  const preview = entryPreview(entry, body);
  return (
    <li>
      <Link href={`/journal/${card.id}`} className="entry-card">
        <span className="entry-day" aria-hidden>
          <span className="entry-weekday">{d.toLocaleDateString(t("locale"), { weekday: "short" })}</span>
          <span className="entry-date">{d.getDate()}</span>
        </span>
        <span className="entry-main">
          <span className="card-title">{title || <span className="muted">{dayName(entry.date, dates)}</span>}</span>
          <span className="visually-hidden">{dayName(entry.date, dates)}</span>
          {preview && <span className="card-preview">{preview}</span>}
          <span className="card-meta">
            {entry.photos.length > 0 && (
              <span>
                <Image aria-hidden size={14} /> {entry.photos.length}
              </span>
            )}
            {entry.clips.length > 0 && (
              <span>
                <Mic aria-hidden size={14} /> {entry.clips.length}
              </span>
            )}
            {card.shared && (
              <span className="badge">
                <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
              </span>
            )}
          </span>
        </span>
        {entry.photos[0] && <Thumb hash={entry.photos[0].hash} />}
      </Link>
    </li>
  );
}

function Thumb({ hash }: { hash: string }) {
  const url = useFileUrl(hash);
  return url ? <img className="entry-thumb" src={url} alt="" /> : <span className="entry-thumb empty" aria-hidden />;
}

/** A month, Monday first (in Swedish) or Sunday first; days with entries marked. A day picked shows its entries. */
function Calendar({ entries, onWrite }: { entries: Card[]; onWrite: (day: string) => void }) {
  const { t } = useI18n();
  const dates = useDates();
  const today = dayOf();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(today);
  const byDay = new Map<string, Card[]>();
  for (const e of entries) byDay.set(e.entry.date, [...(byDay.get(e.entry.date) ?? []), e]);

  const first = new Date(`${month}-01T12:00:00`);
  const lead = dates.weekIndex(first);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const shift = (n: number) => {
    const d = new Date(first.getFullYear(), first.getMonth() + n, 1);
    setMonth(dayOf(d).slice(0, 7));
  };
  const weekdays = dates.weekdays("narrow");
  const onDay = byDay.get(picked) ?? [];

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label={t("journal.prevMonth")}>
          <ChevronLeft aria-hidden size={20} />
        </button>
        <h2>{dates.month(first)}</h2>
        <button type="button" className="icon-button" onClick={() => shift(1)} aria-label={t("journal.nextMonth")}>
          <ChevronRight aria-hidden size={20} />
        </button>
      </div>
      <div className="calendar-grid" role="grid">
        {weekdays.map((w, i) => (
          <span key={`w${i}`} className="calendar-weekday" aria-hidden>
            {w}
          </span>
        ))}
        {cells.map((day, i) =>
          day ? (
            <button
              key={day}
              type="button"
              className={`calendar-day${day === today ? " today" : ""}${byDay.has(day) ? " has" : ""}`}
              aria-pressed={day === picked}
              aria-label={`${dayName(day, dates, { year: true })}${byDay.has(day) ? `, ${byDay.get(day)!.length === 1 ? t("journal.oneEntry") : t("journal.entries", { n: byDay.get(day)!.length })}` : ""}`}
              onClick={() => setPicked(day)}
            >
              {Number(day.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <div className="calendar-picked">
        <h3>{dayName(picked, dates)}</h3>
        {onDay.length > 0 && (
          <ul className="entries">
            {onDay.map((e) => (
              <EntryCard key={e.id} card={e} />
            ))}
          </ul>
        )}
        <button type="button" className="secondary small" onClick={() => onWrite(picked)}>
          <PenLine aria-hidden size={16} /> {t(onDay.length ? "journal.writeMore" : "journal.writeDay")}
        </button>
      </div>
    </div>
  );
}
